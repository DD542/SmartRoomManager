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
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import aiosmtplib
from jinja2 import TemplateError, meta
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

FUSEAU = ZoneInfo(settings.timezone)

_JOURS = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")
_MOIS = (
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)


def date_et_creneau(debut: datetime, fin: datetime) -> dict[str, str]:
    """`date` et `creneau` en français, en heure locale.

    Ici et non chez l'appelant : deux gabarits déclenchés par deux traitements
    différents parlent de la même réservation, et « jeudi 26 mars 2026 » d'un
    côté contre « 2026-03-26T14:00:00+01:00 » de l'autre se lit comme deux
    systèmes distincts.
    """
    local_debut = debut.astimezone(FUSEAU)
    local_fin = fin.astimezone(FUSEAU)
    return {
        "date": (
            f"{_JOURS[local_debut.weekday()]} {local_debut.day} "
            f"{_MOIS[local_debut.month - 1]} {local_debut.year}"
        ),
        "creneau": f"{local_debut:%H:%M} - {local_fin:%H:%M}",
    }


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
        # Le destinataire et l'objet, jamais le corps : un courriel de
        # confirmation porte le code d'accès de la porte, et le journal n'est
        # pas un endroit où le déposer.
        logger.info(
            "Courriel non envoyé (MAIL_ENABLED=false) → %s : %s",
            message.to,
            message.subject,
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

    # Aucune valeur d'exemple ici. Les seeder « pour ne rien laisser vide »
    # remplissait les trous avec la fiche de démonstration : le rappel avant
    # réunion annonçait à chaque utilisateur le code d'accès « A-4821 » et le
    # créneau « 14:00 - 15:30 », plausibles et faux. Un champ sans valeur reste
    # vide — visible, donc corrigeable. Les exemples servent à `preview`, qui
    # n'envoie rien.
    valeurs = {"prenom": user.first_name, "nom": user.last_name, **variables}
    _alerter_variables_manquantes(code, gabarit, valeurs)

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

    _deposer(Message(to=user.email, subject=titre, body=corps))
    return notification


def _alerter_variables_manquantes(
    code: str, gabarit: EmailTemplate, valeurs: dict[str, Any]
) -> None:
    """Journalise les variables que le gabarit attend et que l'appelant n'a pas.

    Un trou dans un courriel ne lève rien : il se lit chez le destinataire, des
    jours plus tard. Le signaler ici est le dernier moment où quelqu'un peut
    encore le voir.
    """
    attendues: set[str] = set()
    for source in (gabarit.subject, gabarit.body):
        try:
            attendues |= meta.find_undeclared_variables(JINJA.parse(source))
        except TemplateError:
            return
    manquantes = sorted(attendues - valeurs.keys())
    if manquantes:
        logger.warning(
            "Gabarit « %s » : variables sans valeur, rendues vides → %s",
            code,
            ", ".join(manquantes),
        )


#: Les envois sont différés hors de la transaction : expédier avant le COMMIT
#: annoncerait une réservation qu'un `ROLLBACK` ferait disparaître.
#:
#: La file est commune au processus, et les routes synchrones tournent dans un
#: pool de fils : le verrou garantit qu'une prise de file ne perde pas un
#: message déposé au même instant. Un message peut donc partir avec
#: l'expédition d'une autre requête — sans conséquence, chacun ayant son
#: propre destinataire.
_en_attente: list[Message] = []
_verrou = threading.Lock()


def pending() -> list[Message]:
    with _verrou:
        return list(_en_attente)


def flush() -> list[Message]:
    """Vide la file et rend les messages à expédier."""
    with _verrou:
        messages = list(_en_attente)
        del _en_attente[:]
    return messages


async def expedier() -> None:
    """Vide la file et remet chaque message au transport.

    Appelée après le COMMIT — en tâche de fond de la requête qui a écrit, et
    par l'ordonnanceur pour ce que produisent ses propres traitements. Sans
    cette seconde voie, une confirmation attendait le prochain passage de
    maintenance : cinq minutes par défaut, et rien du tout si l'ordonnanceur
    était arrêté.
    """
    for message in flush():
        await send(message)


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
    _deposer(message)
    return message


def lien_reservation(booking_id: Any) -> str:
    """Adresse de la réservation dans l'écran de gestion.

    Le chemin est celui du routeur du front, `/app/reservations/:id` : un
    courriel qui invite à « gérer sa réservation » et dépose sur une page
    inexistante ne vaut pas mieux qu'un courriel sans lien.
    """
    return f"{_origine()}/app/reservations/{booking_id}"


def queue_invitation(
    *,
    email: str,
    nom: str,
    organisateur: str,
    titre: str,
    salle: str,
    debut,
    fin,
    jeton: str,
) -> Message:
    """Prépare l'invitation d'un participant.

    Comme la réinitialisation de mot de passe, ce message ne passe pas par un
    gabarit modifiable, et pour la même raison : il porte le seul lien qui
    permet de répondre. Un gabarit désactivé par inadvertance — cas prévu et
    silencieux — rendrait toutes les invitations muettes, et l'organisateur
    n'apprendrait qu'en réunion que personne n'a été prévenu.

    Aucune notification applicative n'est écrite : un invité n'a pas
    nécessairement de compte, et `notify` exige un utilisateur.
    """
    lien = f"{_origine()}/invitation/{jeton}"
    horaire = date_et_creneau(debut, fin)

    return _deposer(
        Message(
            to=email,
            subject=f"{organisateur} vous invite : {titre}",
            body=(
                f"Bonjour {nom},\n\n"
                f"{organisateur} vous invite à « {titre} ».\n\n"
                f"Salle {salle}\n"
                f"{horaire['date']}, {horaire['creneau']}\n\n"
                "Pour accepter ou décliner :\n"
                f"{lien}\n\n"
                "Ce lien vous est personnel et cesse de fonctionner à la fin de la "
                "réunion — répondre à une réunion passée n'aurait aucun sens."
            ),
        )
    )


def _deposer(message: Message) -> Message:
    """Dépose un message dans la file, sous verrou."""
    with _verrou:
        _en_attente.append(message)
    return message


def _origine() -> str:
    """Première origine autorisée : celle du front."""
    return settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173"
