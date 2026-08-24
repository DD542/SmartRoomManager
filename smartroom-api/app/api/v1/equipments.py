"""Référentiel des équipements."""

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
from app.api.v1.schemas import EquipmentIn, EquipmentOut
from app.api.v1.serializers import equipement_sortie
from app.core.pagination import Page
from app.db.enums import EquipmentCategory
from app.services import parc_service as service

router = APIRouter(prefix="/equipments", tags=["parc"])

Ecriture = Depends(require_permission(ROOMS_MANAGE))


@router.get(
    "",
    response_model=Page[EquipmentOut],
    summary="Lister les équipements",
    description=(
        "Chaque équipement porte le nombre de salles qui en disposent, agrégé "
        "en SQL. Tri autorisé sur `label`, `code` et `category`."
    ),
)
def list_equipments(
    session: SessionDep,
    _: CurrentPrincipal,
    params: PageDep,
    category: Annotated[EquipmentCategory | None, Query()] = None,
    filterable: Annotated[bool | None, Query()] = None,
) -> Page[EquipmentOut]:
    lignes, total = service.list_equipments(
        session, params, category=category, filterable=filterable
    )
    return Page.build([equipement_sortie(*ligne) for ligne in lignes], total, params)


@router.post(
    "",
    response_model=EquipmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Créer un équipement",
    responses={409: {"description": "Code déjà utilisé."}},
)
def create_equipment(
    payload: EquipmentIn, session: SessionDep, _admin=Ecriture
) -> EquipmentOut:
    materiel = service.create_equipment(session, payload)
    session.commit()
    return equipement_sortie(materiel)


@router.patch(
    "/{equipment_id}",
    response_model=EquipmentOut,
    summary="Modifier un équipement",
)
def update_equipment(
    equipment_id: uuid.UUID, payload: EquipmentIn, session: SessionDep, _admin=Ecriture
) -> EquipmentOut:
    materiel = service.update_equipment(session, equipment_id, payload)
    session.commit()
    return equipement_sortie(materiel)


@router.delete(
    "/{equipment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supprimer un équipement",
    description=(
        "Refusé tant que l'équipement figure dans une salle : le retirer "
        "silencieusement ferait mentir les fiches de salle."
    ),
    responses={422: {"description": "Équipement encore rattaché à des salles."}},
)
def delete_equipment(
    equipment_id: uuid.UUID, session: SessionDep, _admin=Ecriture
) -> None:
    service.delete_equipment(session, equipment_id)
    session.commit()
