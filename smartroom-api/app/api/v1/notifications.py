"""Notifications applicatives et gabarits de courriel."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    SYSTEM_CONFIGURE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas.support import (
    EmailPreviewIn,
    EmailPreviewOut,
    EmailTemplateIn,
    EmailTemplateOut,
    EmailTemplateStateIn,
    EmailVariableOut,
    NotificationOut,
    NotificationReadIn,
)
from app.core.pagination import Page
from app.models import AdminAccount
from app.services import mail_service
from app.services import notification_service as service

router = APIRouter(tags=["notifications"])

Systeme = Depends(require_permission(SYSTEM_CONFIGURE))


@router.get(
    "/notifications",
    response_model=Page[NotificationOut],
    summary="Mes notifications",
    description=(
        "Les plus récentes d'abord. La propriété est appliquée dans la requête : "
        "aucune notification d'autrui n'est chargée puis filtrée."
    ),
)
def list_mine(
    session: SessionDep,
    principal: CurrentPrincipal,
    params: PageDep,
    unread_only: bool = False,
) -> Page[NotificationOut]:
    notifications, total = service.list_for_user(
        session, params, user_id=principal.user.id, unread_only=unread_only
    )
    return Page.build(
        [NotificationOut.model_validate(item) for item in notifications], total, params
    )


@router.get(
    "/notifications/unread-count",
    response_model=int,
    summary="Nombre de notifications non lues",
    description="Un `COUNT`, jamais un chargement de la liste : la pastille en a assez.",
)
def unread_count(session: SessionDep, principal: CurrentPrincipal) -> int:
    return service.unread_count(session, principal.user.id)


@router.patch(
    "/notifications/{notification_id}",
    response_model=NotificationOut,
    summary="Marquer une notification comme lue",
    responses={404: {"description": "Notification inconnue."}},
)
def mark_read(
    notification_id: uuid.UUID,
    payload: NotificationReadIn,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> NotificationOut:
    notification = service.mark_read(
        session, notification_id, user_id=principal.user.id
    )
    session.commit()
    return NotificationOut.model_validate(notification)


@router.post(
    "/notifications/read-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Tout marquer comme lu",
)
def mark_all_read(session: SessionDep, principal: CurrentPrincipal) -> None:
    service.mark_all_read(session, principal.user.id)
    session.commit()


# --------------------------------------------------------------------------- #
# Gabarits de courriel
# --------------------------------------------------------------------------- #


@router.get(
    "/admin/email-templates",
    response_model=list[EmailTemplateOut],
    summary="Gabarits de courriel",
    description="Modifiables sans redéploiement : ils vivent en base.",
)
def list_templates(session: SessionDep, _admin=Systeme) -> list[EmailTemplateOut]:
    return [EmailTemplateOut.model_validate(item) for item in service.list_templates(session)]


@router.get(
    "/admin/email-templates/variables",
    response_model=list[EmailVariableOut],
    summary="Variables disponibles dans les gabarits",
)
def template_variables(session: SessionDep, _admin=Systeme) -> list[EmailVariableOut]:
    return [
        EmailVariableOut.model_validate(item) for item in service.template_variables(session)
    ]


@router.get(
    "/admin/email-templates/{template_id}",
    response_model=EmailTemplateOut,
    summary="Détail d'un gabarit",
)
def get_template(
    template_id: uuid.UUID, session: SessionDep, _admin=Systeme
) -> EmailTemplateOut:
    return EmailTemplateOut.model_validate(service.get_template(session, template_id))


@router.patch(
    "/admin/email-templates/{template_id}",
    response_model=EmailTemplateOut,
    summary="Modifier un gabarit",
    description=(
        "Le rendu est vérifié avant l'écriture : un gabarit invalide enregistré "
        "casserait silencieusement toutes les notifications qui en dépendent."
    ),
    responses={422: {"description": "Gabarit invalide."}},
)
def update_template(
    template_id: uuid.UUID,
    payload: EmailTemplateIn,
    session: SessionDep,
    admin: AdminAccount = Systeme,
) -> EmailTemplateOut:
    gabarit = service.update_template(
        session, template_id, payload, admin_user_id=admin.user_id
    )
    session.commit()
    return EmailTemplateOut.model_validate(gabarit)


@router.patch(
    "/admin/email-templates/{template_id}/state",
    response_model=EmailTemplateOut,
    summary="Activer ou désactiver un gabarit",
    description=(
        "Un gabarit désactivé ne bloque aucune action : l'événement a lieu, "
        "seule la notification n'est pas envoyée."
    ),
)
def set_state(
    template_id: uuid.UUID,
    payload: EmailTemplateStateIn,
    session: SessionDep,
    admin: AdminAccount = Systeme,
) -> EmailTemplateOut:
    gabarit = service.set_template_state(
        session, template_id, enabled=payload.enabled, admin_user_id=admin.user_id
    )
    session.commit()
    return EmailTemplateOut.model_validate(gabarit)


@router.post(
    "/admin/email-templates/{template_id}/preview",
    response_model=EmailPreviewOut,
    summary="Prévisualiser un gabarit",
    description="Rendu avec les valeurs d'exemple, sans rien envoyer.",
    responses={422: {"description": "Gabarit invalide."}},
)
def preview_template(
    template_id: uuid.UUID,
    payload: EmailPreviewIn,
    session: SessionDep,
    _admin=Systeme,
) -> EmailPreviewOut:
    gabarit = service.get_template(session, template_id)
    message = mail_service.preview(session, gabarit.code, payload.variables)
    return EmailPreviewOut(to=message.to, subject=message.subject, body=message.body)
