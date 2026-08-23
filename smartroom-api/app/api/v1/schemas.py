"""Schémas de la version 1 de l'API.

Ils reflètent les structures du domaine sans les remplacer : le domaine reste
ignorant de Pydantic, et c'est ici que les horodatages UTC deviennent des
instants affichables et que les durées deviennent des minutes.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.config import get_settings
from app.db.enums import RecurrenceFreq
from app.domain.types import (
    Alternative,
    ArbitrationBrief,
    Conflict,
    RuleViolation,
    ScoredRoom,
    TimeSlot,
)

FUSEAU = ZoneInfo(get_settings().timezone)


class ApiModel(BaseModel):
    """Entrées : les champs inconnus sont refusés plutôt qu'ignorés."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReadModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SlotIn(ApiModel):
    """Créneau reçu du client. Un fuseau est exigé : sans lui, l'instant est ambigu."""

    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def _bornes(self) -> SlotIn:
        for nom, borne in (("starts_at", self.starts_at), ("ends_at", self.ends_at)):
            if borne.tzinfo is None:
                raise ValueError(f"« {nom} » doit porter un décalage horaire.")
        if self.ends_at <= self.starts_at:
            raise ValueError("La fin du créneau doit suivre son début.")
        return self

    def to_domain(self) -> TimeSlot:
        return TimeSlot(start=self.starts_at, end=self.ends_at)


class SlotOut(ReadModel):
    """Créneau renvoyé : l'instant UTC, plus son écriture locale prête à afficher."""

    starts_at: datetime
    ends_at: datetime
    duration_minutes: int
    local_label: str

    @classmethod
    def of(cls, slot: TimeSlot) -> SlotOut:
        debut = slot.start.astimezone(FUSEAU)
        fin = slot.end.astimezone(FUSEAU)
        return cls(
            starts_at=slot.start,
            ends_at=slot.end,
            duration_minutes=int(slot.duration.total_seconds() // 60),
            local_label=f"{debut:%d/%m %H:%M}–{fin:%H:%M}",
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


class RoomOut(ReadModel):
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
    room: RoomOut
    score: int
    eligible: bool
    justification: str
    breakdown: list[ScoreComponentOut] = Field(default_factory=list)

    @classmethod
    def of(cls, propose: ScoredRoom) -> ScoredRoomOut:
        return cls(
            room=RoomOut(
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


class BookingIn(ApiModel):
    room_id: uuid.UUID
    slot: SlotIn
    title: Annotated[str, Field(min_length=1, max_length=160)] = "Réunion"
    attendees: Annotated[int, Field(ge=1, le=500)] = 1
    participants: list[tuple[str, str]] = Field(default_factory=list, max_length=50)


class BookingPatchIn(ApiModel):
    slot: SlotIn | None = None
    title: Annotated[str | None, Field(min_length=1, max_length=160)] = None
    attendees: Annotated[int | None, Field(ge=1, le=500)] = None


class CancelIn(ApiModel):
    reason: Annotated[str, Field(min_length=3, max_length=255)]


class CheckInIn(ApiModel):
    code: Annotated[str, Field(min_length=1, max_length=20)] = ""


class AccessCodeOut(ReadModel):
    code: str
    hint: str
    expires_at: datetime


class BookingOut(ReadModel):
    id: uuid.UUID
    room_id: uuid.UUID
    owner_id: uuid.UUID | None
    title: str
    slot: SlotOut
    attendees: int
    status: str
    source: str
    is_forced: bool
    checked_in_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None

    @classmethod
    def of(cls, reservation) -> BookingOut:
        return cls(
            id=reservation.id,
            room_id=reservation.room_id,
            owner_id=reservation.owner_id,
            title=reservation.title,
            slot=SlotOut.of(
                TimeSlot(start=reservation.time_range.lower, end=reservation.time_range.upper)
            ),
            attendees=reservation.attendee_count,
            status=reservation.status.value,
            source=reservation.source.value,
            is_forced=reservation.is_forced,
            checked_in_at=reservation.checked_in_at,
            cancelled_at=reservation.cancelled_at,
            cancel_reason=reservation.cancel_reason,
        )


class BookingCreatedOut(ReadModel):
    booking: BookingOut
    access_code: AccessCodeOut | None = None


class AdminBookingIn(BookingIn):
    """Création par l'administration, pour le compte d'un utilisateur."""

    owner_id: uuid.UUID
    #: Lève les règles de durée, d'ouverture, de capacité et de quota. Jamais un
    #: conflit, que la contrainte EXCLUDE rend impossible quoi qu'il arrive.
    ignore_rules: bool = False


class BlockingIn(ApiModel):
    room_id: uuid.UUID
    slot: SlotIn
    reason: Annotated[str, Field(min_length=3, max_length=160)]


class MaintenanceOut(ReadModel):
    """Bilan d'un passage de la tâche de maintenance."""

    released: int
    closed: int
    ran_at: datetime


class RecurrenceIn(ApiModel):
    """Série récurrente. Les heures sont locales : une série à 14:00 reste à
    14:00 des deux côtés du changement d'heure."""

    room_id: uuid.UUID
    freq: RecurrenceFreq
    interval_count: Annotated[int, Field(ge=1, le=12)] = 1
    byweekday: Annotated[list[int], Field(min_length=1, max_length=7)]
    start_date: date
    until_date: date
    start_time: time
    end_time: time
    title: Annotated[str, Field(min_length=1, max_length=160)] = "Réunion récurrente"
    attendees: Annotated[int, Field(ge=1, le=500)] = 1

    @model_validator(mode="after")
    def _serie_coherente(self) -> RecurrenceIn:
        if self.until_date < self.start_date:
            raise ValueError("La date de fin précède la date de début.")
        if (self.until_date - self.start_date).days > 366:
            raise ValueError("Une série ne peut pas dépasser un an.")
        if self.end_time <= self.start_time:
            raise ValueError("L'heure de fin doit suivre l'heure de début.")
        if any(not 0 <= jour <= 6 for jour in self.byweekday):
            raise ValueError("Le jour de semaine va de 0 (dimanche) à 6 (samedi).")
        if len(set(self.byweekday)) != len(self.byweekday):
            raise ValueError("Un jour de la semaine ne peut être listé qu'une fois.")
        return self


class OccurrenceOut(ReadModel):
    slot: SlotOut
    accepted: bool
    reason: str | None = None


class SeriesPreviewOut(ReadModel):
    occurrences: list[OccurrenceOut] = Field(default_factory=list)
    accepted_count: int
    rejected_count: int


class SeriesCreatedOut(ReadModel):
    rule_id: uuid.UUID
    bookings: list[BookingOut] = Field(default_factory=list)
    #: Dates écartées : la série passe quand même, l'utilisateur voit ce qui manque.
    skipped: list[OccurrenceOut] = Field(default_factory=list)
