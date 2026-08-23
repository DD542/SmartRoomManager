"""Consultation du parc.

La recherche par créneau vit dans `availability` : elle interroge le moteur.
Ici, on ne fait que lire le parc — deux besoins distincts, deux routes.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentPrincipal, SessionDep
from app.core.errors import NotFoundError
from app.db.enums import RoomStatus
from app.models import Floor, Room, RoomEquipment
from app.schemas.parc import RoomRead

router = APIRouter(prefix="/rooms", tags=["salles"])


def _requete_complete():
    """Chargements explicites : sans eux, afficher trente salles déclencherait
    cent requêtes d'équipements."""
    return select(Room).options(
        selectinload(Room.floor).selectinload(Floor.building),
        selectinload(Room.room_equipments).selectinload(RoomEquipment.equipment),
        selectinload(Room.photos),
        selectinload(Room.placement),
    )


@router.get("", response_model=list[RoomRead], summary="Parc de salles")
def list_rooms(
    session: SessionDep,
    _: CurrentPrincipal,
    building_id: uuid.UUID | None = None,
    min_capacity: int | None = Query(default=None, ge=1, le=500),
    accessible_only: bool = False,
    status: RoomStatus | None = None,
) -> list[Room]:
    requete = (
        _requete_complete().where(Room.deleted_at.is_(None)).order_by(Room.name)
    )
    if building_id is not None:
        requete = requete.join(Room.floor).where(Floor.building_id == building_id)
    if min_capacity is not None:
        requete = requete.where(Room.capacity >= min_capacity)
    if accessible_only:
        requete = requete.where(Room.is_accessible.is_(True))
    requete = requete.where(
        Room.status == status if status is not None else Room.status != RoomStatus.ARCHIVEE
    )
    return list(session.scalars(requete).unique())


@router.get("/{room_id}", response_model=RoomRead, summary="Fiche salle")
def get_room(room_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal) -> Room:
    salle = session.scalars(
        _requete_complete().where(Room.id == room_id, Room.deleted_at.is_(None))
    ).one_or_none()
    if salle is None:
        raise NotFoundError("Salle introuvable.")
    return salle
