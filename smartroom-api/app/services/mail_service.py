"""Rendu des gabarits de courriel et remise au transport.

Les gabarits vivent en base : l'administration les modifie depuis l'écran A-16
sans redéploiement. Le rendu passe par Jinja2 en **bac à sable** — un gabarit
est du contenu saisi par un administrateur, pas du code de confiance : sans
sandbox, `{{ ''.__class__.__mro__ }}` ouvrirait l'interpréteur.

Un gabarit désactivé ne bloque rien : l'action métier a déjà eu lieu, et ne pas
prévenir vaut mieux que la faire échouer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import aiosmtplib
from jinja2 import TemplateError
from jinja2.sandbox import SandboxedEnvironment
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFoundError, RuleViolationError
from app.db.enums import NotificationChannel
from app.models import EmailTemplate, EmailTemplateVariable, Notification, User

logger = logging.getLogger(__name__)
settings = get_settings()

#: `SandboxedEnvironment` bloque l'accès aux attributs internes. `autoescape`
#: reste désactivé : ces gabarits produisent du texte, pas du HTML, et
#: échapper transformerait « L'Atelier » en « L&#39;Atelier ».
JINJA = SandboxedEnvironment(autoescape=False, trim_blocks=True, lstrip_blocks=True)


@dataclass(frozen=True, slots=True)
class Message:
    """Un courriel prêt à partir, indépendant du transport."""

    to: str
    subject: str
    body: str


def render(template: str, variables: dict[str, Any]) -> str:
    """Rend un gabarit. Une variable absente devient une chaîne vide.

    Faire échouer un envoi parce qu'une variable manque priverait
    l'utilisateur d'une information au lieu de lui en donner une incomplète.
    """
    try:
        return JINJA.from_string(template).render(**variables)
    except TemplateError as erreur:
        raise RuleViolationError(
            f"Gabarit invalide : {erreur}", code="gabarit_invalide"
        ) from erreur


def get_template(session: Session, code: str) -> EmailTemplate | None:
    return session.scalars(
        select(EmailTemplate).where(EmailTemplate.code == code)
    ).one_or_none()


def known_variables(session: Session) -> list[EmailTemplateVariable]:
    return list(session.scalars(select(EmailTemplateVariable).order_by(EmailTemplateVariable.code)))


def preview(session: Session, code: str, variables: dict[str, Any] | None = None) -> Message:
    """Rend un gabarit avec les valeurs d'exemple, sans rien envoyer."""
    gabarit = get_template(session, code)
    if gabarit is None:
        raise NotFoundError("Gabarit introuvable.")

    valeurs = {item.code: item.sample_value for item in known_variables(session)}
    valeurs.update(variables or {})

    return Message(
        to=valeurs.get("destinataire", settings.mail_from),
        subject=render(gabarit.subject, valeurs),
        body=render(gabarit.body, valeurs),
    )


async def send(message: Message) -> None:
    """Remet un message au transport SMTP.

    Sans transport actif, le message est tracé : en développement, lire le
    journal vaut mieux qu'un envoi silencieusement perdu.
    """
    if not settings.mail_enabled:
        logger.info(
            "Courriel non envoyé (MAIL_ENABLED=false) → %s : %s\n%s",
            message.to,
            message.subject,
            message.body,
        )
        return

    from email.message import EmailMessage

    courriel = EmailMessage()
    courriel["From"] = settings.mail_from
    courriel["To"] = message.to
    courriel["Subject"] = message.subject
    courriel.set_content(message.body)

    try:
        await aiosmtplib.send(
            courriel,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=(
                settings.smtp_password.get_secret_value() if settings.smtp_password else None
            ),
            start_tls=settings.smtp_use_tls,
        )
    except (aiosmtplib.SMTPException, OSError):
        # Un serveur de courriel indisponible ne doit pas faire échouer une
        # réservation déjà écrite : l'incident est tracé, l'action tient.
        logger.exception("Envoi SMTP impossible → %s", message.to)


def notify(
    session: Session,
    *,
    user: User,
    code: str,
    variables: dict[str, Any],
    booking_id: Any = None,
    ticket_id: Any = None,
) -> Notification | None:
    """Rend le gabarit, persiste la notification applicative, prépare l'envoi.

    La notification est écrite dans la même transaction que l'action qui la
    déclenche : une réservation annulée ne doit pas laisser un « votre
    réservation est annulée » derrière elle, ni l'inverse.
    """
    gabarit = get_template(session, code)
    if gabarit is None or not gabarit.is_enabled:
        # Un gabarit absent ou désactivé ne bloque rien : l'action a eu lieu.
        logger.info("Gabarit « %s » absent ou désactivé, notification ignorée.", code)
        return None

    valeurs = {item.code: item.sample_value for item in known_variables(session)}
    valeurs.update({"prenom": user.first_name, "nom": user.last_name, **variables})

    titre = render(gabarit.subject, valeurs)
    corps = render(gabarit.body, valeurs)

    notification = Notification(
        user_id=user.id,
        title=titre,
        body=corps,
        channel=NotificationChannel.IN_APP,
        # Le gabarit d'origine : c'est lui qui dit ce que la notification
        # propose de faire, et l'écran n'a pas à le deviner d'après son titre.
        template_code=code,
        booking_id=booking_id,
        ticket_id=ticket_id,
    )
    session.add(notification)
    session.flush()

    _en_attente.append(Message(to=user.email, subject=titre, body=corps))
    return notification


#: Les envois sont différés hors de la transaction : expédier avant le COMMIT
#: annoncerait une réservation qu'un `ROLLBACK` ferait disparaître.
_en_attente: list[Message] = []


def pending() -> list[Message]:
    return list(_en_attente)


def flush() -> list[Message]:
    """Vide la file et rend les messages à expédier."""
    messages = list(_en_attente)
    _en_attente.clear()
    return messages


def queue_password_reset(session: Session, compte: User, jeton: str) -> Message:
    """Prépare le lien de réinitialisation.

    Ce message ne passe pas par un gabarit modifiable : un administrateur ne
    doit pas pouvoir casser le seul chemin de récupération d'un compte.
    """
    lien = f"{_origine()}/mot-de-passe/reinitialiser?token={jeton}"
    message = Message(
        to=compte.email,
        subject="Réinitialisation de votre mot de passe SmartRoom",
        body=(
            f"Bonjour {compte.first_name},\n\n"
            "Vous avez demandé à réinitialiser votre mot de passe. "
            f"Ce lien est valable {settings.reset_ttl_minutes} minutes et ne "
            f"fonctionne qu'une fois :\n\n{lien}\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : "
            "votre mot de passe reste inchangé."
        ),
    )
    _en_attente.append(message)
    return message


def _origine() -> str:
    """Première origine autorisée : celle du front."""
    return settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173"
