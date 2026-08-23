"""Réservations de l'utilisateur connecté.

Le service métier ne valide jamais la transaction : c'est la route qui commite,
une fois et à la fin. Une réservation partiellement écrite — la ligne sans ses
participants, ou sans son code d'accès — n'existe donc jamais.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentPrincipal, SessionDep, assert_owner_or_admin
from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.db.enums import BookingSource, BookingStatus
from app.models import Booking
from app.schemas.reservations import (
    AccessCodeIssued,
    BookingAccessCodeRead,
    BookingCancel,
    BookingCreate,
    BookingCreatedRead,
    BookingDetailRead,
    BookingRead,
    BookingUpdate,
    CheckInRequest,
    RecurrenceRuleCreate,
    RecurrenceRuleRead,
    SeriesCreatedRead,
    SeriesOccurrenceRead,
    SeriesPreviewRead,
)
from app.services import booking as service
from app.services.recurrence import Occurrence, create_series, preview_series

router = APIRouter(prefix="/bookings", tags=["réservations"])

FUSEAU = ZoneInfo(get_settings().timezone)


def _plage(depart: datetime, fin: datetime) -> Range[datetime]:
    """Borne inférieure incluse, supérieure exclue : deux créneaux qui se
    touchent à 12:00 ne se chevauchent pas."""
    return Range(depart.astimezone(FUSEAU), fin.astimezone(FUSEAU), bounds="[)")


def _occurrence(item: Occurrence) -> SeriesOccurrenceRead:
    return SeriesOccurrenceRead(
        starts_at=item.creneau.lower,
        ends_at=item.creneau.upper,
        accepted=item.accepted,
        reason=item.reason,
    )


def _charger_detail(session, booking_id: uuid.UUID) -> Booking:
    reservation = session.scalars(
        select(Booking)
        .options(
            selectinload(Booking.participants),
            selectinload(Booking.events),
            selectinload(Booking.access_codes),
        )
        .where(Booking.id == booking_id, Booking.deleted_at.is_(None))
    ).one_or_none()
    if reservation is None:
        raise NotFoundError("Réservation introuvable.")
    return reservation


def _detail(reservation: Booking) -> BookingDetailRead:
    """Assemble la vue détaillée.

    Le code d'accès exposé est le seul actif : les codes révoqués restent en
    base pour la traçabilité, pas pour l'affichage.
    """
    detail = BookingDetailRead.model_validate(reservation)
    actif = next((code for code in reservation.access_codes if code.revoked_at is None), None)
    detail.access_code = None if actif is None else BookingAccessCodeRead.model_validate(actif)
    return detail


# --------------------------------------------------------------------------- #
# Lecture
# --------------------------------------------------------------------------- #


@router.get("", response_model=list[BookingRead], summary="Mes réservations")
def list_mine(
    session: SessionDep,
    principal: CurrentPrincipal,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[Booking]:
    """Les réservations du compte connecté, les plus proches d'abord.

    Aucun `owner_id` n'est accepté en paramètre : lister celles d'un tiers passe
    par l'espace d'administration, pas par un filtre.
    """
    requete = (
        select(Booking)
        .where(Booking.owner_id == principal.user.id, Booking.deleted_at.is_(None))
        .order_by(Booking.time_range)
        .limit(limit)
    )
    if status_filter is not None:
        requete = requete.where(Booking.status == status_filter)
    # Le chevauchement avec une plage semi-ouverte laisse l'index GiST faire le
    # travail, là où `lower(time_range) >= :date` le rendrait inutilisable.
    if from_date is not None:
        requete = requete.where(
            Booking.time_range.op("&&")(Range(from_date.astimezone(FUSEAU), None, bounds="[)"))
        )
    if to_date is not None:
        requete = requete.where(
            Booking.time_range.op("&&")(Range(None, to_date.astimezone(FUSEAU), bounds="[)"))
        )
    return list(session.scalars(requete).unique())


# --------------------------------------------------------------------------- #
# Écriture
# --------------------------------------------------------------------------- #


@router.post(
    "",
    response_model=BookingCreatedRead,
    status_code=status.HTTP_201_CREATED,
    summary="Réserver",
)
def create(
    payload: BookingCreate, session: SessionDep, principal: CurrentPrincipal
) -> BookingCreatedRead:
    """Crée pour le compte connecté. Les règles ne se forcent pas ici."""
    reservation, code = service.create_booking(
        session,
        room_id=payload.room_id,
        owner_id=principal.user.id,
        creneau=_plage(payload.slot.starts_at, payload.slot.ends_at),
        title=payload.title,
        attendee_count=payload.attendee_count,
        participants=[
            (item.email, item.display_name, item.user_id) for item in payload.participants
        ],
        source=BookingSource.UTILISATEUR,
    )
    session.commit()

    return BookingCreatedRead(
        booking=_detail(_charger_detail(session, reservation.id)),
        access_code=(
            None
            if code is None
            else AccessCodeIssued(code=code.clear, hint=code.hint, expires_at=code.expires_at)
        ),
    )


@router.get("/{booking_id}", response_model=BookingDetailRead, summary="Détail")
def get_booking(
    booking_id: uuid.UUID, session: SessionDep, principal: CurrentPrincipal
) -> BookingDetailRead:
    reservation = _charger_detail(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)
    return _detail(reservation)


@router.patch("/{booking_id}", response_model=BookingDetailRead, summary="Déplacer ou modifier")
def update(
    booking_id: uuid.UUID,
    payload: BookingUpdate,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> BookingDetailRead:
    reservation = _charger_detail(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    service.update_booking(
        session,
        booking_id,
        creneau=(
            None if payload.slot is None else _plage(payload.slot.starts_at, payload.slot.ends_at)
        ),
        title=payload.title,
        attendee_count=payload.attendee_count,
        actor_id=principal.user.id,
    )
    session.commit()
    return _detail(_charger_detail(session, booking_id))


@router.post("/{booking_id}/cancel", response_model=BookingDetailRead, summary="Annuler")
def cancel(
    booking_id: uuid.UUID,
    payload: BookingCancel,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> BookingDetailRead:
    """Le motif est obligatoire : c'est lui qui distingue un désistement d'un
    abandon dans la frise, et qui alimente le score de fiabilité du compte."""
    reservation = _charger_detail(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    service.cancel_booking(
        session,
        booking_id,
        reason=payload.reason,
        actor_id=principal.user.id,
        notify_participants=payload.notify_participants,
    )
    session.commit()
    return _detail(_charger_detail(session, booking_id))


@router.post(
    "/{booking_id}/check-in",
    response_model=BookingDetailRead,
    summary="Valider la présence",
)
def check_in(
    booking_id: uuid.UUID,
    payload: CheckInRequest,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> BookingDetailRead:
    """Passé la fenêtre de validation, le créneau devient libérable : la route
    refuse alors, et la tâche de maintenance rendra la salle."""
    reservation = _charger_detail(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    service.check_in(session, booking_id, code=payload.code)
    session.commit()
    return _detail(_charger_detail(session, booking_id))


# --------------------------------------------------------------------------- #
# Séries récurrentes
# --------------------------------------------------------------------------- #


@router.post("/recurring/preview", response_model=SeriesPreviewRead, summary="Aperçu d'une série")
def preview_recurring(
    payload: RecurrenceRuleCreate, session: SessionDep, principal: CurrentPrincipal
) -> SeriesPreviewRead:
    """Rien n'est écrit : l'utilisateur voit quelles dates passent avant de valider."""
    apercu = preview_series(
        session,
        room_id=payload.room_id,
        owner_id=principal.user.id,
        freq=payload.freq,
        interval_count=payload.interval_count,
        byweekday=payload.byweekday,
        start_date=payload.start_date,
        until_date=payload.until_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        attendee_count=payload.attendee_count,
    )
    occurrences = [_occurrence(item) for item in apercu.occurrences]
    return SeriesPreviewRead(
        occurrences=occurrences,
        accepted_count=sum(1 for item in occurrences if item.accepted),
        rejected_count=sum(1 for item in occurrences if not item.accepted),
    )


@router.post(
    "/recurring",
    response_model=SeriesCreatedRead,
    status_code=status.HTTP_201_CREATED,
    summary="Créer une série",
)
def create_recurring(
    payload: RecurrenceRuleCreate,
    session: SessionDep,
    principal: CurrentPrincipal,
    skip_conflicts: bool = Query(default=True),
) -> SeriesCreatedRead:
    """Une série dont deux dates butent sur un conflit produit quand même les autres.

    `skip_conflicts=false` bascule en tout ou rien, pour l'utilisateur qui tient
    à la régularité de son créneau plutôt qu'à son volume.
    """
    regle, creees, ecartees = create_series(
        session,
        room_id=payload.room_id,
        owner_id=principal.user.id,
        freq=payload.freq,
        interval_count=payload.interval_count,
        byweekday=payload.byweekday,
        start_date=payload.start_date,
        until_date=payload.until_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        title=payload.title,
        attendee_count=payload.attendee_count,
        skip_conflicts=skip_conflicts,
    )
    session.commit()

    return SeriesCreatedRead(
        rule=RecurrenceRuleRead.model_validate(regle),
        bookings=[BookingRead.model_validate(item) for item in creees],
        skipped=[_occurrence(item) for item in ecartees],
    )
