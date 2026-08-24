"""Demandes d'accès exceptionnel et leur arbitrage."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.api.deps import (
    CONFLICTS_ARBITRATE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas import (
    AccessRequestDecisionIn,
    AccessRequestIn,
    AccessRequestOut,
    SlotOut,
)
from app.core.errors import NotFoundError
from app.core.pagination import Page
from app.db.enums import RequestStatus
from app.domain.types import TimeSlot
from app.models import AccessRequest, AdminAccount
from app.services import access_request_service as service

router = APIRouter(tags=["demandes d'accès"])

Arbitrage = Depends(require_permission(CONFLICTS_ARBITRATE))


def _sortie(demande: AccessRequest) -> AccessRequestOut:
    return AccessRequestOut(
        id=demande.id,
        reference=demande.reference,
        requester_id=demande.requester_id,
        requester_name=f"{demande.requester.first_name} {demande.requester.last_name}",
        room_id=demande.room_id,
        room_name=demande.room.name,
        slot=SlotOut.of(
            TimeSlot(
                start=demande.requested_range.lower, end=demande.requested_range.upper
            )
        ),
        access_type=demande.access_type,
        reason=demande.reason,
        status=demande.status,
        decision_comment=demande.decision_comment,
        alternative_room_id=demande.alternative_room_id,
        alternative_room_name=(
            demande.alternative_room.name if demande.alternative_room else None
        ),
        booking_id=demande.booking_id,
        decided_at=demande.decided_at,
        created_at=demande.created_at,
    )


@router.get(
    "/access-requests",
    response_model=Page[AccessRequestOut],
    summary="Mes demandes d'accès",
    description=(
        "Les demandes du compte connecté. Le filtre de propriété est appliqué "
        "dans la requête, pas vérifié après chargement."
    ),
)
def list_mine(
    session: SessionDep,
    principal: CurrentPrincipal,
    params: PageDep,
    request_status: RequestStatus | None = None,
) -> Page[AccessRequestOut]:
    demandes, total = service.list_mine(
        session, params, user_id=principal.user.id, status=request_status
    )
    return Page.build([_sortie(item) for item in demandes], total, params)


@router.post(
    "/access-requests",
    response_model=AccessRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="Déposer une demande d'accès",
    description=(
        "Refusée si le créneau est en réalité disponible : il suffirait alors "
        "de le réserver. Le type de dérogation est déduit du motif de refus — "
        "l'utilisateur ne connaît pas la règle qui le bloque."
    ),
    responses={422: {"description": "Créneau disponible : réservez-le directement."}},
)
def create_request(
    payload: AccessRequestIn, session: SessionDep, principal: CurrentPrincipal
) -> AccessRequestOut:
    demande = service.create(
        session,
        requester_id=principal.user.id,
        room_id=payload.room_id,
        slot=payload.slot.to_domain(),
        reason=payload.reason,
    )
    session.commit()
    return _sortie(demande)


@router.get(
    "/access-requests/{request_id}",
    response_model=AccessRequestOut,
    summary="Détail d'une demande",
    description=(
        "Accessible au demandeur, ou à l'administration disposant du droit "
        "d'arbitrage. Un tiers reçoit 404, jamais 403 : l'existence d'une "
        "demande d'autrui ne se confirme pas."
    ),
)
def get_request(
    request_id: uuid.UUID, session: SessionDep, principal: CurrentPrincipal
) -> AccessRequestOut:
    demande = service.get(session, request_id)
    if demande.requester_id != principal.user.id and not principal.can(CONFLICTS_ARBITRATE):
        raise NotFoundError("Demande introuvable.")
    return _sortie(demande)


@router.get(
    "/admin/access-requests",
    response_model=Page[AccessRequestOut],
    summary="File d'arbitrage",
    description="Les demandes de tout le parc, les plus anciennes d'abord.",
)
def list_all(
    session: SessionDep,
    params: PageDep,
    _admin=Arbitrage,
    request_status: RequestStatus | None = None,
    room_id: uuid.UUID | None = None,
) -> Page[AccessRequestOut]:
    demandes, total = service.list_all(
        session, params, status=request_status, room_id=room_id
    )
    return Page.build([_sortie(item) for item in demandes], total, params)


@router.post(
    "/admin/access-requests/{request_id}/decide",
    response_model=AccessRequestOut,
    summary="Trancher une demande",
    description=(
        "Accorder crée la réservation dans la foulée, en forçant les règles : "
        "accorder sans réserver laisserait l'utilisateur devant un créneau "
        "toujours refusé. Le chevauchement, lui, reste hors d'atteinte — la "
        "contrainte de base le refuse quelle que soit la décision."
    ),
    responses={
        409: {"description": "Le créneau a été pris entre-temps."},
        422: {"description": "Demande déjà tranchée, ou réorientation sans salle."},
    },
)
def decide(
    request_id: uuid.UUID,
    payload: AccessRequestDecisionIn,
    session: SessionDep,
    admin: AdminAccount = Arbitrage,
) -> AccessRequestOut:
    demande = service.decide(
        session,
        request_id,
        decision=payload.decision,
        admin_user_id=admin.user_id,
        comment=payload.comment,
        alternative_room_id=payload.alternative_room_id,
    )
    session.commit()
    return _sortie(demande)
