"""Mise à plat des objets ORM vers les schémas de sortie.

Les routeurs sérialisent, ils ne construisent pas. Regrouper ces conversions
évite de répéter la même mise à plat dans trois routeurs — et surtout de la
laisser diverger entre eux, ce qui ferait mentir un écran sur deux.
"""

from __future__ import annotations

from app.api.v1.schemas import (
    BuildingOut,
    EquipmentOut,
    FloorOut,
    RoomEquipmentOut,
    RoomOut,
    RoomPhotoOut,
    RoomPlacementOut,
)
from app.models import Building, Equipment, Floor, Room


def batiment_sortie(batiment: Building, floor_count: int = 0, room_count: int = 0) -> BuildingOut:
    return BuildingOut(
        id=batiment.id,
        code=batiment.code,
        name=batiment.name,
        address=batiment.address,
        image_url=batiment.image_url,
        sort_order=batiment.sort_order,
        floor_count=floor_count,
        room_count=room_count,
    )


def etage_sortie(etage: Floor, room_count: int = 0, has_plan: bool = False) -> FloorOut:
    return FloorOut(
        id=etage.id,
        building_id=etage.building_id,
        code=etage.code,
        label=etage.label,
        level=etage.level,
        room_count=room_count,
        has_plan=has_plan,
    )


def equipement_sortie(materiel: Equipment, room_count: int = 0) -> EquipmentOut:
    return EquipmentOut(
        id=materiel.id,
        code=materiel.code,
        label=materiel.label,
        category=materiel.category,
        icon=materiel.icon,
        description=materiel.description,
        is_filterable=materiel.is_filterable,
        room_count=room_count,
    )


def salle_sortie(salle: Room, occupation: int = 0, reservations: int = 0) -> RoomOut:
    """Aplatit l'étage et le bâtiment dans la fiche.

    Les écrans affichent « Salle Vinci — Campus Eiffel, 2e étage » : leur
    imposer deux appels supplémentaires pour un libellé serait absurde.

    `occupation` est passée par l'appelant, qui la calcule pour toute la page en
    une requête : la lire salle par salle rendrait la liste proportionnellement
    lente au nombre de lignes affichées.
    """
    return RoomOut(
        occupancy_percent=occupation,
        booking_count=reservations,
        id=salle.id,
        floor_id=salle.floor_id,
        building_id=salle.floor.building_id,
        building_name=salle.floor.building.name,
        floor_label=salle.floor.label,
        floor_level=salle.floor.level,
        name=salle.name,
        slug=salle.slug,
        capacity=salle.capacity,
        area_m2=salle.area_m2,
        status=salle.status,
        is_accessible=salle.is_accessible,
        badge_required=salle.badge_required,
        description=salle.description,
        location_plan_url=salle.location_plan_url,
        equipments=[
            RoomEquipmentOut(
                equipment_id=lien.equipment_id,
                code=lien.equipment.code,
                label=lien.equipment.label,
                category=lien.equipment.category,
                icon=lien.equipment.icon,
                quantity=lien.quantity,
            )
            for lien in sorted(salle.room_equipments, key=lambda item: item.equipment.label)
        ],
        photos=[
            RoomPhotoOut.model_validate(photo)
            for photo in sorted(salle.photos, key=lambda item: item.position)
        ],
        placement=(
            RoomPlacementOut.model_validate(salle.placement)
            if salle.placement is not None
            else None
        ),
        created_at=salle.created_at,
        updated_at=salle.updated_at,
    )
