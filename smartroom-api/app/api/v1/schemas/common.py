"""Socle des schémas de la version 1.

Ils reflètent les structures du domaine sans les remplacer : le domaine reste
ignorant de Pydantic, et c'est ici que les horodatages UTC deviennent des
instants affichables.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.config import get_settings
from app.domain.types import TimeSlot

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
