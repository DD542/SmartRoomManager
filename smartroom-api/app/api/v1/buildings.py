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
    BuildingIn,
    BuildingOut,
    BuildingPatchIn,
    FloorCreateIn,
    FloorOut,
    FloorPatchIn,
    FloorPlanOut,
    PlacementIn,
    RoomPlacementOut,
    UploadIn,
    VisuelIn,
)
from app.api.v1.serializers import batiment_sortie, etage_sortie
from app.core import storage
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


@router.post(
    "/buildings",
    response_model=BuildingOut,
    status_code=status.HTTP_201_CREATED,
    summary="Déclarer un bâtiment",
    description=(
        "Le code est unique et sert d'identifiant lisible dans les exports. "
        "Un bâtiment naît sans étage : les niveaux s'ajoutent ensuite, et une "
        "salle ne se rattache qu'à un étage."
    ),
    responses={422: {"description": "Code déjà pris."}},
)
def create_building(payload: BuildingIn, session: SessionDep, _admin=Ecriture) -> BuildingOut:
    batiment = service.create_building(session, payload)
    session.commit()
    return batiment_sortie(batiment)


@router.patch(
    "/buildings/{building_id}",
    response_model=BuildingOut,
    summary="Modifier un bâtiment",
    description=(
        "Le code n'est pas modifiable : il est cité dans les exports déjà "
        "produits et dans le journal d'audit, et le changer réécrirait le passé."
    ),
)
def update_building(
    building_id: uuid.UUID, payload: BuildingPatchIn, session: SessionDep, _admin=Ecriture
) -> BuildingOut:
    batiment = service.update_building(session, building_id, payload)
    session.commit()
    return batiment_sortie(batiment)


@router.delete(
    "/buildings/{building_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer un bâtiment vide",
    description=(
        "Refusé tant que le bâtiment porte une salle. Archiver les salles en "
        "cascade serait pire qu'un refus : une salle archivée reste citée dans "
        "les réservations passées, et son bâtiment doit rester lisible."
    ),
    responses={422: {"description": "Le bâtiment porte encore des salles."}},
)
def delete_building(building_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> None:
    service.delete_building(session, building_id)
    session.commit()


@router.put(
    "/buildings/{building_id}/image",
    response_model=BuildingOut,
    summary="Déposer la photographie d'un bâtiment",
    description=(
        "PNG, JPEG ou WebP, 5 Mo au maximum. Ni PDF ni SVG : l'image s'affiche "
        "dans une carte, et le SVG porte du script qui s'exécuterait avec les "
        "droits de l'application. Le visuel précédent est effacé du disque."
    ),
    responses={422: {"description": "Format refusé, fichier vide ou trop lourd."}},
)
def upload_building_image(
    building_id: uuid.UUID, payload: VisuelIn, session: SessionDep, _admin=Ecriture
) -> BuildingOut:
    batiment = service.set_building_image(
        session, building_id, contenu=payload.content, content_type=payload.content_type
    )
    session.commit()
    return batiment_sortie(batiment)


@router.delete(
    "/buildings/{building_id}/image",
    response_model=BuildingOut,
    summary="Retirer la photographie d'un bâtiment",
)
def delete_building_image(
    building_id: uuid.UUID, session: SessionDep, _admin=Ecriture
) -> BuildingOut:
    batiment = service.delete_building_image(session, building_id)
    session.commit()
    return batiment_sortie(batiment)


@router.post(
    "/buildings/{building_id}/floors",
    response_model=FloorOut,
    status_code=status.HTTP_201_CREATED,
    summary="Ajouter un étage",
    description=(
        "`level` est un entier de tri, distinct de `code` : « RDC », « 1er » et "
        "« 2e » ne s'ordonnent pas comme du texte, et une liste triée "
        "alphabétiquement placerait le rez-de-chaussée entre le premier et le "
        "deuxième."
    ),
    responses={422: {"description": "Code ou niveau déjà pris dans ce bâtiment."}},
)
def create_floor(
    building_id: uuid.UUID, payload: FloorCreateIn, session: SessionDep, _admin=Ecriture
) -> FloorOut:
    etage = service.create_floor(session, building_id, payload)
    session.commit()
    return etage_sortie(etage)


@router.patch("/floors/{floor_id}", response_model=FloorOut, summary="Modifier un étage")
def update_floor(
    floor_id: uuid.UUID, payload: FloorPatchIn, session: SessionDep, _admin=Ecriture
) -> FloorOut:
    etage = service.update_floor(session, floor_id, payload)
    session.commit()
    return etage_sortie(etage)


@router.delete(
    "/floors/{floor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer un étage vide",
    description="Refusé tant que l'étage porte une salle. Son plan est effacé avec lui.",
    responses={422: {"description": "L'étage porte encore des salles."}},
)
def delete_floor(floor_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> None:
    service.delete_floor(session, floor_id)
    session.commit()


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


@router.put(
    "/floors/{floor_id}/plan",
    response_model=FloorPlanOut,
    summary="Déposer le plan d'un étage",
    description=(
        "Remplace le plan existant. Image ou PDF, 5 Mo au maximum : le fichier "
        "est servi par l'application, et accepter un type arbitraire "
        "reviendrait à héberger n'importe quel exécutable sur son domaine. Le "
        "plan précédent est effacé du disque. Le contenu voyage encodé en "
        "base64 dans le corps JSON, le multipart demandant une dépendance de "
        "plus."
    ),
    responses={422: {"description": "Format refusé, fichier vide ou trop lourd."}},
)
def upload_plan(
    floor_id: uuid.UUID, payload: UploadIn, session: SessionDep, _admin=Ecriture
) -> FloorPlanOut:
    plan = service.replace_floor_plan(
        session,
        floor_id,
        contenu=payload.content,
        content_type=payload.content_type,
        file_name=payload.file_name,
        admin_id=_admin.user_id,
    )
    session.commit()
    return FloorPlanOut.model_validate(plan)


@router.delete(
    "/floors/{floor_id}/plan",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Retirer le plan d'un étage",
)
def delete_plan(floor_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> None:
    service.delete_floor_plan(session, floor_id)
    session.commit()


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
