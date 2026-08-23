"""Service de réservation : écrire ce que le moteur de disponibilité autorise.

Le moteur rend un verdict, ce module écrit. Entre les deux subsiste une fenêtre
que rien d'applicatif ne peut fermer : une transaction concurrente peut prendre
le créneau après la vérification et avant l'insertion. C'est la contrainte
`ex_bookings_no_overlap` qui la ferme, et `_traduire_conflit` qui transforme son
refus en erreur métier lisible plutôt qu'en trace technique.

Aucune fonction de ce module ne valide la transaction : le commit appartient à
l'appelant, qui seul sait ce qui compose son unité de travail.
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ClosureError, NotFoundError, RuleViolationError, SlotConflictError
from app.db.enums import (
    BookingEventType,
    BookingSource,
    BookingStatus,
    ParticipantResponse,
)
from app.models import (
    Booking,
    BookingAccessCode,
    BookingEvent,
    BookingParticipant,
    User,
)
from app.services.availability import SlotVerdict, check_slot, fmt_heure
from app.services.rules import charger_salle, resolve_rules

FUSEAU = ZoneInfo(get_settings().timezone)

#: Même contexte que les mots de passe : un code d'accès est un secret court,
#: il se vérifie, il ne se relit pas.
CRYPT = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=10)

#: SQLSTATE de la violation d'exclusion — la double réservation refusée par la base.
EXCLUSION_VIOLATION = "23P01"


@dataclass(frozen=True, slots=True)
class IssuedCode:
    """Code d'accès émis. Le clair ne sort qu'une fois, ici."""

    clear: str
    hint: str
    expires_at: datetime


def _traduire_conflit(erreur: IntegrityError) -> None:
    """Transforme le refus de la base en erreur métier, ou relaie l'erreur.

    Sans cette traduction, une course perdue remonterait à l'utilisateur sous
    forme de trace SQL, alors qu'elle a un sens métier précis : quelqu'un vient
    de prendre le créneau.
    """
    sqlstate = getattr(getattr(erreur, "orig", None), "sqlstate", None)
    if sqlstate == EXCLUSION_VIOLATION:
        raise SlotConflictError(
            "Ce créneau vient d'être réservé par quelqu'un d'autre. "
            "Rafraîchissez la page pour voir les disponibilités à jour."
        ) from erreur
    raise erreur


def _appliquer_verdict(verdict: SlotVerdict, *, ignore_rules: bool) -> None:
    """Traduit un verdict en exception, ou laisse passer.

    Un chevauchement n'est jamais contournable ; les règles, la capacité et les
    fermetures le sont, mais seulement sur décision explicite d'un administrateur.
    """
    if verdict.blocking:
        message = next(c.message for c in verdict.conflicts if c.blocking)
        raise SlotConflictError(message)

    if ignore_rules:
        return

    if verdict.closure_error:
        raise ClosureError(verdict.closure_error)
    if verdict.capacity_error:
        raise RuleViolationError(verdict.capacity_error, code="capacite")
    if verdict.rule_errors:
        raise RuleViolationError(verdict.rule_errors[0])
    # Un battement insuffisant ne bloque pas la base, mais il enfreint la règle.
    if verdict.conflicts:
        raise RuleViolationError(verdict.conflicts[0].message, code="battement")


def emettre_code(session: Session, reservation: Booking) -> IssuedCode | None:
    """Émet un code d'accès temporaire si la salle exige un badge.

    Le clair est renvoyé à l'appelant — pour l'e-mail et l'écran de
    confirmation — et n'est jamais persisté : la base ne garde que l'empreinte
    et l'indice masqué.
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


def _journaliser(
    session: Session,
    reservation: Booking,
    type_evenement: BookingEventType,
    libelle: str,
    *,
    acteur_id: uuid.UUID | None = None,
    moment: datetime | None = None,
) -> None:
    session.add(
        BookingEvent(
            booking_id=reservation.id,
            event_type=type_evenement,
            label=libelle,
            actor_user_id=acteur_id,
            occurred_at=moment or datetime.now(FUSEAU),
        )
    )


def _inscrire_participants(
    session: Session,
    reservation: Booking,
    organisateur: User | None,
    invites: Iterable[tuple[str, str, uuid.UUID | None]],
) -> None:
    """Inscrit l'organisateur puis les invités, sans doublon d'adresse."""
    vues: set[str] = set()

    if organisateur is not None:
        session.add(
            BookingParticipant(
                booking_id=reservation.id,
                user_id=organisateur.id,
                email=organisateur.email,
                display_name=f"{organisateur.first_name} {organisateur.last_name}",
                is_organizer=True,
                response=ParticipantResponse.ACCEPTE,
                responded_at=datetime.now(FUSEAU),
            )
        )
        vues.add(organisateur.email.lower())

    for adresse, nom, user_id in invites:
        if adresse.lower() in vues:
            continue
        vues.add(adresse.lower())
        session.add(
            BookingParticipant(
                booking_id=reservation.id,
                user_id=user_id,
                email=adresse,
                display_name=nom,
            )
        )


def create_booking(
    session: Session,
    *,
    room_id: uuid.UUID,
    owner_id: uuid.UUID,
    creneau: Range[datetime],
    title: str = "Réunion",
    attendee_count: int = 1,
    participants: Iterable[tuple[str, str, uuid.UUID | None]] = (),
    source: BookingSource = BookingSource.UTILISATEUR,
    created_by_admin_id: uuid.UUID | None = None,
    ignore_rules: bool = False,
    recurrence_rule_id: uuid.UUID | None = None,
    maintenant: datetime | None = None,
) -> tuple[Booking, IssuedCode | None]:
    """Crée une réservation après vérification complète du créneau.

    `ignore_rules` lève les règles, la capacité et les fermetures — jamais un
    chevauchement, que la base refuserait de toute façon.
    """
    maintenant = maintenant or datetime.now(FUSEAU)

    proprietaire = session.get(User, owner_id)
    if proprietaire is None or proprietaire.deleted_at is not None:
        raise NotFoundError("Utilisateur introuvable.")

    verdict = check_slot(
        session,
        room_id=room_id,
        creneau=creneau,
        attendee_count=attendee_count,
        requester_id=owner_id,
        maintenant=maintenant,
    )
    _appliquer_verdict(verdict, ignore_rules=ignore_rules)

    reservation = Booking(
        room_id=room_id,
        owner_id=owner_id,
        created_by_admin_id=created_by_admin_id,
        recurrence_rule_id=recurrence_rule_id,
        title=title.strip() or "Réunion",
        time_range=creneau,
        attendee_count=attendee_count,
        status=BookingStatus.CONFIRMEE,
        source=source,
        is_forced=ignore_rules,
    )
    session.add(reservation)

    try:
        session.flush()
    except IntegrityError as erreur:
        session.rollback()
        _traduire_conflit(erreur)

    _inscrire_participants(session, reservation, proprietaire, participants)
    _journaliser(session, reservation, BookingEventType.CREATION, "Réservation créée", acteur_id=owner_id)
    _journaliser(session, reservation, BookingEventType.CONFIRMATION, "Confirmée", acteur_id=owner_id)

    code = emettre_code(session, reservation)
    session.flush()
    return reservation, code


def create_blocking(
    session: Session,
    *,
    room_id: uuid.UUID,
    creneau: Range[datetime],
    reason: str,
    created_by_admin_id: uuid.UUID,
    maintenant: datetime | None = None,
) -> Booking:
    """Blocage administratif : la salle devient indisponible, sans organisateur.

    Exempté des bornes de durée — fermer une salle pour travaux dure la
    journée — mais jamais du chevauchement.
    """
    maintenant = maintenant or datetime.now(FUSEAU)
    if not reason.strip():
        raise RuleViolationError("Le motif du blocage est obligatoire.", code="motif_requis")

    salle = charger_salle(session, room_id)
    regles = resolve_rules(session, salle)

    from app.services.availability import detect_conflicts

    conflits = detect_conflicts(session, salle, creneau, regles)
    bloquants = [c for c in conflits if c.blocking]
    if bloquants:
        raise SlotConflictError(bloquants[0].message)

    blocage = Booking(
        room_id=room_id,
        owner_id=None,
        created_by_admin_id=created_by_admin_id,
        title=reason.strip(),
        time_range=creneau,
        attendee_count=0,
        status=BookingStatus.CONFIRMEE,
        source=BookingSource.BLOCAGE,
    )
    session.add(blocage)

    try:
        session.flush()
    except IntegrityError as erreur:
        session.rollback()
        _traduire_conflit(erreur)

    _journaliser(session, blocage, BookingEventType.CREATION, "Blocage administratif")
    session.flush()
    return blocage


def update_booking(
    session: Session,
    booking_id: uuid.UUID,
    *,
    creneau: Range[datetime] | None = None,
    title: str | None = None,
    attendee_count: int | None = None,
    actor_id: uuid.UUID | None = None,
    ignore_rules: bool = False,
    maintenant: datetime | None = None,
) -> Booking:
    """Déplace ou redimensionne une réservation.

    Le créneau visé est vérifié en ignorant la réservation elle-même : sans
    cela, elle entrerait en conflit avec sa propre position actuelle.
    """
    maintenant = maintenant or datetime.now(FUSEAU)
    reservation = _charger(session, booking_id)

    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Une réservation annulée ne se modifie plus.", code="deja_annulee")
    if reservation.time_range.upper <= maintenant:
        raise RuleViolationError("Une réservation passée ne se modifie plus.", code="deja_passee")

    nouveau_creneau = creneau or reservation.time_range
    nouvel_effectif = attendee_count if attendee_count is not None else reservation.attendee_count

    if creneau is not None or attendee_count is not None:
        verdict = check_slot(
            session,
            room_id=reservation.room_id,
            creneau=nouveau_creneau,
            attendee_count=nouvel_effectif,
            requester_id=reservation.owner_id,
            ignore_booking_id=reservation.id,
            maintenant=maintenant,
        )
        _appliquer_verdict(verdict, ignore_rules=ignore_rules)

    if creneau is not None:
        reservation.time_range = creneau
    if title is not None:
        reservation.title = title.strip() or reservation.title
    if attendee_count is not None:
        reservation.attendee_count = attendee_count

    try:
        session.flush()
    except IntegrityError as erreur:
        session.rollback()
        _traduire_conflit(erreur)

    _journaliser(
        session, reservation, BookingEventType.MODIFICATION, "Réservation modifiée", acteur_id=actor_id
    )
    session.flush()
    return reservation


def cancel_booking(
    session: Session,
    booking_id: uuid.UUID,
    *,
    reason: str,
    actor_id: uuid.UUID | None = None,
    notify_participants: bool = True,
    maintenant: datetime | None = None,
) -> Booking:
    """Annule une réservation. Le motif est obligatoire.

    Une annulation tardive n'est pas refusée — le créneau doit être libéré même
    au dernier moment — mais elle est signalée dans la frise, où elle reste
    visible du support et alimente le score de fiabilité du compte.
    """
    maintenant = maintenant or datetime.now(FUSEAU)
    reservation = _charger(session, booking_id)

    if not reason.strip():
        raise RuleViolationError("Le motif d'annulation est obligatoire.", code="motif_requis")
    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation déjà annulée.", code="deja_annulee")
    if reservation.time_range.upper <= maintenant:
        raise RuleViolationError(
            "Une réservation passée ne peut plus être annulée.", code="deja_passee"
        )

    salle = charger_salle(session, reservation.room_id)
    regles = resolve_rules(session, salle)
    limite = reservation.time_range.lower - timedelta(minutes=regles.cancel_deadline_min)
    tardive = maintenant > limite

    reservation.status = BookingStatus.ANNULEE
    reservation.cancelled_at = maintenant
    reservation.cancel_reason = reason.strip()
    reservation.checked_in_at = None

    libelle = "Annulée hors délai" if tardive else "Annulée"
    if notify_participants:
        libelle += ", participants prévenus"
    _journaliser(session, reservation, BookingEventType.ANNULATION, libelle, acteur_id=actor_id)

    # Le code d'accès d'une réservation annulée ne doit plus ouvrir la porte.
    for code in session.scalars(
        select(BookingAccessCode).where(
            BookingAccessCode.booking_id == reservation.id,
            BookingAccessCode.revoked_at.is_(None),
        )
    ):
        code.revoked_at = maintenant

    session.flush()
    return reservation


def check_in(
    session: Session,
    booking_id: uuid.UUID,
    *,
    code: str,
    maintenant: datetime | None = None,
) -> Booking:
    """Valide la présence sur place, code d'accès à l'appui.

    La fenêtre est bornée des deux côtés : avant le début, il n'y a rien à
    valider ; après `checkin_window_min`, le créneau est réputé libérable.
    """
    maintenant = maintenant or datetime.now(FUSEAU)
    reservation = _charger(session, booking_id)

    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation annulée.", code="deja_annulee")
    if reservation.checked_in_at is not None:
        raise RuleViolationError("Présence déjà validée.", code="deja_validee")

    salle = charger_salle(session, reservation.room_id)
    regles = resolve_rules(session, salle)
    debut = reservation.time_range.lower
    limite = debut + timedelta(minutes=regles.checkin_window_min)

    if maintenant < debut:
        raise RuleViolationError(
            f"La validation ouvre à {fmt_heure(debut)}.", code="trop_tot"
        )
    if maintenant > limite:
        raise RuleViolationError(
            f"La fenêtre de validation s'est fermée à {fmt_heure(limite)}.", code="fenetre_fermee"
        )

    actif = session.scalars(
        select(BookingAccessCode).where(
            BookingAccessCode.booking_id == reservation.id,
            BookingAccessCode.revoked_at.is_(None),
        )
    ).first()

    if actif is None:
        raise RuleViolationError("Aucun code d'accès actif pour cette réservation.", code="sans_code")
    if not CRYPT.verify(code.strip(), actif.code_hash):
        raise RuleViolationError("Code d'accès incorrect.", code="code_invalide")

    reservation.checked_in_at = maintenant
    _journaliser(
        session,
        reservation,
        BookingEventType.CHECKIN,
        "Présence validée sur place",
        acteur_id=reservation.owner_id,
    )
    session.flush()
    return reservation


def release_no_shows(session: Session, maintenant: datetime | None = None) -> list[Booking]:
    """Libère les créneaux commencés dont la présence n'a jamais été validée.

    Ne touche ni aux blocages administratifs, ni aux réservations terminées :
    libérer un créneau déjà écoulé ne rendrait rien à personne. L'index partiel
    `idx_bookings_checkin_pending` sert exactement cette requête.
    """
    maintenant = maintenant or datetime.now(FUSEAU)

    candidates = session.scalars(
        select(Booking).where(
            Booking.status == BookingStatus.CONFIRMEE,
            Booking.checked_in_at.is_(None),
            Booking.deleted_at.is_(None),
            Booking.source != BookingSource.BLOCAGE,
        )
    ).all()

    liberees: list[Booking] = []
    for reservation in candidates:
        debut, fin = reservation.time_range.lower, reservation.time_range.upper
        if fin <= maintenant or debut > maintenant:
            continue

        salle = charger_salle(session, reservation.room_id)
        regles = resolve_rules(session, salle)
        if maintenant <= debut + timedelta(minutes=regles.checkin_window_min):
            continue

        reservation.status = BookingStatus.ANNULEE
        reservation.cancelled_at = maintenant
        reservation.cancel_reason = (
            f"Libérée automatiquement : présence non validée dans les "
            f"{regles.checkin_window_min} minutes."
        )
        _journaliser(
            session,
            reservation,
            BookingEventType.LIBERATION_AUTO,
            "Créneau libéré, présence non validée",
        )
        liberees.append(reservation)

    session.flush()
    return liberees


def close_finished_bookings(session: Session, maintenant: datetime | None = None) -> int:
    """Passe en « terminée » les réservations dont le créneau est écoulé.

    Distinct de la libération : une réunion qui a eu lieu n'est pas annulée,
    elle est close — et son absence de check-in reste un no-show mesurable.
    """
    maintenant = maintenant or datetime.now(FUSEAU)
    closes = 0
    for reservation in session.scalars(
        select(Booking).where(
            Booking.status == BookingStatus.CONFIRMEE,
            Booking.deleted_at.is_(None),
        )
    ):
        if reservation.time_range.upper <= maintenant:
            reservation.status = BookingStatus.TERMINEE
            closes += 1
    session.flush()
    return closes


def _charger(session: Session, booking_id: uuid.UUID) -> Booking:
    reservation = session.get(Booking, booking_id)
    if reservation is None or reservation.deleted_at is not None:
        raise NotFoundError("Réservation introuvable.")
    return reservation
