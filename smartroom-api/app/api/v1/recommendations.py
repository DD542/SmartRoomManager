"""Routes de recommandation et d'arbitrage."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.api.deps import (
    CONFLICTS_ARBITRATE,
    CurrentPrincipal,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas import (
    AlternativeOut,
    ArbitrationOut,
    ScoredRoomOut,
    SearchIn,
    SlotIn,
)
from app.core.errors import RuleViolationError
from app.db.enums import BookingStatus, RequestStatus
from app.domain.conflicts import arbitration_brief
from app.domain.types import ClaimantFile, SearchCriteria
from app.models import AccessRequest, Booking, User
from app.services import recommendation_service as reco
from app.services.availability_service import FUSEAU, load_rules, charger_salle
from app.api.v1.serializers import vitrines
from app.services.recommendation_service import load_user_profile

router = APIRouter(prefix="/recommendations", tags=["recommandation"])


def _criteres(payload: SearchIn) -> SearchCriteria:
    return SearchCriteria(
        slot=payload.slot.to_domain() if payload.slot else None,
        attendees=payload.attendees,
        building_id=payload.building_id,
        equipment_ids=frozenset(payload.equipment_ids),
        accessible_only=payload.accessible_only,
        equipment_strict=payload.equipment_strict,
    )


@router.post("", response_model=list[ScoredRoomOut], summary="Classer les salles")
def recommend(
    payload: SearchIn, session: SessionDep, principal: CurrentPrincipal
) -> list[ScoredRoomOut]:
    """Six critères pondérés, justification construite depuis les composantes."""
    classement = reco.rank_rooms(
        session, _criteres(payload), user_id=principal.user.id, limit=payload.limit
    )
    salles = vitrines(session, (item.room.id for item in classement))
    return [ScoredRoomOut.of(item, salles.get(item.room.id)) for item in classement]


@router.post("/best", response_model=ScoredRoomOut | None, summary="Meilleure salle")
def recommend_best(
    payload: SearchIn, session: SessionDep, principal: CurrentPrincipal
) -> ScoredRoomOut | None:
    """`null` plutôt qu'une liste vide : l'appelant veut une réponse, et
    « aucune salle ne convient » en est une."""
    meilleure = reco.best_room(session, _criteres(payload), user_id=principal.user.id)
    if meilleure is None:
        return None
    return ScoredRoomOut.of(
        meilleure, vitrines(session, [meilleure.room.id]).get(meilleure.room.id)
    )


@router.post(
    "/rooms/{room_id}/alternatives",
    response_model=list[AlternativeOut],
    summary="Alternatives à une salle prise",
)
def alternatives(
    room_id: uuid.UUID,
    payload: SearchIn,
    session: SessionDep,
    principal: CurrentPrincipal,
    limit: int = Query(default=5, ge=1, le=10),
) -> list[AlternativeOut]:
    if payload.slot is None:
        raise RuleViolationError(
            "Un créneau est nécessaire pour proposer une alternative.",
            code="creneau_requis",
        )

    propositions = reco.suggest_alternatives(
        session,
        room_id=room_id,
        slot=payload.slot.to_domain(),
        attendees=payload.attendees,
        user_id=principal.user.id,
        limit=limit,
    )
    return [AlternativeOut.of(item) for item in propositions]


@router.post(
    "/rooms/{room_id}/arbitration",
    response_model=ArbitrationOut,
    summary="Dossier d'arbitrage d'un créneau disputé",
    dependencies=[Depends(require_permission(CONFLICTS_ARBITRATE))],
)
def arbitration(
    room_id: uuid.UUID, payload: SlotIn, session: SessionDep
) -> ArbitrationOut:
    """Prétendants d'un créneau, triés par antériorité, critères exposés séparément.

    Le titulaire actuel figure parmi eux : arbitrer, c'est comparer une demande
    à une réservation existante, pas choisir entre deux demandes en l'air.
    """
    creneau = payload.to_domain()
    salle = charger_salle(session, room_id)
    regles = load_rules(session, salle)

    dossiers: list[ClaimantFile] = []

    titulaire = session.scalars(
        select(Booking).where(
            Booking.room_id == room_id,
            Booking.status != BookingStatus.ANNULEE,
            Booking.deleted_at.is_(None),
            Booking.owner_id.is_not(None),
            Booking.time_range.op("&&")(Range(creneau.start, creneau.end, bounds="[)")),
        )
    ).first()

    if titulaire is not None:
        dossiers.append(
            _dossier(
                session,
                titulaire.owner_id,
                titulaire.created_at,
                titulaire.id,
                regles.max_active_bookings,
            )
        )

    demandes = session.scalars(
        select(AccessRequest).where(
            AccessRequest.room_id == room_id,
            AccessRequest.status == RequestStatus.OUVERT,
        )
    ).all()
    for demande in demandes:
        dossiers.append(
            _dossier(
                session,
                demande.requester_id,
                demande.created_at,
                demande.booking_id,
                regles.max_active_bookings,
            )
        )

    return ArbitrationOut.of(arbitration_brief(creneau, room_id, dossiers, tz=FUSEAU))


def _dossier(session, user_id, requested_at, booking_id, quota) -> ClaimantFile:
    profil = load_user_profile(session, user_id)
    compte = session.get(User, user_id)
    return ClaimantFile(
        user_id=user_id,
        requested_at=requested_at,
        booking_id=booking_id,
        active_bookings=profil.active_bookings,
        max_active_bookings=quota,
        no_show_rate=profil.no_show_rate,
        display_name=f"{compte.first_name} {compte.last_name}",
    )
