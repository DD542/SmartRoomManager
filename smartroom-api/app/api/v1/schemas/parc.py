"""Schémas du parc : bâtiments, étages, plans, salles, équipements.

Les noms de champs reprennent ceux qu'attendent déjà les composants du front.
Là où le modèle relationnel diffère — un lien `room_equipments` porteur d'une
quantité, là où l'écran veut une liste d'équipements — la mise à plat se fait
ici, jamais dans le composant.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Base64Bytes, Field, field_validator, model_validator

from app.api.v1.schemas.common import ApiModel, ReadModel
from app.db.enums import EquipmentCategory, PlanDocumentKind, RoomStatus

Slug = Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=160)]
CodeBatiment = Annotated[str, Field(pattern=r"^[A-Z0-9]{1,4}$")]
CodeEquipement = Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=40)]


# --------------------------------------------------------------------------- #
# Bâtiments et étages
# --------------------------------------------------------------------------- #


class BuildingIn(ApiModel):
    code: CodeBatiment = Field(examples=["A"])
    name: Annotated[str, Field(min_length=1, max_length=120)] = Field(
        examples=["Campus Eiffel"]
    )
    address: Annotated[str | None, Field(max_length=255)] = None
    sort_order: Annotated[int, Field(ge=0, le=999)] = 0


class BuildingOut(ReadModel):
    id: uuid.UUID
    code: str
    name: str
    address: str | None
    sort_order: int
    floor_count: int = 0
    room_count: int = 0


class FloorIn(ApiModel):
    building_id: uuid.UUID
    code: Annotated[str, Field(min_length=1, max_length=8)] = Field(examples=["R2"])
    label: Annotated[str, Field(min_length=1, max_length=60)] = Field(
        examples=["2e étage"]
    )
    level: Annotated[int, Field(ge=-5, le=50)]


class FloorOut(ReadModel):
    id: uuid.UUID
    building_id: uuid.UUID
    code: str
    label: str
    level: int
    room_count: int = 0


class PhotoOrderIn(ApiModel):
    """Ordre voulu des photos, la première servant de couverture.

    Liste complète : réordonner à partir d'un sous-ensemble laisserait les
    photos absentes sur des positions arbitraires, et la salle perdrait
    silencieusement des visuels.
    """

    photo_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=6)]


class UploadIn(ApiModel):
    """Fichier déposé, encodé en base64 dans le corps JSON.

    Le multipart demanderait `python-multipart`, hors de la liste de
    dépendances arrêtée. Le surcoût de l'encodage — un tiers — reste supportable
    pour des fichiers plafonnés à 5 Mo, et le corps reste homogène avec le
    reste de l'API.
    """

    file_name: Annotated[str, Field(min_length=1, max_length=160)]
    content_type: Annotated[str, Field(min_length=3, max_length=100)]
    content: Base64Bytes
    alt_text: Annotated[str | None, Field(max_length=160)] = None


class FloorPlanOut(ReadModel):
    id: uuid.UUID
    floor_id: uuid.UUID
    kind: PlanDocumentKind
    file_url: str
    file_name: str
    file_size_bytes: int
    uploaded_at: datetime


class PlacementIn(ApiModel):
    """Position d'une salle sur le plan, en pourcentage de la surface.

    Des coordonnées relatives survivent au remplacement du plan par une image
    de dimensions différentes, ce que des pixels ne feraient pas.
    """

    room_id: uuid.UUID
    pos_x: Annotated[Decimal, Field(ge=0, le=100)]
    pos_y: Annotated[Decimal, Field(ge=0, le=100)]
    width: Annotated[Decimal, Field(gt=0, le=100)]
    height: Annotated[Decimal, Field(gt=0, le=100)]
    rotation: Annotated[int, Field(ge=0, le=359)] = 0
    is_entrance_marked: bool = False

    @model_validator(mode="after")
    def _dans_le_plan(self) -> PlacementIn:
        if self.pos_x + self.width > 100 or self.pos_y + self.height > 100:
            raise ValueError("La salle déborde du plan.")
        return self


class RoomPlacementOut(ReadModel):
    room_id: uuid.UUID
    pos_x: Decimal
    pos_y: Decimal
    width: Decimal
    height: Decimal
    rotation: int
    is_entrance_marked: bool


# --------------------------------------------------------------------------- #
# Équipements
# --------------------------------------------------------------------------- #


class EquipmentIn(ApiModel):
    code: CodeEquipement = Field(examples=["videoprojecteur"])
    label: Annotated[str, Field(min_length=1, max_length=80)] = Field(
        examples=["Vidéoprojecteur"]
    )
    category: EquipmentCategory
    icon: Annotated[str, Field(min_length=1, max_length=40)] = Field(examples=["projector"])
    description: Annotated[str | None, Field(max_length=255)] = None
    is_filterable: bool = True


class EquipmentOut(ReadModel):
    id: uuid.UUID
    code: str
    label: str
    category: EquipmentCategory
    icon: str
    description: str | None
    is_filterable: bool
    room_count: int = 0


class RoomEquipmentIn(ApiModel):
    equipment_id: uuid.UUID
    quantity: Annotated[int, Field(ge=1, le=99)] = 1


class RoomEquipmentOut(ReadModel):
    equipment_id: uuid.UUID
    code: str
    label: str
    category: EquipmentCategory
    icon: str
    quantity: int


# --------------------------------------------------------------------------- #
# Salles
# --------------------------------------------------------------------------- #


class RoomPhotoOut(ReadModel):
    id: uuid.UUID
    file_url: str
    alt_text: str | None
    position: int


class RoomIn(ApiModel):
    floor_id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=120)] = Field(
        examples=["Salle Vinci"]
    )
    slug: Slug | None = None
    capacity: Annotated[int, Field(ge=1, le=500)]
    area_m2: Annotated[Decimal, Field(gt=0, le=9999)]
    status: RoomStatus = RoomStatus.DISPONIBLE
    is_accessible: bool = False
    badge_required: bool = False
    description: Annotated[str | None, Field(max_length=1000)] = None
    equipments: list[RoomEquipmentIn] = Field(default_factory=list, max_length=30)

    @field_validator("equipments")
    @classmethod
    def _sans_doublon(cls, valeur: list[RoomEquipmentIn]) -> list[RoomEquipmentIn]:
        identifiants = [item.equipment_id for item in valeur]
        if len(identifiants) != len(set(identifiants)):
            raise ValueError("Un équipement ne peut être listé qu'une fois.")
        return valeur


class RoomPatchIn(ApiModel):
    """Modification partielle : seuls les champs fournis sont appliqués.

    `floor_id` en fait partie : déménager une salle d'un étage à l'autre arrive,
    et n'est pas la même chose que la recréer.
    """

    floor_id: uuid.UUID | None = None
    name: Annotated[str | None, Field(min_length=1, max_length=120)] = None
    capacity: Annotated[int | None, Field(ge=1, le=500)] = None
    area_m2: Annotated[Decimal | None, Field(gt=0, le=9999)] = None
    status: RoomStatus | None = None
    is_accessible: bool | None = None
    badge_required: bool | None = None
    description: Annotated[str | None, Field(max_length=1000)] = None
    #: Liste complète : elle remplace l'équipement de la salle, ne s'y ajoute pas.
    equipments: list[RoomEquipmentIn] | None = None


class RoomOut(ReadModel):
    id: uuid.UUID
    floor_id: uuid.UUID
    building_id: uuid.UUID
    building_name: str
    floor_label: str
    floor_level: int
    name: str
    slug: str
    capacity: int
    area_m2: Decimal
    status: RoomStatus
    is_accessible: bool
    badge_required: bool
    description: str | None
    equipments: list[RoomEquipmentOut] = Field(default_factory=list)
    photos: list[RoomPhotoOut] = Field(default_factory=list)
    placement: RoomPlacementOut | None = None
    #: Occupation moyenne des trente derniers jours, lue dans la vue
    #: matérialisée qui alimente déjà les tableaux de bord. La recalculer
    #: ailleurs donnerait un second chiffre, et deux écrans afficheraient deux
    #: occupations différentes pour la même salle.
    occupancy_percent: int = 0
    #: Réservations actives de la salle. Portée ici et non lue depuis
    #: `/admin/bookings`, qui exige la permission d'arbitrage : un
    #: administrateur du seul parc verrait sinon une colonne vide.
    booking_count: int = 0
    created_at: datetime
    updated_at: datetime


class RoomBulkIn(ApiModel):
    """Action groupée depuis la liste des salles.

    Chaque salle est traitée indépendamment : une seule en échec n'annule pas
    les autres, et la réponse dit laquelle a échoué et pourquoi.
    """

    room_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=100)]
    action: Annotated[str, Field(pattern=r"^(status|accessible|badge|archive)$")]
    status: RoomStatus | None = None
    value: bool | None = None

    @model_validator(mode="after")
    def _valeur_coherente(self) -> RoomBulkIn:
        if self.action == "status" and self.status is None:
            raise ValueError("L'action « status » exige un statut.")
        if self.action in {"accessible", "badge"} and self.value is None:
            raise ValueError(f"L'action « {self.action} » exige une valeur booléenne.")
        return self


class RoomBulkOut(ReadModel):
    succeeded: list[uuid.UUID] = Field(default_factory=list)
    failed: list[dict[str, str]] = Field(default_factory=list)


class RoomFiltersOut(ReadModel):
    """Valeurs proposées par les filtres de la recherche de salles.

    Servies par l'API plutôt que devinées par le front : une capacité maximale
    codée en dur mentirait dès qu'une salle plus grande entrerait au parc.
    """

    buildings: list[BuildingOut] = Field(default_factory=list)
    floors: list[FloorOut] = Field(default_factory=list)
    equipments: list[EquipmentOut] = Field(default_factory=list)
    statuses: list[str] = Field(default_factory=list)
    capacity_min: int = 0
    capacity_max: int = 0
