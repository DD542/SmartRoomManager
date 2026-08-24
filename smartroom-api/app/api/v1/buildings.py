"""Bâtiments, étages et plans d'implantation."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, status

from app.api.deps import (
    ROOMS_MANAGE,
    CurrentPrincipal,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas import (
    BuildingOut,
    FloorOut,
    FloorPlanOut,
    PlacementIn,
    RoomPlacementOut,
)
from app.api.v1.serializers import batiment_sortie, etage_sortie
from app.services import parc_service as service

router = APIRouter(tags=["parc"])

Ecriture = Depends(require_permission(ROOMS_MANAGE))


@router.get(
    "/buildings",
    response_model=list[BuildingOut],
    summary="Lister les bâtiments",
    description=(
        "Chaque bâtiment porte ses décomptes d'étages et de salles, agrégés en "
        "SQL. La collection est courte et bornée par le parc : elle n'est pas "
        "paginée."
    ),
)
def list_buildings(session: SessionDep, _: CurrentPrincipal) -> list[BuildingOut]:
    return [batiment_sortie(*ligne) for ligne in service.list_buildings(session)]


@router.get("/buildings/{building_id}", response_model=BuildingOut, summary="Fiche bâtiment")
def get_building(
    building_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal
) -> BuildingOut:
    return batiment_sortie(service.get_building(session, building_id))


@router.get(
    "/buildings/{building_id}/floors",
    response_model=list[FloorOut],
    summary="Étages d'un bâtiment",
    description="Ordonnés du sous-sol au dernier niveau.",
)
def list_floors(
    building_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal
) -> list[FloorOut]:
    return [etage_sortie(*ligne) for ligne in service.list_floors(session, building_id)]


@router.get(
    "/floors/{floor_id}/plan",
    response_model=FloorPlanOut,
    summary="Plan d'un étage",
    responses={404: {"description": "Aucun plan téléversé pour cet étage."}},
)
def get_plan(floor_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal) -> FloorPlanOut:
    return FloorPlanOut.model_validate(service.get_floor_plan(session, floor_id))


@router.patch(
    "/floors/{floor_id}/placements",
    response_model=list[RoomPlacementOut],
    summary="Positionner les salles sur le plan",
    description=(
        "Coordonnées en pourcentage de la surface : elles survivent au "
        "remplacement du plan par une image de dimensions différentes, ce que "
        "des pixels ne feraient pas. Une salle archivée est refusée."
    ),
    responses={422: {"description": "Salle hors de l'étage, ou archivée."}},
)
def set_placements(
    floor_id: uuid.UUID,
    session: SessionDep,
    placements: Annotated[list[PlacementIn], Body(max_length=200)],
    _admin=Ecriture,
) -> list[RoomPlacementOut]:
    resultat = service.set_placements(session, floor_id, placements)
    session.commit()
    return [RoomPlacementOut.model_validate(item) for item in resultat]


@router.post(
    "/rooms/{room_id}/unplace",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Retirer une salle du plan",
)
def unplace(room_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> None:
    service.unplace(session, room_id)
    session.commit()
