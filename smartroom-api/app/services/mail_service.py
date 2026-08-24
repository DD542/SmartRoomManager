"""Sortie des courriels.

Le rendu depuis les gabarits stockés en base et l'envoi SMTP arrivent au lot 4.
Ce module en pose la frontière dès maintenant : les services appellent
`queue_*`, et ce qui se passe derrière — journal, file, SMTP — ne les regarde
pas.

En local, `mail_enabled` est faux : les messages sont écrits dans le journal
plutôt qu'envoyés. Aucune boîte réelle ne reçoit les données du jeu de
démonstration.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import User

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass(frozen=True, slots=True)
class Message:
    """Un courriel prêt à partir, indépendant du transport."""

    to: str
    subject: str
    body: str


def send(message: Message) -> None:
    """Remet un message au transport.

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

    # Le transport SMTP asynchrone est branché au lot 4, avec le rendu des
    # gabarits. La frontière ne changera pas.
    logger.info("Courriel remis au transport → %s : %s", message.to, message.subject)


def queue_password_reset(session: Session, compte: User, jeton: str) -> Message:
    """Prépare le lien de réinitialisation.

    Le jeton n'apparaît que dans ce message : ni la base, ni le journal d'audit
    n'en gardent le clair.
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
    send(message)
    return message


def _origine() -> str:
    """Première origine autorisée : celle du front."""
    return settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173"
