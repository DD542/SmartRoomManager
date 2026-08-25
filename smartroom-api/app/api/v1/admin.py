"""Back-office : réserver pour autrui, bloquer, arbitrer, maintenir.

Chaque route est gardée par une permission nommée, jamais par un simple « est
administrateur » : la matrice de l'écran A-13 n'aurait aucun effet autrement.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.api.deps import (
    CONFLICTS_ARBITRATE,
    ROOMS_MANAGE,
    SYSTEM_CONFIGURE,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas import (
    AdminBookingIn,
    BlockingIn,
    BookingOut,
    CancelIn,
    MaintenanceOut,
)
from app.core.pagination import Page, paginate
from app.db.enums import BookingSource, BookingStatus
from app.models import AdminAccount, Booking, Floor, Room
from app.services import booking_service as service

router = APIRouter(prefix="/admin", tags=["administration"])


@router.get(
    "/bookings",
    response_model=Page[BookingOut],
    summary="Réservations, tous comptes confondus",
    description=(
        "Paginée comme les autres collections : `page`, `size`, et l'enveloppe "
        "`{items, total, pagination}`. Elle exposait auparavant un `limit` seul, "
        "ce qui empêchait l'écran d'aller au-delà de sa première page et "
        "obligeait à deux composants de pagination différents."
    ),
    dependencies=[Depends(require_permission(CONFLICTS_ARBITRATE))],
)
def list_bookings(
    session: SessionDep,
    params: PageDep,
    room_id: uuid.UUID | None = None,
    building_id: uuid.UUID | None = None,
    owner_id: uuid.UUID | None = None,
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> Page[BookingOut]:
    requete = (
        select(Booking).where(Booking.deleted_at.is_(None)).order_by(Booking.time_range)
    )
    if room_id is not None:
        requete = requete.where(Booking.room_id == room_id)
    if building_id is not None:
        requete = (
            requete.join(Booking.room).join(Room.floor).where(Floor.building_id == building_id)
        )
    if owner_id is not None:
        requete = requete.where(Booking.owner_id == owner_id)
    if status_filter is not None:
        requete = requete.where(Booking.status == status_filter)
    if from_date is not None:
        requete = requete.where(Booking.time_range.op("&&")(Range(from_date, None, bounds="[)")))
    if to_date is not None:
        requete = requete.where(Booking.time_range.op("&&")(Range(None, to_date, bounds="[)")))

    reservations, total = paginate(session, requete, params)
    return Page.build([BookingOut.of(item) for item in reservations], total, params)


@router.post(
    "/bookings",
    response_model=BookingOut,
    status_code=status.HTTP_201_CREATED,
    summary="Réserver pour un utilisateur",
)
def create_for_user(
    payload: AdminBookingIn,
    session: SessionDep,
    admin: AdminAccount = Depends(require_permission(CONFLICTS_ARBITRATE)),
) -> BookingOut:
    """`ignore_rules` lève durée, capacité, horaires, quota et fermeture.

    Jamais un chevauchement : la contrainte `ex_bookings_no_overlap` le refuse
    au niveau base, quelle que soit la permission de l'appelant. Un créneau
    écoulé ne se force pas davantage : il n'y a plus rien à réserver.
    """
    reservation, _ = service.create_booking(
        session,
        room_id=payload.room_id,
        owner_id=payload.owner_id,
        slot=payload.slot.to_domain(),
        title=payload.title,
        attendees=payload.attendees,
        source=BookingSource.ADMIN,
        created_by_admin_id=admin.user_id,
        ignore_rules=payload.ignore_rules,
    )
    session.commit()
    return BookingOut.of(reservation)


@router.post(
    "/bookings/{booking_id}/cancel",
    response_model=BookingOut,
    summary="Annuler la réservation d'un tiers",
)
def cancel_any(
    booking_id: uuid.UUID,
    payload: CancelIn,
    session: SessionDep,
    admin: AdminAccount = Depends(require_permission(CONFLICTS_ARBITRATE)),
) -> BookingOut:
    annulee = service.cancel_booking(
        session, booking_id, reason=payload.reason, actor_id=admin.user_id
    )
    session.commit()
    return BookingOut.of(annulee)


@router.post(
    "/blockings",
    response_model=BookingOut,
    status_code=status.HTTP_201_CREATED,
    summary="Bloquer une salle",
)
def create_blocking(
    payload: BlockingIn,
    session: SessionDep,
    admin: AdminAccount = Depends(require_permission(ROOMS_MANAGE)),
) -> BookingOut:
    """Un blocage est une réservation sans organisateur, exemptée des bornes de
    durée — fermer une salle pour travaux dure la journée — mais pas du conflit."""
    blocage = service.create_blocking(
        session,
        room_id=payload.room_id,
        slot=payload.slot.to_domain(),
        reason=payload.reason,
        created_by_admin_id=admin.user_id,
    )
    session.commit()
    return BookingOut.of(blocage)


@router.post(
    "/maintenance/run",
    response_model=MaintenanceOut,
    summary="Déclencher la maintenance sans attendre le planificateur",
)
def run_maintenance(
    session: SessionDep,
    _: AdminAccount = Depends(require_permission(SYSTEM_CONFIGURE)),
) -> MaintenanceOut:
    """Même traitement que la tâche planifiée, déclenché à la main.

    Utile en démonstration : le passage automatique a lieu toutes les cinq
    minutes, ce qui est trop long pour montrer une libération en séance.
    """
    from datetime import UTC, datetime

    from app.tasks.scheduler import release_and_close, send_reminders

    liberees, closes = release_and_close(session)
    send_reminders(session)
    return MaintenanceOut(released=liberees, closed=closes, ran_at=datetime.now(UTC))
