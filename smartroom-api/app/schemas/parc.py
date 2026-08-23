"""Schémas du domaine parc."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated

from pydantic import Field, model_validator

from app.db.enums import EquipmentCategory, PlanDocumentKind, RoomStatus
from app.schemas.common import ApiModel, ReadModel, Slug, TimestampedRead

# --------------------------------------------------------------------------- #
# Bâtiments et étages
# --------------------------------------------------------------------------- #


class BuildingCreate(ApiModel):
    code: Annotated[str, Field(pattern=r"^[A-Z0-9]{1,4}$")]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    address: Annotated[str | None, Field(max_length=255)] = None
    sort_order: Annotated[int, Field(ge=0, le=999)] = 0


class BuildingUpdate(ApiModel):
    code: Annotated[str | None, Field(pattern=r"^[A-Z0-9]{1,4}$")] = None
    name: Annotated[str | None, Field(min_length=1, max_length=120)] = None
    address: Annotated[str | None, Field(max_length=255)] = None
    sort_order: Annotated[int | None, Field(ge=0, le=999)] = None


class BuildingRead(TimestampedRead):
    code: str
    name: str
    address: str | None
    sort_order: int


class FloorCreate(ApiModel):
    building_id: uuid.UUID
    code: Annotated[str, Field(min_length=1, max_length=8)]
    label: Annotated[str, Field(min_length=1, max_length=60)]
    level: Annotated[int, Field(ge=-5, le=60)]


class FloorUpdate(ApiModel):
    code: Annotated[str | None, Field(min_length=1, max_length=8)] = None
    label: Annotated[str | None, Field(min_length=1, max_length=60)] = None
    level: Annotated[int | None, Field(ge=-5, le=60)] = None


class FloorRead(TimestampedRead):
    building_id: uuid.UUID
    code: str
    label: str
    level: int
    building: BuildingRead | None = None


class FloorPlanRead(TimestampedRead):
    floor_id: uuid.UUID
    kind: PlanDocumentKind
    file_url: str
    file_name: str
    file_size_bytes: int


# --------------------------------------------------------------------------- #
# Équipements
# --------------------------------------------------------------------------- #


class EquipmentCreate(ApiModel):
    code: Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=40)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    category: EquipmentCategory
    icon: Annotated[str, Field(min_length=1, max_length=40)]
    description: Annotated[str | None, Field(max_length=255)] = None
    is_filterable: bool = False


class EquipmentUpdate(ApiModel):
    label: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    category: EquipmentCategory | None = None
    icon: Annotated[str | None, Field(min_length=1, max_length=40)] = None
    description: Annotated[str | None, Field(max_length=255)] = None
    is_filterable: bool | None = None


class EquipmentRead(TimestampedRead):
    code: str
    label: str
    category: EquipmentCategory
    icon: str
    description: str | None
    is_filterable: bool


class RoomEquipmentIn(ApiModel):
    equipment_id: uuid.UUID
    quantity: Annotated[int, Field(ge=1, le=50)] = 1


class RoomEquipmentRead(ReadModel):
    equipment_id: uuid.UUID
    quantity: int
    equipment: EquipmentRead | None = None


# --------------------------------------------------------------------------- #
# Salles
# --------------------------------------------------------------------------- #


class RoomPlacementIn(ApiModel):
    pos_x: Annotated[Decimal, Field(ge=0, le=100)]
    pos_y: Annotated[Decimal, Field(ge=0, le=100)]
    width: Annotated[Decimal, Field(gt=0, le=100)]
    height: Annotated[Decimal, Field(gt=0, le=100)]
    rotation: Annotated[int, Field(default=0)] = 0
    is_entrance_marked: bool = False

    @model_validator(mode="after")
    def _dans_le_cadre(self) -> "RoomPlacementIn":
        if self.rotation not in (0, 90, 180, 270):
            raise ValueError("La rotation vaut 0, 90, 180 ou 270 degrés.")
        if self.pos_x + self.width > 100 or self.pos_y + self.height > 100:
            raise ValueError("La salle dépasse du cadre du plan.")
        return self


class RoomPlacementRead(ReadModel):
    room_id: uuid.UUID
    pos_x: Decimal
    pos_y: Decimal
    width: Decimal
    height: Decimal
    rotation: int
    is_entrance_marked: bool


class RoomPhotoRead(TimestampedRead):
    room_id: uuid.UUID
    file_url: str
    alt_text: str | None
    position: int


class RoomCreate(ApiModel):
    floor_id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=120)]
    slug: Slug
    capacity: Annotated[int, Field(ge=1, le=500)]
    area_m2: Annotated[Decimal, Field(gt=0, le=5000)]
    status: RoomStatus = RoomStatus.DISPONIBLE
    is_accessible: bool = False
    badge_required: bool = True
    description: str | None = None
    equipments: list[RoomEquipmentIn] = Field(default_factory=list)

    @model_validator(mode="after")
    def _equipements_uniques(self) -> "RoomCreate":
        identifiants = [item.equipment_id for item in self.equipments]
        if len(identifiants) != len(set(identifiants)):
            raise ValueError("Un équipement ne peut être listé qu'une fois par salle.")
        return self


class RoomUpdate(ApiModel):
    floor_id: uuid.UUID | None = None
    name: Annotated[str | None, Field(min_length=1, max_length=120)] = None
    slug: Slug | None = None
    capacity: Annotated[int | None, Field(ge=1, le=500)] = None
    area_m2: Annotated[Decimal | None, Field(gt=0, le=5000)] = None
    status: RoomStatus | None = None
    is_accessible: bool | None = None
    badge_required: bool | None = None
    description: str | None = None
    equipments: list[RoomEquipmentIn] | None = None


class RoomRead(TimestampedRead):
    floor_id: uuid.UUID
    name: str
    slug: str
    capacity: int
    area_m2: Decimal
    status: RoomStatus
    is_accessible: bool
    badge_required: bool
    description: str | None
    floor: FloorRead | None = None
    photos: list[RoomPhotoRead] = Field(default_factory=list)
    room_equipments: list[RoomEquipmentRead] = Field(default_factory=list)
    placement: RoomPlacementRead | None = None


class RoomSearchParams(ApiModel):
    """Filtres de la recherche de salles (U-03 et A-05)."""

    building_id: uuid.UUID | None = None
    floor_id: uuid.UUID | None = None
    status: RoomStatus | None = None
    min_capacity: Annotated[int | None, Field(ge=1, le=500)] = None
    equipment_ids: list[uuid.UUID] = Field(default_factory=list)
    accessible_only: bool = False
    query: Annotated[str | None, Field(max_length=120)] = None
