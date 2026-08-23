"""Actions de back-office : réserver pour autrui, bloquer, arbitrer, maintenir.

Chaque route est gardée par une permission nommée, jamais par un simple « est
administrateur » : la matrice de l'écran A-13 n'aurait aucun effet autrement.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import selectinload

from app.api.deps import (
    CONFLICTS_ARBITRATE,
    ROOMS_MANAGE,
    SYSTEM_CONFIGURE,
    SessionDep,
    require_permission,
)
from app.core.config import get_settings
from app.db.enums import BookingSource, BookingStatus
from app.models import AdminAccount, Booking, Floor, Room
from app.schemas.reservations import (
    AdminBookingCreate,
    BlockingCreate,
    BookingCancel,
    BookingRead,
    MaintenanceReport,
)
from app.services import booking as service

router = APIRouter(prefix="/admin", tags=["administration"])

FUSEAU = ZoneInfo(get_settings().timezone)


def _plage(depart: datetime, fin: datetime) -> Range[datetime]:
    return Range(depart.astimezone(FUSEAU), fin.astimezone(FUSEAU), bounds="[)")


# --------------------------------------------------------------------------- #
# Réservations de l'ensemble du parc
# --------------------------------------------------------------------------- #


@router.get(
    "/bookings",
    response_model=list[BookingRead],
    summary="Réservations, tous comptes confondus",
    dependencies=[Depends(require_permission(CONFLICTS_ARBITRATE))],
)
def list_bookings(
    session: SessionDep,
    room_id: uuid.UUID | None = None,
    building_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[Booking]:
    requete = (
        select(Booking)
        .options(selectinload(Booking.access_codes))
        .where(Booking.deleted_at.is_(None))
        .order_by(Booking.time_range)
        .limit(limit)
    )
    if room_id is not None:
        requete = requete.where(Booking.room_id == room_id)
    if building_id is not None:
        requete = requete.join(Booking.room).join(Room.floor).where(
            Floor.building_id == building_id
        )
    if owner_id is not None:
        requete = requete.where(Booking.owner_id == owner_id)
    if status_filter is not None:
        requete = requete.where(Booking.status == status_filter)
    if from_date is not None:
        requete = requete.where(
            Booking.time_range.op("&&")(Range(from_date.astimezone(FUSEAU), None, bounds="[)"))
        )
    if to_date is not None:
        requete = requete.where(
            Booking.time_range.op("&&")(Range(None, to_date.astimezone(FUSEAU), bounds="[)"))
        )
    return list(session.scalars(requete).unique())


@router.post(
    "/bookings",
    response_model=BookingRead,
    status_code=status.HTTP_201_CREATED,
    summary="Réserver pour un utilisateur",
)
def create_for_user(
    payload: AdminBookingCreate,
    session: SessionDep,
    admin: AdminAccount = Depends(require_permission(CONFLICTS_ARBITRATE)),
) -> Booking:
    """`ignore_rules` lève durée, capacité, horaires et fermeture.

    Jamais un chevauchement : la contrainte `ex_bookings_no_overlap` le refuse
    au niveau base, quelle que soit la permission de l'appelant.
    """
    reservation, _ = service.create_booking(
        session,
        room_id=payload.room_id,
        owner_id=payload.owner_id,
        creneau=_plage(payload.slot.starts_at, payload.slot.ends_at),
        title=payload.title,
        attendee_count=payload.attendee_count,
        participants=[
            (item.email, item.display_name, item.user_id) for item in payload.participants
        ],
        source=BookingSource.ADMIN,
        created_by_admin_id=admin.user_id,
        ignore_rules=payload.ignore_rules,
    )
    session.commit()
    return reservation


@router.post(
    "/bookings/{booking_id}/cancel",
    response_model=BookingRead,
    summary="Annuler la réservation d'un tiers",
)
def cancel_any(
    booking_id: uuid.UUID,
    payload: BookingCancel,
    session: SessionDep,
    admin: AdminAccount = Depends(require_permission(CONFLICTS_ARBITRATE)),
) -> Booking:
    reservation = service.cancel_booking(
        session,
        booking_id,
        reason=payload.reason,
        actor_id=admin.user_id,
        notify_participants=payload.notify_participants,
    )
    session.commit()
    return reservation


# --------------------------------------------------------------------------- #
# Blocages
# --------------------------------------------------------------------------- #


@router.post(
    "/blockings",
    response_model=BookingRead,
    status_code=status.HTTP_201_CREATED,
    summary="Bloquer une salle",
)
def create_blocking(
    payload: BlockingCreate,
    session: SessionDep,
    admin: AdminAccount = Depends(require_permission(ROOMS_MANAGE)),
) -> Booking:
    """Un blocage est une réservation sans organisateur, exemptée des bornes de
    durée — fermer une salle pour travaux dure la journée — mais pas du conflit."""
    blocage = service.create_blocking(
        session,
        room_id=payload.room_id,
        creneau=_plage(payload.slot.starts_at, payload.slot.ends_at),
        reason=payload.reason,
        created_by_admin_id=admin.user_id,
    )
    session.commit()
    return blocage


# --------------------------------------------------------------------------- #
# Maintenance
# --------------------------------------------------------------------------- #


@router.post(
    "/maintenance/run",
    response_model=MaintenanceReport,
    summary="Déclencher la maintenance sans attendre le planificateur",
)
def run_maintenance(
    session: SessionDep,
    _: AdminAccount = Depends(require_permission(SYSTEM_CONFIGURE)),
) -> MaintenanceReport:
    """Même traitement que la tâche planifiée, déclenché à la main.

    Utile en démonstration : le passage automatique a lieu toutes les cinq
    minutes, ce qui est trop long pour montrer une libération en séance.
    """
    from app.tasks.maintenance import passer

    return passer(session)
