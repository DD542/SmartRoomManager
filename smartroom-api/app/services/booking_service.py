"""Écriture des réservations : vérifier, écrire, et survivre à une course.

Le moteur détecte le conflit avant l'insertion et produit un message
exploitable. La contrainte `ex_bookings_no_overlap` reste le dernier rempart :
entre la vérification et le COMMIT, une autre transaction peut prendre le
créneau. Cette fenêtre est étroite mais réelle, et c'est le seul endroit du code
où elle est traitée.
"""

from __future__ import annotations

import logging
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
from app.core.security import (
    TokenError,
    create_invitation_token,
    decode_invitation_token,
)
from app.db.enums import (
    AuditAction,
    BookingEventType,
    BookingSource,
    BookingStatus,
    ParticipantResponse,
)
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
from app.services import audit_service, mail_service
from app.services.availability_service import (
    SlotReport,
    charger_salle,
    check_slot,
    en_utc,
    load_rules,
    to_range,
    to_slot,
)

logger = logging.getLogger(__name__)

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


def _conflit_enrichi(
    session: Session, rapport: SlotReport, *, attendees: int, user_id: uuid.UUID | None
) -> SlotConflictError:
    """Assemble un 409 porteur du conflit qualifié et des alternatives.

    Les alternatives sont calculées ici pour que l'écran de conflit les affiche
    sans second aller-retour réseau. Si leur calcul échoue — parc vide, salle
    archivée — le refus part quand même : un conflit doit être annoncé, même
    sans consolation à proposer.
    """
    bloquant = rapport.blocking[0]
    message = dom_conflicts.describe(bloquant, FUSEAU)

    try:
        from app.services import recommendation_service

        propositions = recommendation_service.suggest_alternatives(
            session,
            room_id=rapport.room_id,
            slot=rapport.slot,
            attendees=attendees,
            user_id=user_id,
            limit=5,
        )
    except Exception:  # noqa: BLE001
        logger.warning("Alternatives indisponibles pour ce conflit", exc_info=True)
        propositions = ()

    from app.api.v1.schemas import AlternativeOut, ConflictOut

    return SlotConflictError(
        message,
        conflict=ConflictOut.of(bloquant, message).model_dump(mode="json"),
        alternatives=[
            AlternativeOut.of(item).model_dump(mode="json") for item in propositions
        ],
    )


def _appliquer(rapport: SlotReport, *, ignore_rules: bool) -> None:
    """Traduit le verdict en refus. Un chevauchement ne se force jamais."""
    bloquants = rapport.blocking
    if bloquants:
        raise SlotConflictError(dom_conflicts.describe(bloquants[0], FUSEAU))

    non_forcables = [item for item in rapport.violations if not item.forcible]
    if non_forcables:
        raise RuleViolationError(
            non_forcables[0].message, code=non_forcables[0].code.value
        )

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


def issue_access_code(
    session: Session, reservation: Booking, *, now: datetime | None = None
) -> IssuedCode | None:
    """Émet un code temporaire si la salle exige un badge.

    Le clair est renvoyé à l'appelant et jamais persisté : la base ne garde que
    l'empreinte et un indice masqué.

    `now` suit celui de l'appelant : lire l'horloge système ici produirait un
    `issued_at` postérieur à `expires_at` dès que la réservation est datée
    autrement que « maintenant » — ce que `ck_booking_access_codes_expiry`
    refuse, en signalant une incohérence qui n'est pas celle de l'appelant.
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
        issued_at=now or datetime.now(FUSEAU),
        expires_at=reservation.time_range.upper,
    )
    session.add(code)
    return IssuedCode(clear=clair, hint=code.code_hint, expires_at=code.expires_at)


def reissue_access_code(
    session: Session,
    booking_id: uuid.UUID,
    *,
    owner_id: uuid.UUID,
    now: datetime | None = None,
) -> IssuedCode:
    """Émet un nouveau code d'accès pour une réservation, et révoque l'ancien.

    Le code en clair n'existe qu'à l'instant de son émission : la base n'en
    garde qu'une empreinte et un indice masqué. Un utilisateur qui a perdu le
    sien n'a donc aucun moyen de le relire — et l'écran lui proposait pourtant
    de « révéler » ce que personne ne détenait plus.

    Le réémettre est la seule réponse honnête. L'ancien est révoqué au même
    instant : deux codes valables pour une même porte, c'est un code de trop.

    Le propriétaire est vérifié dans la requête. Une réservation d'autrui est
    introuvable, pas interdite.
    """
    now = en_utc(now or datetime.now(UTC))

    reservation = session.scalars(
        select(Booking).where(
            Booking.id == booking_id,
            Booking.owner_id == owner_id,
            Booking.deleted_at.is_(None),
        )
    ).one_or_none()
    if reservation is None:
        raise NotFoundError("Réservation introuvable.")

    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError(
            "Cette réservation est annulée : aucun code ne peut être émis.",
            code="reservation_annulee",
        )
    if reservation.time_range.upper <= now:
        raise RuleViolationError(
            "Ce créneau est terminé : le code n'a plus d'usage.",
            code="creneau_termine",
        )

    salle = charger_salle(session, reservation.room_id)
    if not salle.badge_required:
        raise RuleViolationError(
            f"{salle.name} ne demande pas de code d'accès.", code="badge_non_requis"
        )

    ancien = session.scalars(
        select(BookingAccessCode).where(
            BookingAccessCode.booking_id == reservation.id,
            BookingAccessCode.revoked_at.is_(None),
        )
    ).one_or_none()
    if ancien is not None:
        ancien.revoked_at = now
        # Vidé avant l'insertion du nouveau : l'index d'unicité ne tolère qu'un
        # code actif par réservation, et il est vérifié à la fin de l'instruction.
        session.flush()

    code = issue_access_code(session, reservation, now=now)
    if code is None:  # pragma: no cover - `badge_required` est déjà vérifié
        raise RuleViolationError(
            "Aucun code n'a pu être émis.", code="code_indisponible"
        )

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="booking",
        target_label=f"{salle.name} — {reservation.title}",
        target_id=reservation.id,
        before={"Code d'accès": ancien.code_hint if ancien else "aucun"},
        after={"Code d'accès": code.hint, "Émis le": now.isoformat()},
    )
    return code


def _inviter(
    session: Session, reservation: Booking, participant: BookingParticipant
) -> str:
    """Émet le jeton de réponse d'un participant et prépare son courriel.

    Les deux ensemble, et jamais l'un sans l'autre : le jeton était bien créé
    et rendu à l'écran, la description de la route annonçait même qu'il
    « part dans le courriel » — et rien ne l'envoyait. Un invité ne recevait
    donc aucune invitation, et l'organisateur l'apprenait en réunion.

    Le jeton expire avec le créneau : répondre à une réunion passée n'a aucun
    sens, ce qui dispense d'une table de révocation.
    """
    jeton = create_invitation_token(
        booking_id=reservation.id,
        participant_id=participant.id,
        expires_at=reservation.time_range.upper,
    )

    proprietaire = (
        session.get(User, reservation.owner_id) if reservation.owner_id else None
    )
    salle = charger_salle(session, reservation.room_id)
    mail_service.queue_invitation(
        email=participant.email,
        nom=participant.display_name or participant.email,
        organisateur=(
            f"{proprietaire.first_name} {proprietaire.last_name}"
            if proprietaire
            else "L'administration"
        ),
        titre=reservation.title,
        salle=salle.name,
        debut=reservation.time_range.lower,
        fin=reservation.time_range.upper,
        jeton=jeton,
    )
    return jeton


def _prevenir(
    session: Session,
    reservation: Booking,
    code_gabarit: str,
    *,
    code_acces: str | None = None,
) -> None:
    """Notifie l'organisateur d'un événement de sa réservation.

    Ici et non dans la route : la création passe par deux chemins — l'écran de
    réservation et l'écran d'administration —, l'annulation par trois. Un
    gabarit déclenché depuis la route aurait manqué les autres, et c'est
    exactement ce qui s'était produit : les gabarits « confirmation » et
    « annulation » étaient actifs, décrits par leur propre déclencheur, et
    aucune ligne de code ne les appelait. L'administration les montrait activés
    depuis l'écran A-16, l'écran d'annulation proposait de prévenir les
    participants — et rien ne partait jamais.

    La notification est écrite dans la même transaction que l'événement : un
    ROLLBACK emporte les deux, un COMMIT les garde ensemble.
    """
    if reservation.owner_id is None:
        # Un blocage administratif n'a pas d'organisateur : personne à prévenir.
        return

    proprietaire = session.get(User, reservation.owner_id)
    if proprietaire is None:
        return

    salle = charger_salle(session, reservation.room_id)
    variables = {
        "salle": salle.name,
        "batiment": f"{salle.floor.building.name} — {salle.floor.label}",
        "lien_reservation": mail_service.lien_reservation(reservation.id),
        **mail_service.date_et_creneau(
            reservation.time_range.lower, reservation.time_range.upper
        ),
    }
    if code_acces is not None:
        variables["code_acces"] = code_acces

    mail_service.notify(
        session,
        user=proprietaire,
        code=code_gabarit,
        variables=variables,
        booking_id=reservation.id,
    )


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
    if rapport.blocking:
        raise _conflit_enrichi(session, rapport, attendees=attendees, user_id=owner_id)
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
    # L'organisateur est déjà dans la liste : s'inviter soi-même n'ajoute
    # personne, et la contrainte d'unicité le refusait par un « Cette valeur est
    # déjà utilisée » qui ne disait pas de quelle valeur il s'agissait.
    for email, nom in participants:
        if email.strip().lower() == proprietaire.email.strip().lower():
            raise RuleViolationError(
                "Vous organisez déjà cette réunion : inutile de vous y inviter.",
                code="organisateur_invite",
            )
        invite = BookingParticipant(
            booking_id=reservation.id,
            email=email,
            display_name=nom,
            is_organizer=False,
        )
        session.add(invite)
        # `flush` avant l'invitation : le jeton porte l'identifiant du
        # participant, que la base attribue à l'écriture.
        session.flush()
        _inviter(session, reservation, invite)

    _journaliser(
        session, reservation, BookingEventType.CREATION, "Réservation créée", owner_id
    )
    code = issue_access_code(session, reservation, now=now)
    # Le clair n'existe qu'ici, et le courriel de confirmation est le seul
    # endroit où l'utilisateur pourra le relire : l'écran ne le montre qu'une
    # fois, la base n'en garde que l'empreinte.
    _prevenir(
        session,
        reservation,
        "reservation_confirmation",
        code_acces=code.clear if code else None,
    )
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
        raise RuleViolationError(
            "Le motif du blocage est obligatoire.", code="motif_requis"
        )

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

    _journaliser(
        session, blocage, BookingEventType.CREATION, f"Blocage : {reason.strip()}"
    )
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
        raise RuleViolationError(
            "Une réservation annulée ne se modifie plus.", code="deja_annulee"
        )
    if reservation.time_range.upper <= now:
        raise RuleViolationError(
            "Une réservation passée ne se modifie plus.", code="deja_passee"
        )

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
        session,
        reservation,
        BookingEventType.MODIFICATION,
        "Réservation modifiée",
        actor_id,
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

    Une présence validée, en revanche, ferme la porte : on ne défait pas une
    occupation constatée. La base le disait déjà — `ck_bookings_cancelled_not_
    checked_in` — mais elle le disait au `flush`, en `IntegrityError`, donc en
    500. La règle vit ici, où elle se lit et où elle rend une phrase.
    """
    now = en_utc(now or datetime.now(UTC))
    reservation = _charger(session, booking_id)

    if not reason.strip():
        raise RuleViolationError(
            "Le motif d'annulation est obligatoire.", code="motif_requis"
        )
    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation déjà annulée.", code="deja_annulee")
    if reservation.checked_in_at is not None:
        raise RuleViolationError(
            "Votre présence est déjà validée : cette réservation ne peut plus être annulée.",
            code="deja_validee",
        )

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
    _prevenir(session, reservation, "reservation_annulation")
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
    _journaliser(
        session,
        reservation,
        BookingEventType.CHECKIN,
        "Présence validée",
        reservation.owner_id,
    )
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
        if not dom_rules.is_releasable(
            to_slot(reservation.time_range), now, None, regles
        ):
            continue

        reservation.status = BookingStatus.ANNULEE
        reservation.cancelled_at = now
        reservation.cancel_reason = (
            "Libérée automatiquement : présence non validée dans les "
            f"{dom_rules.format_duree(regles.checkin_window)}."
        )
        _journaliser(
            session,
            reservation,
            BookingEventType.LIBERATION_AUTO,
            "Libérée automatiquement",
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


# --------------------------------------------------------------------------- #
# Participants
# --------------------------------------------------------------------------- #


def list_participants(
    session: Session, booking_id: uuid.UUID
) -> list[BookingParticipant]:
    _charger(session, booking_id)
    return list(
        session.scalars(
            select(BookingParticipant)
            .where(BookingParticipant.booking_id == booking_id)
            .order_by(
                BookingParticipant.is_organizer.desc(), BookingParticipant.display_name
            )
        )
    )


def add_participant(
    session: Session, booking_id: uuid.UUID, *, email: str, display_name: str
) -> tuple[BookingParticipant, str]:
    """Invite un participant et renvoie son jeton de réponse.

    L'effectif annoncé n'est pas recalculé depuis la liste : on réserve pour
    douze personnes dont on n'invite nommément que trois, et la capacité se
    juge sur l'effectif, pas sur le nombre d'invitations envoyées.
    """
    reservation = _charger(session, booking_id)
    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation annulée.", code="deja_annulee")

    deja = session.scalars(
        select(BookingParticipant).where(
            BookingParticipant.booking_id == booking_id,
            BookingParticipant.email == email,
        )
    ).one_or_none()
    if deja is not None:
        raise RuleViolationError(
            f"{email} figure déjà parmi les participants.", code="doublon"
        )

    participant = BookingParticipant(
        booking_id=booking_id,
        email=email,
        display_name=display_name,
        is_organizer=False,
    )
    session.add(participant)
    session.flush()

    return participant, _inviter(session, reservation, participant)


def remove_participant(
    session: Session, booking_id: uuid.UUID, participant_id: uuid.UUID
) -> None:
    participant = session.scalars(
        select(BookingParticipant).where(
            BookingParticipant.id == participant_id,
            BookingParticipant.booking_id == booking_id,
        )
    ).one_or_none()
    if participant is None:
        raise NotFoundError("Participant introuvable.")
    if participant.is_organizer:
        raise RuleViolationError(
            "L'organisateur ne se retire pas de sa propre réservation.",
            code="organisateur",
        )

    session.delete(participant)
    session.flush()


def respond_to_invitation(
    session: Session, *, token: str, response: ParticipantResponse
) -> BookingParticipant:
    """Enregistre la réponse d'un invité, sans exiger de compte.

    Le jeton porte l'identité : un participant extérieur n'a pas de session,
    et lui en imposer une pour cliquer « je viens » ferait tomber le taux de
    réponse à zéro.
    """
    try:
        booking_id, participant_id = decode_invitation_token(token)
    except TokenError as erreur:
        raise NotFoundError(
            "Invitation inconnue ou expirée.", code="jeton_invalide"
        ) from erreur

    participant = session.scalars(
        select(BookingParticipant).where(
            BookingParticipant.id == participant_id,
            BookingParticipant.booking_id == booking_id,
        )
    ).one_or_none()
    if participant is None:
        raise NotFoundError("Invitation inconnue.")

    reservation = _charger(session, booking_id)
    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError(
            "Cette réservation a été annulée.", code="deja_annulee"
        )

    participant.response = response
    participant.responded_at = datetime.now(FUSEAU)
    session.flush()
    return participant


def mark_late(
    session: Session,
    booking_id: uuid.UUID,
    *,
    delai_min: int | None = None,
    now: datetime | None = None,
) -> Booking:
    """Signale un retard : le créneau reste réservé au-delà de la fenêtre.

    Sans cela, la tâche de libération rendrait la salle à quelqu'un qui arrive
    avec dix minutes de retard. La marque vaut validation de présence.

    `delai_min` est une annonce, facultative : « j'arrive dans un quart
    d'heure ». Elle ne décale aucune règle — la présence est validée dans les
    deux cas, et la salle gardée de la même façon. Elle est écrite au journal,
    pour l'occupant suivant et pour l'administration ; la garder en mémoire
    vive reviendrait à ne pas la demander.
    """
    now = en_utc(now or datetime.now(UTC))
    reservation = _charger(session, booking_id)

    if reservation.status is BookingStatus.ANNULEE:
        raise RuleViolationError("Réservation annulée.", code="deja_annulee")
    if reservation.checked_in_at is not None:
        raise RuleViolationError("Présence déjà validée.", code="deja_validee")

    creneau = to_slot(reservation.time_range)
    if now < creneau.start:
        raise RuleViolationError("Le créneau n'a pas encore commencé.", code="trop_tot")
    if now >= creneau.end:
        raise RuleViolationError("Le créneau est écoulé.", code="passe")

    if delai_min is not None:
        duree_creneau = int((creneau.end - creneau.start).total_seconds() // 60)
        if delai_min < 1:
            raise RuleViolationError(
                "Un retard se compte en minutes entières.", code="delai_invalide"
            )
        # Au-delà du créneau, ce n'est plus un retard : c'est une absence, et
        # la salle a vocation à repartir à quelqu'un d'autre.
        if delai_min > duree_creneau:
            raise RuleViolationError(
                f"Un retard ne peut pas dépasser la durée du créneau "
                f"({duree_creneau} minutes).",
                code="delai_trop_long",
            )

    reservation.checked_in_at = now
    _journaliser(
        session,
        reservation,
        BookingEventType.CHECKIN,
        (
            f"Arrivée tardive signalée — environ {delai_min} minutes"
            if delai_min is not None
            else "Arrivée tardive signalée"
        ),
        reservation.owner_id,
    )
    session.flush()
    return reservation
