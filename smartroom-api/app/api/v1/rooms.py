"""Parc de salles : consultation et administration.

La recherche par créneau vit dans `availability` : elle interroge le moteur.
Ici, on lit et on modifie le parc — deux besoins distincts, deux routeurs.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import (
    ROOMS_MANAGE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas import (
    RoomBulkIn,
    RoomBulkOut,
    RoomFiltersOut,
    RoomIn,
    RoomOut,
    RoomPatchIn,
    PhotoOrderIn,
    RoomPhotoOut,
    UploadIn,
    VisuelIn,
)
from app.api.v1.serializers import batiment_sortie, equipement_sortie, etage_sortie, salle_sortie
from app.core.pagination import Page
from app.db.enums import RoomStatus
from app.services import parc_service as service

router = APIRouter(prefix="/rooms", tags=["parc"])

Ecriture = Depends(require_permission(ROOMS_MANAGE))


@router.get(
    "",
    response_model=Page[RoomOut],
    summary="Lister les salles",
    description=(
        "Filtres cumulatifs, tous validés. Les salles archivées sont exclues "
        "sauf demande explicite du statut. Tri autorisé sur `name`, `capacity`, "
        "`status` et `created_at`, préfixé de `-` pour décroissant."
    ),
)
def list_rooms(
    session: SessionDep,
    _: CurrentPrincipal,
    params: PageDep,
    building_id: uuid.UUID | None = None,
    floor_id: uuid.UUID | None = None,
    building_ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    floor_ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    min_capacity: Annotated[int | None, Query(ge=1, le=500)] = None,
    equipment_ids: Annotated[list[uuid.UUID] | None, Query()] = None,
    accessible_only: bool = False,
    room_status: Annotated[RoomStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
) -> Page[RoomOut]:
    salles, total = service.list_rooms(
        session,
        params,
        building_id=building_id,
        floor_id=floor_id,
        building_ids=building_ids,
        floor_ids=floor_ids,
        min_capacity=min_capacity,
        equipment_ids=equipment_ids,
        accessible_only=accessible_only,
        status=room_status,
        query=q,
    )
    identifiants = [item.id for item in salles]
    occupation = service.occupancy_map(session, identifiants)
    comptes = service.booking_counts(session, identifiants)
    return Page.build(
        [
            salle_sortie(item, occupation.get(item.id, 0), comptes.get(item.id, 0))
            for item in salles
        ],
        total,
        params,
    )


@router.get(
    "/filters",
    response_model=RoomFiltersOut,
    summary="Valeurs proposées par les filtres",
    description=(
        "Bâtiments, étages, équipements filtrables et bornes de capacité, "
        "mesurés sur le parc réel. Une borne codée en dur côté front mentirait "
        "dès qu'une salle plus grande entrerait au catalogue."
    ),
)
def room_filters(session: SessionDep, _: CurrentPrincipal) -> RoomFiltersOut:
    brut = service.room_filters(session)
    return RoomFiltersOut(
        buildings=[batiment_sortie(*ligne) for ligne in brut["buildings"]],
        floors=[etage_sortie(*ligne) for ligne in brut["floors"]],
        equipments=[equipement_sortie(*ligne) for ligne in brut["equipments"]],
        statuses=brut["statuses"],
        capacity_min=brut["capacity_min"],
        capacity_max=brut["capacity_max"],
    )


@router.get("/{room_id}", response_model=RoomOut, summary="Fiche d'une salle")
def get_room(room_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal) -> RoomOut:
    salle = service.get_room(session, room_id)
    return salle_sortie(
        salle,
        service.occupancy_map(session, [salle.id]).get(salle.id, 0),
        service.booking_counts(session, [salle.id]).get(salle.id, 0),
    )


@router.post(
    "",
    response_model=RoomOut,
    status_code=status.HTTP_201_CREATED,
    summary="Créer une salle",
    description="L'identifiant lisible est dérivé du nom s'il n'est pas fourni.",
    responses={409: {"description": "Nom ou identifiant déjà pris."}},
)
def create_room(
    payload: RoomIn, session: SessionDep, _admin=Ecriture
) -> RoomOut:
    salle = service.create_room(session, payload)
    session.commit()
    return salle_sortie(salle)


@router.patch(
    "/{room_id}",
    response_model=RoomOut,
    summary="Modifier une salle",
    description=(
        "Modification partielle : seuls les champs fournis sont appliqués. "
        "`equipments`, s'il est fourni, remplace l'équipement de la salle."
    ),
)
def update_room(
    room_id: uuid.UUID, payload: RoomPatchIn, session: SessionDep, _admin=Ecriture
) -> RoomOut:
    salle = service.update_room(session, room_id, payload)
    session.commit()
    return salle_sortie(salle)


@router.delete(
    "/{room_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Archiver une salle",
    description=(
        "Archive plutôt que supprimer : les réservations passées y renvoient "
        "encore. Refusé tant que la salle porte des réservations à venir."
    ),
    responses={422: {"description": "Réservations à venir sur cette salle."}},
)
def archive_room(room_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> None:
    service.archive_room(session, room_id)
    session.commit()


@router.post(
    "/bulk",
    response_model=RoomBulkOut,
    summary="Action groupée sur plusieurs salles",
    description=(
        "Chaque salle est traitée indépendamment : une seule en échec n'annule "
        "pas les autres, et la réponse dit laquelle a échoué et pourquoi."
    ),
)
def bulk_rooms(payload: RoomBulkIn, session: SessionDep, _admin=Ecriture) -> RoomBulkOut:
    reussies, echouees = service.bulk_update_rooms(session, payload)
    session.commit()
    return RoomBulkOut(succeeded=reussies, failed=echouees)


@router.get(
    "/{room_id}/photos",
    response_model=list[RoomPhotoOut],
    summary="Photos d'une salle",
)
def list_photos(
    room_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal
) -> list[RoomPhotoOut]:
    return [RoomPhotoOut.model_validate(item) for item in service.list_photos(session, room_id)]


@router.put(
    "/{room_id}/location-plan",
    response_model=RoomOut,
    summary="Déposer le plan de localisation d'une salle",
    description=(
        "L'image porte déjà le repère de la salle : c'est un plan annoté, pas "
        "une photographie de la pièce — celles-ci sont les `photos`. Elle est "
        "distincte du plan de l'étage, qui vaut pour tout un niveau : une salle "
        "peut être située sans que son étage ait reçu de plan, et l'inverse. "
        "PNG, JPEG ou WebP, 5 Mo au maximum ; le visuel précédent est effacé."
    ),
    responses={422: {"description": "Format refusé, fichier vide ou trop lourd."}},
)
def upload_location_plan(
    room_id: uuid.UUID, payload: VisuelIn, session: SessionDep, _admin=Ecriture
) -> RoomOut:
    salle = service.set_room_location_plan(
        session, room_id, contenu=payload.content, content_type=payload.content_type
    )
    session.commit()
    return salle_sortie(salle)


@router.delete(
    "/{room_id}/location-plan",
    response_model=RoomOut,
    summary="Retirer le plan de localisation d'une salle",
)
def delete_location_plan(room_id: uuid.UUID, session: SessionDep, _admin=Ecriture) -> RoomOut:
    salle = service.delete_room_location_plan(session, room_id)
    session.commit()
    return salle_sortie(salle)


@router.post(
    "/{room_id}/photos",
    response_model=RoomPhotoOut,
    status_code=status.HTTP_201_CREATED,
    summary="Ajouter une photo",
    description=(
        "Image seule, 5 Mo au maximum, six par salle. La position est attribuée "
        "à la suite : la première photo sert de couverture aux résultats de "
        "recherche, et laisser le client choisir un rang libre l'obligerait à "
        "connaître un état qu'il vient de lire."
    ),
    responses={422: {"description": "Format refusé, fichier trop lourd, ou salle pleine."}},
)
def add_photo(
    room_id: uuid.UUID, payload: UploadIn, session: SessionDep, _admin=Ecriture
) -> RoomPhotoOut:
    photo = service.add_photo(
        session,
        room_id,
        contenu=payload.content,
        content_type=payload.content_type,
        alt_text=payload.alt_text,
    )
    session.commit()
    return RoomPhotoOut.model_validate(photo)


@router.put(
    "/{room_id}/photos/order",
    response_model=list[RoomPhotoOut],
    summary="Réordonner les photos",
    description=(
        "La première de la liste devient la couverture des résultats de "
        "recherche. L'ordre doit citer toutes les photos de la salle, et elles "
        "seules : réordonner à partir d'un sous-ensemble laisserait les photos "
        "absentes sur des positions arbitraires, et la salle perdrait "
        "silencieusement des visuels."
    ),
    responses={422: {"description": "Ordre incomplet, ou photo étrangère à la salle."}},
)
def reorder_photos(
    room_id: uuid.UUID, payload: PhotoOrderIn, session: SessionDep, _admin=Ecriture
) -> list[RoomPhotoOut]:
    photos = service.reorder_photos(session, room_id, payload.photo_ids)
    session.commit()
    return [RoomPhotoOut.model_validate(item) for item in photos]


@router.delete(
    "/{room_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Retirer une photo",
)
def delete_photo(
    room_id: uuid.UUID, photo_id: uuid.UUID, session: SessionDep, _admin=Ecriture
) -> None:
    service.delete_photo(session, room_id, photo_id)
    session.commit()
