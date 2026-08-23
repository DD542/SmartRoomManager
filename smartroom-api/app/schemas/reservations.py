"""Schémas du domaine réservation, règles et arbitrage."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated

from pydantic import Field, model_validator

from app.db.enums import (
    AccessType,
    BookingEventType,
    BookingSource,
    BookingStatus,
    ClosureKind,
    ParticipantResponse,
    RecurrenceFreq,
    RequestStatus,
    RuleScope,
)
from app.schemas.common import (
    ApiModel,
    Email,
    NonEmptyReason,
    ReadModel,
    TimeRange,
    TimestampedRead,
    Weekday,
)
from app.schemas.comptes import UserRead
from app.schemas.parc import RoomRead

# --------------------------------------------------------------------------- #
# Réservations
# --------------------------------------------------------------------------- #


class BookingParticipantIn(ApiModel):
    email: Email
    display_name: Annotated[str, Field(min_length=1, max_length=120)]
    user_id: uuid.UUID | None = None


class BookingParticipantRead(TimestampedRead):
    booking_id: uuid.UUID
    user_id: uuid.UUID | None
    email: str
    display_name: str
    response: ParticipantResponse
    is_organizer: bool
    responded_at: datetime | None


class BookingEventRead(TimestampedRead):
    booking_id: uuid.UUID
    event_type: BookingEventType
    label: str
    occurred_at: datetime


class BookingAccessCodeRead(ReadModel):
    """Le code n'est jamais renvoyé en clair : seul l'indice masqué circule."""

    code_hint: str
    issued_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class BookingCreate(ApiModel):
    room_id: uuid.UUID
    slot: TimeRange
    title: Annotated[str, Field(min_length=1, max_length=160)] = "Réunion"
    attendee_count: Annotated[int, Field(ge=1, le=500)]
    participants: list[BookingParticipantIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _participants_uniques(self) -> "BookingCreate":
        adresses = [item.email.lower() for item in self.participants]
        if len(adresses) != len(set(adresses)):
            raise ValueError("Un participant ne peut être invité qu'une fois.")
        return self


class AdminBookingCreate(BookingCreate):
    """Création par l'administration, pour le compte d'un utilisateur."""

    owner_id: uuid.UUID
    #: Lève les règles de durée, d'ouverture et de capacité. Jamais un conflit,
    #: que la contrainte EXCLUDE rend impossible quoi qu'il arrive.
    ignore_rules: bool = False


class BlockingCreate(ApiModel):
    """Blocage administratif : la salle devient indisponible, sans organisateur."""

    room_id: uuid.UUID
    slot: TimeRange
    reason: Annotated[str, Field(min_length=3, max_length=160)]


class BookingUpdate(ApiModel):
    slot: TimeRange | None = None
    title: Annotated[str | None, Field(min_length=1, max_length=160)] = None
    attendee_count: Annotated[int | None, Field(ge=1, le=500)] = None
    participants: list[BookingParticipantIn] | None = None


class BookingCancel(NonEmptyReason):
    notify_participants: bool = True


class BookingRead(TimestampedRead):
    room_id: uuid.UUID
    owner_id: uuid.UUID | None
    title: str
    starts_at: datetime
    ends_at: datetime
    attendee_count: int
    status: BookingStatus
    source: BookingSource
    is_forced: bool
    checked_in_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    room: RoomRead | None = None
    owner: UserRead | None = None

    @property
    def duration_minutes(self) -> int:
        return int((self.ends_at - self.starts_at).total_seconds() // 60)


class BookingDetailRead(BookingRead):
    participants: list[BookingParticipantRead] = Field(default_factory=list)
    events: list[BookingEventRead] = Field(default_factory=list)
    access_code: BookingAccessCodeRead | None = None


class BookingSearchParams(ApiModel):
    room_id: uuid.UUID | None = None
    building_id: uuid.UUID | None = None
    owner_id: uuid.UUID | None = None
    status: BookingStatus | None = None
    source: BookingSource | None = None
    from_date: datetime | None = None
    to_date: datetime | None = None
    query: Annotated[str | None, Field(max_length=120)] = None


# --------------------------------------------------------------------------- #
# Vérification de créneau — réponse du moteur de disponibilité
# --------------------------------------------------------------------------- #


class ConflictRead(ReadModel):
    """Un conflit détecté. `kind` distingue le recouvrement du battement."""

    booking_id: uuid.UUID
    kind: Annotated[str, Field(pattern=r"^(total|partiel|adjacent)$")]
    overlap_minutes: int
    gap_minutes: int
    blocking: bool
    message: str


class SlotCheckRead(ReadModel):
    available: bool
    #: Un chevauchement ne se force jamais ; règles et capacité, si.
    blocking: bool
    conflicts: list[ConflictRead] = Field(default_factory=list)
    rule_errors: list[str] = Field(default_factory=list)
    capacity_error: str | None = None
    closure_error: str | None = None


class RoomSuggestion(ReadModel):
    """Proposition du moteur de recommandation, score sur 100."""

    room: RoomRead
    score: Annotated[int, Field(ge=0, le=100)]
    justification: str
    eligible: bool


# --------------------------------------------------------------------------- #
# Récurrence
# --------------------------------------------------------------------------- #


class RecurrenceRuleCreate(ApiModel):
    room_id: uuid.UUID
    freq: RecurrenceFreq
    interval_count: Annotated[int, Field(ge=1, le=12)] = 1
    byweekday: Annotated[list[Weekday], Field(min_length=1, max_length=7)]
    start_date: date
    until_date: date
    start_time: time
    end_time: time
    title: Annotated[str, Field(min_length=1, max_length=160)] = "Réunion récurrente"
    attendee_count: Annotated[int, Field(ge=1, le=500)] = 1

    @model_validator(mode="after")
    def _serie_coherente(self) -> "RecurrenceRuleCreate":
        if self.until_date < self.start_date:
            raise ValueError("La date de fin précède la date de début.")
        if (self.until_date - self.start_date).days > 366:
            raise ValueError("Une série ne peut pas dépasser un an.")
        if self.end_time <= self.start_time:
            raise ValueError("L'heure de fin doit suivre l'heure de début.")
        if len(set(self.byweekday)) != len(self.byweekday):
            raise ValueError("Un jour de la semaine ne peut être listé qu'une fois.")
        return self


class RecurrenceRuleUpdate(ApiModel):
    until_date: date | None = None
    byweekday: Annotated[list[Weekday] | None, Field(min_length=1, max_length=7)] = None


class RecurrenceRuleRead(TimestampedRead):
    owner_id: uuid.UUID
    room_id: uuid.UUID
    freq: RecurrenceFreq
    interval_count: int
    byweekday: list[int]
    start_date: date
    until_date: date
    start_time: time
    end_time: time


class RecurrencePreview(ReadModel):
    """Aperçu des occurrences avant création : les conflits sont déjà résolus."""

    occurrences: list[TimeRange]
    conflicting: list[TimeRange] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Règles, horaires, fermetures
# --------------------------------------------------------------------------- #


class BookingRuleWrite(ApiModel):
    """Création et modification partagent la même forme : la portée est fixée
    à la création et ne se modifie pas — changer de cible, c'est une autre règle."""

    min_duration_min: Annotated[int, Field(ge=15, le=1440)] = 30
    max_duration_min: Annotated[int, Field(ge=30, le=1440)] = 240
    buffer_min: Annotated[int, Field(ge=0, le=120)] = 15
    max_advance_days: Annotated[int, Field(ge=1, le=365)] = 60
    cancel_deadline_min: Annotated[int, Field(ge=0, le=10080)] = 60
    checkin_window_min: Annotated[int, Field(ge=5, le=240)] = 10
    weekly_quota_hours: Annotated[int, Field(ge=0, le=168)] = 12
    max_active_bookings: Annotated[int, Field(ge=1, le=100)] = 10
    validation_capacity_threshold: Annotated[int | None, Field(ge=1, le=500)] = None

    @model_validator(mode="after")
    def _regles_coherentes(self) -> "BookingRuleWrite":
        if self.max_duration_min <= self.min_duration_min:
            raise ValueError("La durée maximale doit dépasser la durée minimale.")
        if self.weekly_quota_hours * 60 < self.max_duration_min:
            raise ValueError(
                "Le quota hebdomadaire est inférieur à la durée d'une seule réservation maximale."
            )
        return self


class BookingRuleCreate(BookingRuleWrite):
    scope: RuleScope
    building_id: uuid.UUID | None = None
    room_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _cible_conforme(self) -> "BookingRuleCreate":
        cibles = {
            RuleScope.GLOBAL: (self.building_id is None and self.room_id is None),
            RuleScope.BATIMENT: (self.building_id is not None and self.room_id is None),
            RuleScope.SALLE: (self.building_id is None and self.room_id is not None),
        }
        if not cibles[self.scope]:
            raise ValueError("La cible ne correspond pas à la portée déclarée.")
        return self


class BookingRuleRead(TimestampedRead, BookingRuleWrite):
    scope: RuleScope
    building_id: uuid.UUID | None
    room_id: uuid.UUID | None


class RuleImpactRead(ReadModel):
    """Phrases construites à partir des valeurs saisies, jamais figées."""

    resume: str
    quota: str
    battement: str
    avertissement: str


class OpeningHourWrite(ApiModel):
    weekday: Weekday
    is_open: bool = True
    opens_at: time
    closes_at: time

    @model_validator(mode="after")
    def _horaires_ordonnes(self) -> "OpeningHourWrite":
        if self.closes_at <= self.opens_at:
            raise ValueError("L'heure de fermeture doit suivre l'heure d'ouverture.")
        return self


class OpeningHourCreate(OpeningHourWrite):
    scope: RuleScope
    building_id: uuid.UUID | None = None
    room_id: uuid.UUID | None = None


class OpeningHourUpdate(ApiModel):
    is_open: bool | None = None
    opens_at: time | None = None
    closes_at: time | None = None


class OpeningHourRead(TimestampedRead, OpeningHourWrite):
    scope: RuleScope
    building_id: uuid.UUID | None
    room_id: uuid.UUID | None


class ClosurePeriodCreate(ApiModel):
    label: Annotated[str, Field(min_length=1, max_length=160)]
    from_date: date
    to_date: date
    kind: ClosureKind = ClosureKind.FERMETURE
    building_ids: list[uuid.UUID] = Field(default_factory=list)
    room_ids: list[uuid.UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def _portee_coherente(self) -> "ClosurePeriodCreate":
        if self.to_date < self.from_date:
            raise ValueError("La date de fin précède la date de début.")
        if self.building_ids and self.room_ids:
            raise ValueError("Une fermeture cible des bâtiments ou des salles, pas les deux.")
        return self

    @property
    def is_global(self) -> bool:
        return not self.building_ids and not self.room_ids


class ClosurePeriodUpdate(ApiModel):
    label: Annotated[str | None, Field(min_length=1, max_length=160)] = None
    from_date: date | None = None
    to_date: date | None = None
    kind: ClosureKind | None = None


class ClosurePeriodRead(TimestampedRead):
    label: str
    from_date: date
    to_date: date
    kind: ClosureKind
    is_global: bool
    building_ids: list[uuid.UUID] = Field(default_factory=list)
    room_ids: list[uuid.UUID] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# File d'arbitrage
# --------------------------------------------------------------------------- #


class AccessRequestCreate(ApiModel):
    room_id: uuid.UUID
    slot: TimeRange
    access_type: AccessType
    reason: Annotated[str | None, Field(max_length=2000)] = None
    booking_id: uuid.UUID | None = None


class AccessRequestDecision(ApiModel):
    status: RequestStatus
    comment: Annotated[str | None, Field(max_length=2000)] = None
    alternative_room_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _decision_complete(self) -> "AccessRequestDecision":
        if self.status is RequestStatus.OUVERT:
            raise ValueError("Une décision ne peut pas laisser la demande ouverte.")
        if self.status is RequestStatus.REORIENTE and self.alternative_room_id is None:
            raise ValueError("Une réorientation exige la salle proposée.")
        return self


class ClaimantRead(ReadModel):
    """Demandeur comparé dans l'arbitrage d'un conflit."""

    user_id: uuid.UUID
    name: str
    role: str | None
    starts_at: datetime
    ends_at: datetime
    requested_at: datetime
    monthly_bookings: int
    remaining_quota_h: int


class AccessRequestRead(TimestampedRead):
    reference: str
    requester_id: uuid.UUID
    room_id: uuid.UUID
    booking_id: uuid.UUID | None
    starts_at: datetime
    ends_at: datetime
    access_type: AccessType
    reason: str | None
    status: RequestStatus
    decision_comment: str | None
    alternative_room_id: uuid.UUID | None
    decided_at: datetime | None
    room: RoomRead | None = None
    requester: UserRead | None = None


class AccessRequestDetailRead(AccessRequestRead):
    claimants: list[ClaimantRead] = Field(default_factory=list)
    alternatives: list[RoomSuggestion] = Field(default_factory=list)
