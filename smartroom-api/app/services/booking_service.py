"""Écriture des réservations : vérifier, écrire, et survivre à une course.

Le moteur détecte le conflit avant l'insertion et produit un message
exploitable. La contrainte `ex_bookings_no_overlap` reste le dernier rempart :
entre la vérification et le COMMIT, une autre transaction peut prendre le
créneau. Cette fenêtre est étroite mais réelle, et c'est le seul endroit du code
où elle est traitée.
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import (
    ClosureError,
    NotFoundError,
    RuleViolationError,
    SlotConflictError,
)
from app.db.enums import BookingEventType, BookingSource, BookingStatus
from app.domain import conflicts as dom_conflicts
from app.domain import rules as dom_rules
from app.domain.types import RuleCode, TimeSlot
from app.models import (
    Booking,
    BookingAccessCode,
    BookingEvent,
    BookingParticipant,
    User,
)
from app.services.availability_service import (
    SlotReport,
    charger_salle,
    check_slot,
    en_utc,
    load_rules,
    to_range,
    to_slot,
)

FUSEAU = ZoneInfo(get_settings().timezone)
CRYPT = CryptContext(schemes=["bcrypt"], deprecated="auto")

#: `exclusion_violation` : la contrainte EXCLUDE a refusé l'écriture.
EXCLUSION_VIOLATION = "23P01"

#: Les codes qui ne relèvent pas d'un refus de règle mais d'un état de la salle.
FERMETURES = {RuleCode.FERMETURE, RuleCode.HORS_OUVERTURE}


@dataclass(frozen=True, slots=True)
class IssuedCode:
    """Code d'accès émis. Le clair ne sort qu'ici, une seule fois."""

    clear: str
    hint: str
    expires_at: datetime


def _traduire_course(erreur: IntegrityError) -> None:
    """Transforme une violation de contrainte EXCLUDE en conflit lisible.

    Toute autre violation d'intégrité est un défaut de code : elle remonte
    telle quelle plutôt que d'être déguisée en erreur métier.
    """
    sqlstate = getattr(getattr(erreur, "orig", None), "sqlstate", None)
    if sqlstate == EXCLUSION_VIOLATION:
        raise SlotConflictError(
            "Ce créneau vient d'être réservé par quelqu'un d'autre. "
            "Rafraîchissez la page pour voir les disponibilités à jour."
        ) from erreur
    raise erreur


def _appliquer(rapport: SlotReport, *, ignore_rules: bool) -> None:
    """Traduit le verdict en refus. Un chevauchement ne se force jamais."""
    bloquants = rapport.blocking
    if bloquants:
        raise SlotConflictError(dom_conflicts.describe(bloquants[0], FUSEAU))

    non_forcables = [item for item in rapport.violations if not item.forcible]
    if non_forcables:
        raise RuleViolationError(non_forcables[0].message, code=non_forcables[0].code.value)

    if ignore_rules or not rapport.violations:
        return

    premiere = rapport.violations[0]
    if premiere.code in FERMETURES:
        raise ClosureError(premiere.message)
    raise RuleViolationError(premiere.message, code=premiere.code.value)


def _journaliser(
    session: Session,
    reservation: Booking,
    event_type: BookingEventType,
    label: str,
    actor_id: uuid.UUID | None = None,
) -> None:
    session.add(
        BookingEvent(
            booking_id=reservation.id,
            event_type=event_type,
            label=label,
            occurred_at=datetime.now(FUSEAU),
            actor_user_id=actor_id,
        )
    )


def issue_access_code(session: Session, reservation: Booking) -> IssuedCode | None:
    """Émet un code temporaire si la salle exige un badge.

    Le clair est renvoyé à l'appelant et jamais persisté : la base ne garde que
    l'empreinte et un indice masqué.
    """
    salle = charger_salle(session, reservation.room_id)
    if not salle.badge_required:
        return None

    prefixe = salle.floor.building.code[0]
    clair = f"{prefixe}-{secrets.randbelow(9000) + 1000}"

    code = BookingAccessCode(
        booking_id=reservation.id,
        code_hash=CRYPT.hash(clair),
        code_hint=f"{prefixe}-****",
        issued_at=datetime.now(FUSEAU),
        expires_at=reservation.time_range.upper,
    )
    session.add(code)
    return IssuedCode(clear=clair, hint=code.code_hint, expires_at=code.expires_at)


def create_booking(
    session: Session,
    *,
    room_id: uuid.UUID,
    owner_id: uuid.UUID,
    slot: TimeSlot,
    title: str = "Réunion",
    attendees: int = 1,
    participants: Iterable[tuple[str, str]] = (),
    source: BookingSource = BookingSource.UTILISATEUR,
    created_by_admin_id: uuid.UUID | None = None,
    ignore_rules: bool = False,
    now: datetime | None = None,
) -> tuple[Booking, IssuedCode | None]:
    """Crée une réservation après vérification complète du créneau.

    Ne valide pas la transaction : le `commit` appartient à l'appelant, qui seul
    sait si d'autres écritures l'accompagnent.
    """
    now = en_utc(now or datetime.now(UTC))

    proprietaire = session.get(User, owner_id)
    if proprietaire is None or proprietaire.deleted_at is not None:
        raise NotFoundError("Utilisateur introuvable.")

    rapport = check_slot(
        session,
        room_id=room_id,
        slot=slot,
        attendees=attendees,
        requester_id=owner_id,
        now=now,
        check_quotas=not ignore_rules,
    )
    _appliquer(rapport, ignore_rules=ignore_rules)

    reservation = Booking(
        room_id=room_id,
        owner_id=owner_id,
        created_by_admin_id=created_by_admin_id,
        title=title,
        time_range=to_range(slot),
        attendee_count=attendees,
        status=BookingStatus.CONFIRMEE,
        source=source,
        is_forced=ignore_rules and bool(rapport.violations),
    )
    session.add(reservation)

    try:
        session.flush()
    except IntegrityError as erreur:
        _traduire_course(erreur)

    session.add(
        BookingParticipant(
            booking_id=reservation.id,
            user_id=owner_id,
            email=proprietaire.email,
            display_name=f"{proprietaire.first_name} {proprietaire.last_name}",
            is_organizer=True,
        )
    )
    for email, nom in participants:
        session.add(
            BookingParticipant(
                booking_id=reservation.id,
                email=email,
                display_name=nom,
                is_organizer=False,
            )
        )

    _journaliser(session, reservation, BookingEventType.CREATION, "Réservation créée", owner_id)
    code = issue_access_code(session, reservation)
    session.flush()
    return reservation, code


def create_blocking(
    session: Session,
    *,
    room_id: uuid.UUID,
    slot: TimeSlot,
    reason: str,
    created_by_admin_id: uuid.UUID,
    now: datetime | None = None,
) -> Booking:
    """Blocage administratif : la salle devient indisponible, sans organisateur.

    Exempté des bornes de durée — fermer une salle pour travaux dure la
    journée — et des horaires d'ouverture, mais jamais du chevauchement : la
    contrainte `EXCLUDE` s'applique à lui comme à tout le reste.
    """
    now = en_utc(now or datetime.now(UTC))
    if not reason.strip():
        raise RuleViolationError("Le motif du blocage est obligatoire.", code="motif_requis")

    rapport = check_slot(
        session, room_id=room_id, slot=slot, attendees=1, now=now, check_quotas=False
    )
    bloquants = rapport.blocking
    if bloquants:
        raise SlotConflictError(dom_conflicts.describe(bloquants[0], FUSEAU))

    blocage = Booking(
        room_id=room_id,
        owner_id=None,
        created_by_admin_id=created_by_admin_id,
        title=reason.strip(),
        time_range=to_range(slot),
        attendee_count=1,
        status=BookingStatus.CONFIRMEE,
        source=BookingSource.BLOCAGE,
        is_forced=True,
    )
    session.add(blocage)

    try:
        session.flush()
    except IntegrityError as erreur:
        _traduire_course(erreur)

    _journaliser(session, blocage, BookingEventType.CREATION, f"Blocage : {reason.strip()}")
    session.flush()
    return blocage


def update_booking(
    session: Session,
    booking_id: uuid.UUID,
    *,
    slot: TimeSlot | None = None,
    title: str | None = None,
    attendees: int | None = None,
    actor_id: uuid.UUID | None = None,
    ignore_rules: bool = False,
    now: datetime | None = None,
) -> Booking:
    """Déplace ou redimensionne une réservation.

    Le créneau visé est vérifié en ignorant la réservation elle-même : sans
    cela, elle entrerait en conflit avec sa propre position actuelle.
    """
    now = en_utc(now or datetime.now(UTC))
    reservation = _charger(session, booking_id)

    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Une réservation annulée ne se modifie plus.", code="deja_annulee")
    if reservation.time_range.upper <= now:
        raise RuleViolationError("Une réservation passée ne se modifie plus.", code="deja_passee")

    vise = slot or to_slot(reservation.time_range)
    effectif = attendees if attendees is not None else reservation.attendee_count

    if slot is not None or attendees is not None:
        rapport = check_slot(
            session,
            room_id=reservation.room_id,
            slot=vise,
            attendees=effectif,
            requester_id=reservation.owner_id,
            ignore_booking_id=reservation.id,
            now=now,
            check_quotas=not ignore_rules,
        )
        _appliquer(rapport, ignore_rules=ignore_rules)

    if slot is not None:
        reservation.time_range = to_range(slot)
    if title is not None:
        reservation.title = title
    if attendees is not None:
        reservation.attendee_count = attendees

    _journaliser(
        session, reservation, BookingEventType.MODIFICATION, "Réservation modifiée", actor_id
    )
    try:
        session.flush()
    except IntegrityError as erreur:
        _traduire_course(erreur)
    return reservation


def cancel_booking(
    session: Session,
    booking_id: uuid.UUID,
    *,
    reason: str,
    actor_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> Booking:
    """Annule une réservation. Le motif est obligatoire.

    Une annulation tardive n'est pas refusée — le créneau doit être libéré même
    au dernier moment — mais elle est signalée dans la frise.
    """
    now = en_utc(now or datetime.now(UTC))
    reservation = _charger(session, booking_id)

    if not reason.strip():
        raise RuleViolationError("Le motif d'annulation est obligatoire.", code="motif_requis")
    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation déjà annulée.", code="deja_annulee")

    salle = charger_salle(session, reservation.room_id)
    regles = load_rules(session, salle)
    dans_les_temps = dom_rules.can_cancel(to_slot(reservation.time_range), now, regles)

    reservation.status = BookingStatus.ANNULEE
    reservation.cancelled_at = now
    reservation.cancel_reason = reason.strip()

    for code in session.scalars(
        select(BookingAccessCode).where(
            BookingAccessCode.booking_id == reservation.id,
            BookingAccessCode.revoked_at.is_(None),
        )
    ):
        code.revoked_at = now

    _journaliser(
        session,
        reservation,
        BookingEventType.ANNULATION,
        "Annulée" if dans_les_temps else "Annulée hors délai",
        actor_id,
    )
    session.flush()
    return reservation


def check_in(
    session: Session,
    booking_id: uuid.UUID,
    *,
    code: str,
    now: datetime | None = None,
) -> Booking:
    """Valide la présence sur place, code d'accès à l'appui.

    La fenêtre est bornée des deux côtés : avant le début il n'y a rien à
    valider, après `checkin_window` le créneau est réputé libérable.
    """
    now = en_utc(now or datetime.now(UTC))
    reservation = _charger(session, booking_id)

    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation annulée.", code="deja_annulee")
    if reservation.checked_in_at is not None:
        raise RuleViolationError("Présence déjà validée.", code="deja_validee")

    salle = charger_salle(session, reservation.room_id)
    regles = load_rules(session, salle)
    creneau = to_slot(reservation.time_range)

    if now < creneau.start:
        raise RuleViolationError(
            "La validation ouvre au début du créneau.", code="trop_tot"
        )
    if now >= creneau.start + regles.checkin_window:
        raise RuleViolationError(
            f"Fenêtre de validation dépassée : {dom_rules.format_duree(regles.checkin_window)} "
            "après le début.",
            code="trop_tard",
        )

    if salle.badge_required:
        actif = session.scalars(
            select(BookingAccessCode).where(
                BookingAccessCode.booking_id == reservation.id,
                BookingAccessCode.revoked_at.is_(None),
            )
        ).first()
        if actif is None or not CRYPT.verify(code, actif.code_hash):
            raise RuleViolationError("Code d'accès incorrect.", code="code_invalide")

    reservation.checked_in_at = now
    _journaliser(session, reservation, BookingEventType.CHECKIN, "Présence validée",
                 reservation.owner_id)
    session.flush()
    return reservation


def release_no_shows(session: Session, now: datetime | None = None) -> list[Booking]:
    """Libère les créneaux commencés dont la présence n'a jamais été validée.

    Ne touche ni aux blocages administratifs, ni aux réservations terminées :
    libérer un créneau écoulé ne rendrait rien à personne.
    """
    now = en_utc(now or datetime.now(UTC))

    candidates = session.scalars(
        select(Booking).where(
            Booking.status == BookingStatus.CONFIRMEE,
            Booking.deleted_at.is_(None),
            Booking.checked_in_at.is_(None),
            Booking.owner_id.is_not(None),
            # `@>` : le créneau contient l'instant courant. L'opérateur emprunte
            # l'index GiST, là où `lower(...) <= now` le rendrait inutilisable.
            Booking.time_range.op("@>")(now),
        )
    ).all()

    liberees: list[Booking] = []
    for reservation in candidates:
        salle = charger_salle(session, reservation.room_id)
        regles = load_rules(session, salle)
        if not dom_rules.is_releasable(to_slot(reservation.time_range), now, None, regles):
            continue

        reservation.status = BookingStatus.ANNULEE
        reservation.cancelled_at = now
        reservation.cancel_reason = (
            "Libérée automatiquement : présence non validée dans les "
            f"{dom_rules.format_duree(regles.checkin_window)}."
        )
        _journaliser(
            session, reservation, BookingEventType.LIBERATION_AUTO, "Libérée automatiquement"
        )
        liberees.append(reservation)

    session.flush()
    return liberees


def close_finished_bookings(session: Session, now: datetime | None = None) -> int:
    """Passe en « terminée » les réservations dont le créneau est écoulé."""
    now = en_utc(now or datetime.now(UTC))

    terminees = session.scalars(
        select(Booking).where(
            Booking.status == BookingStatus.CONFIRMEE,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("<<")(Range(now, None, bounds="[)")),
        )
    ).all()

    for reservation in terminees:
        reservation.status = BookingStatus.TERMINEE
    session.flush()
    return len(terminees)


def _charger(session: Session, booking_id: uuid.UUID) -> Booking:
    reservation = session.scalars(
        select(Booking).where(Booking.id == booking_id, Booking.deleted_at.is_(None))
    ).one_or_none()
    if reservation is None:
        raise NotFoundError("Réservation introuvable.")
    return reservation
