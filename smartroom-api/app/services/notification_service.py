"""Notifications applicatives et gabarits de courriel.

Les notifications sont persistées : l'écran dédié doit pouvoir les relire, et
un utilisateur qui n'était pas connecté au moment de l'événement doit quand
même l'apprendre.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.core.pagination import PageParams, paginate
from app.db.enums import AuditAction
from app.models import EmailTemplate, EmailTemplateVariable, Notification
from app.services import audit_service, mail_service


#: Champs de tri acceptés. Sans liste blanche, `paginate` abandonne le tri
#: demandé au lieu de le refuser : l'écran afficherait un ordre qu'il n'a pas
#: demandé, en croyant l'avoir obtenu.
TRI_NOTIFICATIONS: dict[str, Any] = {
    "sent_at": Notification.sent_at,
    "title": Notification.title,
}


CHAMPS_GABARIT = ("code", "name", "trigger_label", "subject", "body", "is_enabled")


def list_for_user(
    session: Session,
    params: PageParams,
    *,
    user_id: uuid.UUID,
    unread_only: bool = False,
) -> tuple[list[Notification], int]:
    requete = (
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.sent_at.desc())
    )
    if unread_only:
        requete = requete.where(Notification.read_at.is_(None))
    return paginate(session, requete, params, colonnes=TRI_NOTIFICATIONS)


def unread_count(session: Session, user_id: uuid.UUID) -> int:
    """Compte les non lues. Un `COUNT`, jamais un chargement de la liste."""
    return session.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
    ) or 0


def mark_read(
    session: Session, notification_id: uuid.UUID, *, user_id: uuid.UUID
) -> Notification:
    """Marque une notification comme lue.

    La propriété est dans la requête : un identifiant d'autrui ne remonte
    simplement pas, et rend 404 sans confirmer son existence.
    """
    notification = session.scalars(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user_id
        )
    ).one_or_none()
    if notification is None:
        raise NotFoundError("Notification introuvable.")

    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        session.flush()
    return notification


def mark_all_read(session: Session, user_id: uuid.UUID) -> int:
    resultat = session.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    session.flush()
    return resultat.rowcount or 0


# --------------------------------------------------------------------------- #
# Gabarits de courriel
# --------------------------------------------------------------------------- #


def list_templates(session: Session) -> list[EmailTemplate]:
    return list(session.scalars(select(EmailTemplate).order_by(EmailTemplate.name)))


def get_template(session: Session, template_id: uuid.UUID) -> EmailTemplate:
    gabarit = session.get(EmailTemplate, template_id)
    if gabarit is None:
        raise NotFoundError("Gabarit introuvable.")
    return gabarit


def update_template(
    session: Session, template_id: uuid.UUID, payload: Any, *, admin_user_id: uuid.UUID
) -> EmailTemplate:
    """Modifie un gabarit, après avoir vérifié qu'il se rend.

    Un gabarit invalide enregistré casserait silencieusement toutes les
    notifications qui en dépendent : la validation a lieu avant l'écriture.
    """
    gabarit = get_template(session, template_id)
    avant = audit_service.snapshot(gabarit, CHAMPS_GABARIT)

    donnees = payload.model_dump(exclude_unset=True)
    valeurs = {item.code: item.sample_value for item in mail_service.known_variables(session)}
    for champ in ("subject", "body"):
        if champ in donnees:
            mail_service.render(donnees[champ], valeurs)

    for champ, valeur in donnees.items():
        setattr(gabarit, champ, valeur)
    gabarit.updated_by_admin_id = admin_user_id
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="email_template",
        target_label=gabarit.name,
        target_id=gabarit.id,
        before=avant,
        after=audit_service.snapshot(gabarit, CHAMPS_GABARIT),
    )
    session.flush()
    return gabarit


def set_template_state(
    session: Session, template_id: uuid.UUID, *, enabled: bool, admin_user_id: uuid.UUID
) -> EmailTemplate:
    gabarit = get_template(session, template_id)
    avant = gabarit.is_enabled

    gabarit.is_enabled = enabled
    gabarit.updated_by_admin_id = admin_user_id

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="email_template",
        target_label=gabarit.name,
        target_id=gabarit.id,
        before={"is_enabled": avant},
        after={"is_enabled": enabled},
    )
    session.flush()
    return gabarit


def template_variables(session: Session) -> list[EmailTemplateVariable]:
    return mail_service.known_variables(session)
