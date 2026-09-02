"""Socle des schémas Pydantic v2.

Trois familles par entité exposée :
  - `…Create` : ce que le client envoie pour créer, sans identifiant ni horodatage ;
  - `…Update` : tous les champs facultatifs, seuls les champs fournis sont appliqués ;
  - `…Read`   : ce que l'API renvoie, construit depuis l'objet ORM.

La validation portée ici est **structurelle** : format, bornes, cohérence entre
deux champs d'une même charge utile. Tout ce qui exige de lire la base — conflit
de créneau, quota hebdomadaire, permission — relève du service métier, jamais du
schéma.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ApiModel(BaseModel):
    """Base commune : refuse les champs inconnus plutôt que de les ignorer."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReadModel(BaseModel):
    """Base des schémas de sortie, construits depuis les objets ORM."""

    model_config = ConfigDict(from_attributes=True)


class TimestampedRead(ReadModel):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------------- #
# Types réutilisés
# --------------------------------------------------------------------------- #

Slug = Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=160)]
Email = Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)]
PermissionCode = Annotated[str, Field(pattern=r"^[a-z]+\.[a-z]+$", max_length=40)]
Weekday = Annotated[
    int, Field(ge=0, le=6, description="0 = dimanche, comme EXTRACT(DOW)")
]


class TimeRange(ApiModel):
    """Créneau transmis par le client, image du TSTZRANGE stocké.

    Les bornes sont exposées séparément car un intervalle PostgreSQL ne se
    sérialise pas naturellement en JSON ; la conversion se fait dans le service.
    """

    starts_at: datetime
    ends_at: datetime

    @model_validator(mode="after")
    def _bornes_ordonnees(self) -> "TimeRange":
        if self.ends_at <= self.starts_at:
            raise ValueError("La fin du créneau doit suivre son début.")
        return self

    @property
    def duration_minutes(self) -> int:
        return int((self.ends_at - self.starts_at).total_seconds() // 60)


class DateSpan(ApiModel):
    """Période de fermeture, bornes incluses côté client."""

    from_date: Annotated[datetime, Field(alias="from")]
    to_date: Annotated[datetime, Field(alias="to")]

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="after")
    def _dates_ordonnees(self) -> "DateSpan":
        if self.to_date < self.from_date:
            raise ValueError("La date de fin précède la date de début.")
        return self


# --------------------------------------------------------------------------- #
# Pagination
# --------------------------------------------------------------------------- #

T = TypeVar("T")


class PageParams(ApiModel):
    page: Annotated[int, Field(ge=1)] = 1
    size: Annotated[int, Field(ge=1, le=100)] = 20

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


class Page(BaseModel, Generic[T]):
    """Enveloppe de liste paginée, identique pour toutes les ressources."""

    model_config = ConfigDict(from_attributes=True)

    items: list[T]
    total: int
    page: int
    size: int

    @property
    def pages(self) -> int:
        return max(1, -(-self.total // self.size))


class NonEmptyReason(ApiModel):
    """Motif obligatoire : annulation, refus, blocage."""

    reason: Annotated[str, Field(min_length=3, max_length=255)]

    @field_validator("reason")
    @classmethod
    def _non_vide(cls, valeur: str) -> str:
        if not valeur.strip():
            raise ValueError("Le motif est obligatoire.")
        return valeur
