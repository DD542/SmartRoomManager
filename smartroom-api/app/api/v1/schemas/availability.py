"""Schémas de disponibilité, de recommandation et d'arbitrage."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import Field

from app.api.v1.schemas.common import ApiModel, ReadModel, SlotIn, SlotOut
from app.domain.types import (
    Alternative,
    ArbitrationBrief,
    Conflict,
    RuleViolation,
    ScoredRoom,
)


class ViolationOut(ReadModel):
    code: str
    message: str
    forcible: bool

    @classmethod
    def of(cls, violation: RuleViolation) -> ViolationOut:
        return cls(
            code=violation.code.value,
            message=violation.message,
            forcible=violation.forcible,
        )


class ConflictOut(ReadModel):
    booking_id: uuid.UUID
    title: str
    slot: SlotOut
    kind: str
    overlap_minutes: int
    gap_minutes: int
    blocking: bool
    message: str

    @classmethod
    def of(cls, conflict: Conflict, message: str) -> ConflictOut:
        return cls(
            booking_id=conflict.existing.id,
            title=conflict.existing.title,
            slot=SlotOut.of(conflict.existing.slot),
            kind=conflict.kind.value,
            overlap_minutes=conflict.overlap_minutes,
            gap_minutes=conflict.gap_minutes,
            blocking=conflict.is_blocking,
            message=message,
        )


class SlotCheckOut(ReadModel):
    """Verdict complet. `forcible` distingue ce qu'un administrateur peut lever."""

    available: bool
    forcible: bool
    requires_validation: bool
    conflicts: list[ConflictOut] = Field(default_factory=list)
    violations: list[ViolationOut] = Field(default_factory=list)


class FreeSlotsOut(ReadModel):
    room_id: uuid.UUID
    first_day: date
    last_day: date
    slots: list[SlotOut] = Field(default_factory=list)


class RoomSummaryOut(ReadModel):
    id: uuid.UUID
    name: str
    capacity: int
    building_id: uuid.UUID
    floor_level: int
    equipment_ids: list[uuid.UUID] = Field(default_factory=list)
    is_accessible: bool
    is_available: bool
    occupancy_percent: int


class ScoreComponentOut(ReadModel):
    key: str
    label: str
    points: int
    max_points: int
    detail: str


class ScoredRoomOut(ReadModel):
    room: RoomSummaryOut
    score: int
    eligible: bool
    justification: str
    breakdown: list[ScoreComponentOut] = Field(default_factory=list)

    @classmethod
    def of(cls, propose: ScoredRoom) -> ScoredRoomOut:
        return cls(
            room=RoomSummaryOut(
                id=propose.room.id,
                name=propose.room.name,
                capacity=propose.room.capacity,
                building_id=propose.room.building_id,
                floor_level=propose.room.floor_level,
                equipment_ids=sorted(propose.room.equipment_ids),
                is_accessible=propose.room.is_accessible,
                is_available=propose.room.is_available,
                occupancy_percent=round(propose.room.occupancy_rate * 100),
            ),
            score=propose.score.total,
            eligible=propose.eligible,
            justification=propose.justification,
            breakdown=[
                ScoreComponentOut(
                    key=item.key,
                    label=item.label,
                    points=item.points,
                    max_points=item.max_points,
                    detail=item.detail,
                )
                for item in propose.score.components
            ],
        )


class AlternativeOut(ReadModel):
    kind: str
    room_id: uuid.UUID
    slot: SlotOut
    score: int
    justification: str

    @classmethod
    def of(cls, alternative: Alternative) -> AlternativeOut:
        return cls(
            kind=alternative.kind.value,
            room_id=alternative.room_id,
            slot=SlotOut.of(alternative.slot),
            score=alternative.score,
            justification=alternative.justification,
        )


class ArbitrationFactorOut(ReadModel):
    key: str
    label: str
    value: float
    detail: str
    favours: bool | None


class ClaimantOut(ReadModel):
    user_id: uuid.UUID
    display_name: str
    requested_at: datetime
    booking_id: uuid.UUID | None
    factors: list[ArbitrationFactorOut] = Field(default_factory=list)


class ArbitrationOut(ReadModel):
    """Dossier d'arbitrage. Aucun gagnant n'est désigné, la décision reste humaine."""

    room_id: uuid.UUID
    slot: SlotOut
    claimants: list[ClaimantOut] = Field(default_factory=list)

    @classmethod
    def of(cls, brief: ArbitrationBrief) -> ArbitrationOut:
        return cls(
            room_id=brief.room_id,
            slot=SlotOut.of(brief.slot),
            claimants=[
                ClaimantOut(
                    user_id=dossier.user_id,
                    display_name=dossier.display_name,
                    requested_at=dossier.requested_at,
                    booking_id=dossier.booking_id,
                    factors=[
                        ArbitrationFactorOut(
                            key=item.key,
                            label=item.label,
                            value=item.value,
                            detail=item.detail,
                            favours=item.favours,
                        )
                        for item in dossier.factors
                    ],
                )
                for dossier in brief.claimants
            ],
        )


class SearchIn(ApiModel):
    """Recherche multicritère. Le créneau est facultatif : sans lui, on classe le parc."""

    slot: SlotIn | None = None
    attendees: Annotated[int | None, Field(ge=1, le=500)] = None
    building_id: uuid.UUID | None = None
    equipment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    accessible_only: bool = False
    equipment_strict: bool = True
    limit: Annotated[int, Field(ge=1, le=50)] = 10


class SlotCheckIn(ApiModel):
    slot: SlotIn
    attendees: Annotated[int, Field(ge=1, le=500)] = 1
    #: Renseigné lors d'un déplacement : la réservation ne se conflictue pas
    #: avec sa propre position actuelle.
    ignore_booking_id: uuid.UUID | None = None


class CalendarEventOut(ReadModel):
    """Un événement au format attendu par FullCalendar.

    Les noms `title`, `start` et `end` sont ceux de la bibliothèque : les
    renommer imposerait un adaptateur côté front pour aucun gain.
    """

    id: uuid.UUID
    room_id: uuid.UUID
    room_name: str
    title: str
    start: datetime
    end: datetime
    status: str
    source: str
    is_mine: bool
    #: Vrai pour un blocage administratif : l'écran le grise au lieu de l'ouvrir.
    is_blocking: bool


class CalendarOut(ReadModel):
    """Chargement par plage visible : FullCalendar redemande à chaque navigation."""

    from_date: datetime
    to_date: datetime
    events: list[CalendarEventOut] = Field(default_factory=list)
    #: Créneaux fermés de la période, pour griser les plages non ouvrables.
    closed: list[SlotOut] = Field(default_factory=list)
