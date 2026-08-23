"""Routes de réservation : créer, déplacer, annuler, valider la présence.

La route ouvre et referme la transaction ; le service ne commite jamais. Une
réservation à moitié écrite — la ligne sans ses participants, ou sans son code
d'accès — n'existe donc à aucun instant.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.api.deps import CurrentPrincipal, SessionDep, assert_owner_or_admin
from app.api.v1.schemas import (
    AccessCodeOut,
    AlternativeOut,
    BookingCreatedOut,
    BookingIn,
    BookingOut,
    BookingPatchIn,
    CancelIn,
    CheckInIn,
    OccurrenceOut,
    RecurrenceIn,
    SeriesCreatedOut,
    SeriesPreviewOut,
    SlotOut,
)
from app.core.errors import NotFoundError
from app.db.enums import BookingStatus
from app.domain.types import TimeSlot
from app.models import Booking
from app.services import booking_service as service
from app.services import recommendation_service as reco
from app.services import recurrence_service as recurrence

router = APIRouter(prefix="/bookings", tags=["réservations"])


@router.get("", response_model=list[BookingOut], summary="Mes réservations")
def list_mine(
    session: SessionDep,
    principal: CurrentPrincipal,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    status_filter: BookingStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[BookingOut]:
    """Les réservations du compte connecté, les plus proches d'abord.

    Aucun `owner_id` n'est accepté : lister celles d'un tiers passe par
    l'espace d'administration, pas par un paramètre.
    """
    requete = (
        select(Booking)
        .where(Booking.owner_id == principal.user.id, Booking.deleted_at.is_(None))
        .order_by(Booking.time_range)
        .limit(limit)
    )
    if status_filter is not None:
        requete = requete.where(Booking.status == status_filter)
    # Le chevauchement avec une plage semi-ouverte emprunte l'index GiST, là où
    # `lower(time_range) >= :date` le rendrait inutilisable.
    if from_date is not None:
        requete = requete.where(Booking.time_range.op("&&")(Range(from_date, None, bounds="[)")))
    if to_date is not None:
        requete = requete.where(Booking.time_range.op("&&")(Range(None, to_date, bounds="[)")))

    return [BookingOut.of(item) for item in session.scalars(requete)]


@router.get("/{booking_id}", response_model=BookingOut, summary="Détail")
def get_booking(
    booking_id: uuid.UUID, session: SessionDep, principal: CurrentPrincipal
) -> BookingOut:
    reservation = _charger(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)
    return BookingOut.of(reservation)


@router.post(
    "",
    response_model=BookingCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="Réserver",
)
def create(
    payload: BookingIn, session: SessionDep, principal: CurrentPrincipal
) -> BookingCreatedOut:
    """Crée pour le compte connecté. Les règles ne se forcent pas ici.

    Un conflit détecté avant l'écriture renvoie 409 avec un message exploitable ;
    un conflit survenu pendant la transaction remonte de la contrainte `EXCLUDE`
    et reçoit exactement le même traitement.
    """
    reservation, code = service.create_booking(
        session,
        room_id=payload.room_id,
        owner_id=principal.user.id,
        slot=payload.slot.to_domain(),
        title=payload.title,
        attendees=payload.attendees,
        participants=payload.participants,
    )
    session.commit()

    return BookingCreatedOut(
        booking=BookingOut.of(reservation),
        access_code=(
            None
            if code is None
            else AccessCodeOut(code=code.clear, hint=code.hint, expires_at=code.expires_at)
        ),
    )


@router.patch("/{booking_id}", response_model=BookingOut, summary="Déplacer ou modifier")
def update(
    booking_id: uuid.UUID,
    payload: BookingPatchIn,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> BookingOut:
    reservation = _charger(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    modifiee = service.update_booking(
        session,
        booking_id,
        slot=payload.slot.to_domain() if payload.slot else None,
        title=payload.title,
        attendees=payload.attendees,
        actor_id=principal.user.id,
    )
    session.commit()
    return BookingOut.of(modifiee)


@router.post("/{booking_id}/cancel", response_model=BookingOut, summary="Annuler")
def cancel(
    booking_id: uuid.UUID,
    payload: CancelIn,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> BookingOut:
    """Le motif est obligatoire : c'est lui qui distingue un désistement d'un
    abandon dans la frise, et qui alimente le taux d'absence du compte."""
    reservation = _charger(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    annulee = service.cancel_booking(
        session, booking_id, reason=payload.reason, actor_id=principal.user.id
    )
    session.commit()
    return BookingOut.of(annulee)


@router.post(
    "/{booking_id}/check-in", response_model=BookingOut, summary="Valider la présence"
)
def check_in(
    booking_id: uuid.UUID,
    payload: CheckInIn,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> BookingOut:
    """Passé la fenêtre de validation, le créneau devient libérable : la route
    refuse alors, et la tâche de maintenance rendra la salle."""
    reservation = _charger(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    validee = service.check_in(session, booking_id, code=payload.code)
    session.commit()
    return BookingOut.of(validee)


@router.get(
    "/{booking_id}/alternatives",
    response_model=list[AlternativeOut],
    summary="Alternatives au créneau d'une réservation refusée",
)
def alternatives(
    booking_id: uuid.UUID,
    session: SessionDep,
    principal: CurrentPrincipal,
    limit: int = Query(default=5, ge=1, le=10),
) -> list[AlternativeOut]:
    """Les trois familles du sujet : même salle plus tard, autre salle au même
    créneau, ou salle et créneau proches."""
    reservation = _charger(session, booking_id)
    assert_owner_or_admin(principal, reservation.owner_id)

    propositions = reco.suggest_alternatives(
        session,
        room_id=reservation.room_id,
        slot=TimeSlot(start=reservation.time_range.lower, end=reservation.time_range.upper),
        attendees=reservation.attendee_count,
        user_id=principal.user.id,
        limit=limit,
    )
    return [AlternativeOut.of(item) for item in propositions]


def _charger(session: SessionDep, booking_id: uuid.UUID) -> Booking:
    reservation = session.scalars(
        select(Booking).where(Booking.id == booking_id, Booking.deleted_at.is_(None))
    ).one_or_none()
    if reservation is None:
        raise NotFoundError("Réservation introuvable.")
    return reservation


def _occurrence(item) -> OccurrenceOut:
    return OccurrenceOut(
        slot=SlotOut.of(item.slot), accepted=item.accepted, reason=item.reason
    )


@router.post(
    "/recurring/preview", response_model=SeriesPreviewOut, summary="Aperçu d'une série"
)
def preview_recurring(
    payload: RecurrenceIn, session: SessionDep, _: CurrentPrincipal
) -> SeriesPreviewOut:
    """Rien n'est écrit : l'utilisateur voit quelles dates passent avant de valider."""
    apercu = recurrence.preview_series(
        session,
        room_id=payload.room_id,
        freq=payload.freq,
        interval_count=payload.interval_count,
        byweekday=payload.byweekday,
        start_date=payload.start_date,
        until_date=payload.until_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        attendees=payload.attendees,
    )
    occurrences = [_occurrence(item) for item in apercu.occurrences]
    return SeriesPreviewOut(
        occurrences=occurrences,
        accepted_count=sum(1 for item in occurrences if item.accepted),
        rejected_count=sum(1 for item in occurrences if not item.accepted),
    )


@router.post(
    "/recurring",
    response_model=SeriesCreatedOut,
    status_code=status.HTTP_201_CREATED,
    summary="Créer une série",
)
def create_recurring(
    payload: RecurrenceIn,
    session: SessionDep,
    principal: CurrentPrincipal,
    skip_conflicts: bool = Query(default=True),
) -> SeriesCreatedOut:
    """Une série dont deux dates butent sur un conflit produit quand même les autres.

    `skip_conflicts=false` bascule en tout ou rien, pour l'utilisateur qui tient
    à la régularité de son créneau plutôt qu'à son volume.
    """
    regle, creees, ecartees = recurrence.create_series(
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
        attendees=payload.attendees,
        skip_conflicts=skip_conflicts,
    )
    session.commit()

    return SeriesCreatedOut(
        rule_id=regle.id,
        bookings=[BookingOut.of(item) for item in creees],
        skipped=[_occurrence(item) for item in ecartees],
    )
