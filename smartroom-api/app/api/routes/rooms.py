"""Consultation du parc et interrogation du moteur de disponibilité.

Ces routes n'écrivent rien : elles répondent « ce créneau est-il libre, et
sinon pourquoi ». La distinction est ce qui permet au front d'expliquer un refus
avant que l'utilisateur ne valide, plutôt qu'après.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentPrincipal, SessionDep
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.db.enums import RoomStatus
from app.models import Floor, Room, RoomEquipment
from app.schemas.parc import RoomRead
from app.schemas.reservations import (
    AvailabilitySearch,
    ConflictRead,
    SlotCheckRead,
    SlotCheckRequest,
)
from app.services.availability import check_slot, find_available_rooms

router = APIRouter(prefix="/rooms", tags=["salles"])

FUSEAU = ZoneInfo(get_settings().timezone)


def _plage(depart: datetime, fin: datetime) -> Range[datetime]:
    """Borne inférieure incluse, supérieure exclue : deux créneaux qui se
    touchent à 12:00 ne se chevauchent pas."""
    return Range(depart.astimezone(FUSEAU), fin.astimezone(FUSEAU), bounds="[)")


def _charger_pour_lecture(session, room_id: uuid.UUID) -> Room:
    salle = session.scalars(
        select(Room)
        .options(
            selectinload(Room.floor).selectinload(Floor.building),
            selectinload(Room.room_equipments).selectinload(RoomEquipment.equipment),
            selectinload(Room.photos),
            selectinload(Room.placement),
        )
        .where(Room.id == room_id, Room.deleted_at.is_(None))
    ).one_or_none()
    if salle is None:
        raise NotFoundError("Salle introuvable.")
    return salle


@router.get("", response_model=list[RoomRead], summary="Parc de salles")
def list_rooms(
    session: SessionDep,
    _: CurrentPrincipal,
    building_id: uuid.UUID | None = None,
    min_capacity: int | None = Query(default=None, ge=1, le=500),
    accessible_only: bool = False,
    status: RoomStatus | None = None,
) -> list[Room]:
    """Liste filtrée. Les chargements sont explicites : sans `selectinload`, le
    rendu d'une liste de trente salles déclencherait cent requêtes d'équipements."""
    requete = (
        select(Room)
        .options(
            selectinload(Room.floor).selectinload(Floor.building),
            selectinload(Room.room_equipments).selectinload(RoomEquipment.equipment),
            selectinload(Room.photos),
            selectinload(Room.placement),
        )
        .where(Room.deleted_at.is_(None))
        .order_by(Room.name)
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


@router.post("/available", response_model=list[RoomRead], summary="Salles libres sur un créneau")
def search_available(
    payload: AvailabilitySearch, session: SessionDep, _: CurrentPrincipal
) -> list[Room]:
    """Recherche de U-03 : le créneau d'abord, les salles ensuite.

    Le filtrage grossier se fait en SQL — statut, capacité, équipements,
    chevauchement — et seules les salles plausibles passent par le moteur
    complet, qui coûte plusieurs requêtes par salle.
    """
    salles = find_available_rooms(
        session,
        creneau=_plage(payload.slot.starts_at, payload.slot.ends_at),
        attendee_count=payload.attendee_count,
        building_id=payload.building_id,
        equipment_ids=payload.equipment_ids or None,
        include_ineligible=payload.include_ineligible,
    )
    # Les salles reviennent du moteur sans leurs collections : on les recharge
    # en une passe plutôt qu'une par salle au moment de la sérialisation.
    if not salles:
        return []
    return list(
        session.scalars(
            select(Room)
            .options(
                selectinload(Room.floor).selectinload(Floor.building),
                selectinload(Room.room_equipments).selectinload(RoomEquipment.equipment),
                selectinload(Room.photos),
                selectinload(Room.placement),
            )
            .where(Room.id.in_([salle.id for salle in salles]))
            .order_by(Room.capacity, Room.name)
        ).unique()
    )


@router.get("/{room_id}", response_model=RoomRead, summary="Fiche salle")
def get_room(room_id: uuid.UUID, session: SessionDep, _: CurrentPrincipal) -> Room:
    return _charger_pour_lecture(session, room_id)


@router.post(
    "/{room_id}/check-slot",
    response_model=SlotCheckRead,
    summary="Verdict du moteur sur un créneau",
)
def check_room_slot(
    room_id: uuid.UUID,
    payload: SlotCheckRequest,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> SlotCheckRead:
    """Vérifie sans écrire. Le quota est évalué pour le demandeur connecté."""
    verdict = check_slot(
        session,
        room_id=room_id,
        creneau=_plage(payload.slot.starts_at, payload.slot.ends_at),
        attendee_count=payload.attendee_count,
        requester_id=principal.user.id,
        ignore_booking_id=payload.ignore_booking_id,
    )
    return SlotCheckRead(
        available=verdict.available,
        blocking=verdict.blocking,
        conflicts=[ConflictRead.model_validate(conflit) for conflit in verdict.conflicts],
        rule_errors=verdict.rule_errors,
        capacity_error=verdict.capacity_error,
        closure_error=verdict.closure_error,
    )
