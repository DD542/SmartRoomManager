"""Schémas des règles, horaires, fermetures et demandes d'accès."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Annotated

from pydantic import Field, field_validator, model_validator

from app.api.v1.schemas.common import ApiModel, ReadModel, SlotIn, SlotOut
from app.db.enums import AccessType, ClosureKind, RequestStatus, RuleScope


class BookingRuleIn(ApiModel):
    """Toutes les valeurs du sujet, configurables sans toucher au code."""

    min_duration_min: Annotated[int, Field(ge=15, le=1440)] = 30
    max_duration_min: Annotated[int, Field(ge=15, le=1440)] = 240
    buffer_min: Annotated[int, Field(ge=0, le=120)] = 15
    max_advance_days: Annotated[int, Field(ge=1, le=365)] = 60
    min_advance_min: Annotated[int, Field(ge=0, le=1440)] = 15
    cancel_deadline_min: Annotated[int, Field(ge=0, le=10080)] = 60
    checkin_window_min: Annotated[int, Field(ge=5, le=120)] = 10
    weekly_quota_hours: Annotated[int, Field(ge=1, le=168)] = 12
    max_active_bookings: Annotated[int, Field(ge=1, le=100)] = 10
    validation_capacity_threshold: Annotated[int | None, Field(ge=1, le=500)] = 20
    #: Consigne libre, affichée telle quelle dans le tunnel de réservation.
    #: 500 caractères : c'est un encadré, pas un règlement intérieur.
    notice: Annotated[str | None, Field(max_length=500)] = None

    @field_validator("notice", mode="after")
    @classmethod
    def _consigne_vide_vaut_aucune(cls, valeur: str | None) -> str | None:
        """Une consigne effacée vaut « aucune consigne », pas une chaîne vide.

        La base refuse le blanc — c'est ce qui empêche un encadré vierge dans
        le tunnel. Laisser remonter la chaîne vide jusqu'à elle transformerait
        un champ vidé en erreur 500 au lieu d'une suppression.
        """
        return valeur or None

    @model_validator(mode="after")
    def _durees_coherentes(self) -> BookingRuleIn:
        if self.max_duration_min < self.min_duration_min:
            raise ValueError("La durée maximale doit dépasser la durée minimale.")
        return self


class BookingRuleOut(ReadModel):
    id: uuid.UUID
    scope: RuleScope
    building_id: uuid.UUID | None
    room_id: uuid.UUID | None
    min_duration_min: int
    max_duration_min: int
    buffer_min: int
    max_advance_days: int
    min_advance_min: int
    cancel_deadline_min: int
    checkin_window_min: int
    weekly_quota_hours: int
    max_active_bookings: int
    validation_capacity_threshold: int | None
    notice: str | None = None


class RulePreviewOut(ReadModel):
    """Effet mesuré d'une règle sur l'historique récent, avant application."""

    examined: int
    too_short: int
    too_long: int
    would_need_validation: int
    window_days: int


class OpeningWindowIn(ApiModel):
    weekday: Annotated[
        int, Field(ge=0, le=6, description="0 = dimanche, comme EXTRACT(DOW)")
    ]
    is_open: bool = True
    opens_at: time
    closes_at: time


class OpeningWindowOut(ReadModel):
    id: uuid.UUID
    scope: RuleScope
    building_id: uuid.UUID | None
    room_id: uuid.UUID | None
    weekday: int
    is_open: bool
    opens_at: time
    closes_at: time


class ClosureIn(ApiModel):
    label: Annotated[str, Field(min_length=1, max_length=160)]
    first_day: date
    last_day: date
    kind: ClosureKind = ClosureKind.FERMETURE
    is_global: bool = True
    building_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    room_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def _periode_ordonnee(self) -> ClosureIn:
        if self.last_day < self.first_day:
            raise ValueError("La date de fin précède la date de début.")
        return self


class ClosureOut(ReadModel):
    id: uuid.UUID
    label: str
    first_day: date
    last_day: date
    kind: ClosureKind
    is_global: bool
    building_ids: list[uuid.UUID] = Field(default_factory=list)
    room_ids: list[uuid.UUID] = Field(default_factory=list)
    created_at: datetime


class AccessRequestIn(ApiModel):
    room_id: uuid.UUID
    slot: SlotIn
    reason: Annotated[str | None, Field(max_length=1000)] = None


class AccessRequestDecisionIn(ApiModel):
    decision: RequestStatus
    comment: Annotated[str | None, Field(max_length=1000)] = None
    alternative_room_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _decision_valide(self) -> AccessRequestDecisionIn:
        if self.decision is RequestStatus.OUVERT:
            raise ValueError("« ouvert » n'est pas une décision.")
        return self


class AccessRequestOut(ReadModel):
    id: uuid.UUID
    reference: str
    requester_id: uuid.UUID
    requester_name: str
    room_id: uuid.UUID
    room_name: str
    slot: SlotOut
    access_type: AccessType
    reason: str | None
    status: RequestStatus
    decision_comment: str | None
    alternative_room_id: uuid.UUID | None
    alternative_room_name: str | None
    booking_id: uuid.UUID | None
    decided_at: datetime | None
    created_at: datetime
