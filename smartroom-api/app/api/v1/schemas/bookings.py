"""Schémas de réservation, de récurrence et d'administration."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated

from pydantic import Field, model_validator

from app.api.v1.schemas.common import ApiModel, ReadModel, SlotIn, SlotOut
from app.db.enums import RecurrenceFreq
from app.domain.types import TimeSlot


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
