"""Recommandation de salles : classer, proposer la meilleure, proposer autre chose.

Trois usages, trois routes. Le classement complet alimente la recherche U-03,
la meilleure salle alimente le tableau de bord et le chatbot, les alternatives
alimentent l'arbitrage d'une demande d'accès.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy.dialects.postgresql import Range

from app.api.deps import CurrentPrincipal, SessionDep
from app.core.config import get_settings
from app.core.errors import RuleViolationError
from app.schemas.parc import RoomRead
from app.schemas.reservations import RecommendationNeed, RoomSuggestion, ScoreCriterion
from app.services.recommendation import (
    Need,
    Suggestion,
    best_room,
    rank_rooms,
    suggest_alternatives,
)

router = APIRouter(prefix="/recommendations", tags=["recommandation"])

FUSEAU = ZoneInfo(get_settings().timezone)


def _besoin(payload: RecommendationNeed) -> Need:
    creneau = (
        None
        if payload.slot is None
        else Range(
            payload.slot.starts_at.astimezone(FUSEAU),
            payload.slot.ends_at.astimezone(FUSEAU),
            bounds="[)",
        )
    )
    return Need(
        creneau=creneau,
        attendee_count=payload.attendee_count,
        equipment_ids=tuple(payload.equipment_ids),
        building_id=payload.building_id,
        accessible=payload.accessible,
        include_maintenance=payload.include_maintenance,
    )


def _sortie(suggestion: Suggestion) -> RoomSuggestion:
    return RoomSuggestion(
        room=RoomRead.model_validate(suggestion.room),
        score=suggestion.score,
        justification=suggestion.justification,
        eligible=suggestion.eligible,
        occupancy_percent=suggestion.occupancy_percent,
        breakdown=[
            ScoreCriterion(
                key=critere.key,
                label=critere.label,
                points=critere.points,
                max_points=critere.max_points,
                detail=critere.detail,
            )
            for critere in suggestion.breakdown
        ],
    )


@router.post("", response_model=list[RoomSuggestion], summary="Classer les salles")
def recommend(
    payload: RecommendationNeed, session: SessionDep, _: CurrentPrincipal
) -> list[RoomSuggestion]:
    """Classement complet : éligibles d'abord, score décroissant.

    Les salles écartées restent dans la réponse, marquées, avec le motif dans
    leur justification — l'écran affiche « à capacité juste » plutôt que de les
    faire disparaître sans explication.
    """
    return [
        _sortie(item) for item in rank_rooms(session, _besoin(payload), limit=payload.limit)
    ]


@router.post("/best", response_model=RoomSuggestion | None, summary="Meilleure salle")
def recommend_best(
    payload: RecommendationNeed, session: SessionDep, _: CurrentPrincipal
) -> RoomSuggestion | None:
    """La meilleure salle réellement réservable, ou `null` s'il n'y en a aucune.

    Renvoyer `null` plutôt qu'une liste vide : l'appelant veut une réponse, et
    « aucune salle ne convient » est une réponse.
    """
    meilleure = best_room(session, _besoin(payload))
    return None if meilleure is None else _sortie(meilleure)


@router.post(
    "/alternatives/{room_id}",
    response_model=list[RoomSuggestion],
    summary="Alternatives à une salle prise",
)
def alternatives(
    room_id: uuid.UUID,
    payload: RecommendationNeed,
    session: SessionDep,
    _: CurrentPrincipal,
    limit: int = Query(default=3, ge=1, le=10),
) -> list[RoomSuggestion]:
    """À créneau constant, que proposer d'autre ?

    Le besoin est déduit de la salle visée — capacité, équipements, bâtiment —
    parce que c'est le meilleur portrait de ce que l'utilisateur cherchait. Le
    créneau, lui, reste celui de la demande : c'est tout l'intérêt.
    """
    if payload.slot is None:
        raise RuleViolationError(
            "Un créneau est nécessaire pour proposer une alternative.", code="creneau_requis"
        )

    creneau: Range[datetime] = Range(
        payload.slot.starts_at.astimezone(FUSEAU),
        payload.slot.ends_at.astimezone(FUSEAU),
        bounds="[)",
    )
    return [
        _sortie(item)
        for item in suggest_alternatives(
            session,
            room_id=room_id,
            creneau=creneau,
            attendee_count=payload.attendee_count,
            limit=limit,
        )
    ]
