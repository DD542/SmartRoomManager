"""Routes de disponibilité : créneaux libres, recherche, vérification."""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Query

from app.api.deps import CurrentPrincipal, SessionDep
from app.api.v1.schemas import (
    ConflictOut,
    FreeSlotsOut,
    ScoredRoomOut,
    SearchIn,
    SlotCheckIn,
    SlotCheckOut,
    SlotOut,
    ViolationOut,
)
from app.core.errors import RuleViolationError
from app.domain.types import SearchCriteria
from app.services import availability_service as service
from app.services import recommendation_service as reco

router = APIRouter(prefix="/availability", tags=["disponibilité"])

#: Au-delà, le calcul reste rapide mais la réponse devient inexploitable côté écran.
PERIODE_MAX_JOURS = 31


@router.get(
    "/rooms/{room_id}/free-slots",
    response_model=FreeSlotsOut,
    summary="Créneaux libres d'une salle sur une période",
)
def free_slots(
    room_id: uuid.UUID,
    session: SessionDep,
    _: CurrentPrincipal,
    first_day: date = Query(..., description="Premier jour, en date locale"),
    last_day: date | None = None,
) -> FreeSlotsOut:
    """Les trous réellement réservables : occupation retranchée, battement
    appliqué, fermetures déduites, trous trop courts écartés."""
    fin = last_day or first_day
    if fin < first_day:
        raise RuleViolationError("Le dernier jour précède le premier.", code="periode")
    if (fin - first_day).days + 1 > PERIODE_MAX_JOURS:
        raise RuleViolationError(
            f"Période trop longue : {PERIODE_MAX_JOURS} jours au maximum.", code="periode"
        )

    trous = service.free_slots(session, room_id, first_day, fin)
    return FreeSlotsOut(
        room_id=room_id,
        first_day=first_day,
        last_day=fin,
        slots=[SlotOut.of(item) for item in trous],
    )


@router.post(
    "/rooms/{room_id}/check",
    response_model=SlotCheckOut,
    summary="Réservabilité d'un créneau précis",
)
def check(
    room_id: uuid.UUID,
    payload: SlotCheckIn,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> SlotCheckOut:
    """Vérifie sans rien écrire, et renvoie la liste des règles violées.

    Le quota est évalué pour le compte connecté : c'est le sien qui se consomme.
    """
    rapport = service.check_slot(
        session,
        room_id=room_id,
        slot=payload.slot.to_domain(),
        attendees=payload.attendees,
        requester_id=principal.user.id,
        ignore_booking_id=payload.ignore_booking_id,
    )
    return _rapport(rapport)


@router.post(
    "/search",
    response_model=list[ScoredRoomOut],
    summary="Recherche multicritère de salles",
)
def search(
    payload: SearchIn, session: SessionDep, principal: CurrentPrincipal
) -> list[ScoredRoomOut]:
    """Une requête SQL filtrante, puis un classement en mémoire.

    Les salles occupées sur le créneau restent dans la réponse, marquées : sans
    cela, l'utilisateur ne comprendrait pas l'absence de la salle qu'il visait.
    """
    criteres = SearchCriteria(
        slot=payload.slot.to_domain() if payload.slot else None,
        attendees=payload.attendees,
        building_id=payload.building_id,
        equipment_ids=frozenset(payload.equipment_ids),
        accessible_only=payload.accessible_only,
        equipment_strict=payload.equipment_strict,
    )
    classement = reco.rank_rooms(
        session, criteres, user_id=principal.user.id, limit=payload.limit
    )
    return [ScoredRoomOut.of(item) for item in classement]


def _rapport(rapport: service.SlotReport) -> SlotCheckOut:
    messages = service.describe_conflicts(rapport.conflicts)
    return SlotCheckOut(
        available=rapport.available,
        forcible=rapport.forcible,
        requires_validation=rapport.requires_validation,
        conflicts=[
            ConflictOut.of(conflit, message)
            for conflit, message in zip(rapport.conflicts, messages, strict=True)
        ],
        violations=[ViolationOut.of(item) for item in rapport.violations],
    )
