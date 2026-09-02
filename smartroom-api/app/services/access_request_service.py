"""Demandes d'accès exceptionnel et leur arbitrage.

Une demande naît d'un refus : le moteur a dit non, l'utilisateur estime que son
cas le justifie. Elle ne contourne aucune règle par elle-même — c'est la
décision d'un administrateur qui, le cas échéant, crée la réservation en forçant
les règles. Le chevauchement, lui, reste hors d'atteinte.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError, RuleViolationError
from app.core.pagination import PageParams, paginate
from app.db.enums import AccessType, AuditAction, BookingSource, RequestStatus
from app.domain.types import TimeSlot
from app.models import AccessRequest, Room, User
from app.services import audit_service, booking_service

#: Champs de tri acceptés de la file d'arbitrage. Sans liste blanche,
#: `paginate` abandonne le tri demandé au lieu de le refuser.
TRI_DEMANDES: dict[str, Any] = {
    "created_at": AccessRequest.created_at,
    "status": AccessRequest.status,
    "reference": AccessRequest.reference,
}

from app.services.availability_service import check_slot, en_utc, to_range  # noqa: E402

#: Préfixe des références lisibles, repris tel quel par l'écran d'arbitrage.
#: Le croisillon fait partie du format imposé par `ck_access_requests_reference_format`.
PREFIXE = "#CONF"


def _reference(session: Session) -> str:
    """Référence courte et unique, du genre `#CONF-8492`.

    Un identifiant UUID ne se dicte pas au téléphone ; une référence courte, si.
    """
    suivant = session.scalar(select(func.count()).select_from(AccessRequest)) or 0
    return f"{PREFIXE}-{8000 + suivant + 1}"


def _requete() -> Any:
    return select(AccessRequest).options(
        selectinload(AccessRequest.room),
        selectinload(AccessRequest.requester),
        selectinload(AccessRequest.alternative_room),
    )


def list_mine(
    session: Session,
    params: PageParams,
    *,
    user_id: uuid.UUID,
    status: RequestStatus | None = None,
) -> tuple[list[AccessRequest], int]:
    """Demandes du compte connecté. Le filtre est dans la requête, pas après."""
    requete = (
        _requete()
        .where(AccessRequest.requester_id == user_id)
        .order_by(AccessRequest.created_at.desc())
    )
    if status is not None:
        requete = requete.where(AccessRequest.status == status)
    return paginate(session, requete, params, colonnes=TRI_DEMANDES)


def list_all(
    session: Session,
    params: PageParams,
    *,
    status: RequestStatus | None = None,
    room_id: uuid.UUID | None = None,
) -> tuple[list[AccessRequest], int]:
    requete = _requete().order_by(AccessRequest.created_at)
    if status is not None:
        requete = requete.where(AccessRequest.status == status)
    if room_id is not None:
        requete = requete.where(AccessRequest.room_id == room_id)
    return paginate(session, requete, params, colonnes=TRI_DEMANDES)


def get(session: Session, request_id: uuid.UUID) -> AccessRequest:
    demande = session.scalars(
        _requete().where(AccessRequest.id == request_id)
    ).one_or_none()
    if demande is None:
        raise NotFoundError("Demande introuvable.")
    return demande


def create(
    session: Session,
    *,
    requester_id: uuid.UUID,
    room_id: uuid.UUID,
    slot: TimeSlot,
    reason: str | None = None,
    now: datetime | None = None,
) -> AccessRequest:
    """Dépose une demande, après avoir constaté que le créneau est bien refusé.

    Déposer une demande sur un créneau libre n'aurait aucun sens : le type de
    dérogation est déduit du motif de refus, ce qui évite de le faire choisir à
    l'utilisateur — il ne connaît pas la règle qui le bloque.
    """
    now = en_utc(now or datetime.now(UTC))

    if session.get(Room, room_id) is None:
        raise NotFoundError("Salle introuvable.")

    rapport = check_slot(
        session, room_id=room_id, slot=slot, requester_id=requester_id, now=now
    )
    if rapport.available:
        raise RuleViolationError(
            "Ce créneau est disponible : réservez-le directement.", code="creneau_libre"
        )

    demande = AccessRequest(
        reference=_reference(session),
        requester_id=requester_id,
        room_id=room_id,
        requested_range=to_range(slot),
        access_type=_type_de_derogation(rapport),
        reason=reason,
        status=RequestStatus.OUVERT,
    )
    session.add(demande)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.CREATION,
        target_type="access_request",
        target_label=demande.reference,
        target_id=demande.id,
        after={"access_type": demande.access_type.value, "room_id": str(room_id)},
    )
    session.flush()
    return demande


def _type_de_derogation(rapport: Any) -> AccessType:
    """Déduit la nature de la dérogation du premier motif de refus."""
    from app.domain.types import RuleCode

    if rapport.blocking:
        return AccessType.CONFLIT_RESERVATION

    codes = {item.code for item in rapport.violations}
    if RuleCode.CAPACITE in codes:
        return AccessType.DEPASSEMENT_CAPACITE
    if RuleCode.FERMETURE in codes:
        return AccessType.HORS_JOUR_OUVERTURE
    if RuleCode.HORS_OUVERTURE in codes:
        return AccessType.HORS_HORAIRE
    return AccessType.HORS_HORAIRE


def decide(
    session: Session,
    request_id: uuid.UUID,
    *,
    decision: RequestStatus,
    admin_user_id: uuid.UUID,
    comment: str | None = None,
    alternative_room_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> AccessRequest:
    """Tranche une demande, et crée la réservation si elle est accordée.

    Accorder sans réserver laisserait l'utilisateur devant un créneau toujours
    refusé : la décision et son effet sont le même acte, dans la même
    transaction. Les règles sont forcées, jamais le chevauchement.
    """
    now = en_utc(now or datetime.now(UTC))
    demande = get(session, request_id)

    if demande.status is not RequestStatus.OUVERT:
        raise RuleViolationError(
            "Cette demande est déjà tranchée.", code="deja_decidee"
        )
    if decision is RequestStatus.OUVERT:
        raise RuleViolationError("Décision attendue.", code="decision_requise")
    if decision is RequestStatus.REORIENTE and alternative_room_id is None:
        raise RuleViolationError(
            "Une réorientation exige une salle de remplacement.",
            code="alternative_requise",
        )

    creneau = TimeSlot(
        start=demande.requested_range.lower, end=demande.requested_range.upper
    )
    salle_cible = alternative_room_id or demande.room_id

    if decision in {RequestStatus.ACCORDE, RequestStatus.REORIENTE}:
        reservation, _ = booking_service.create_booking(
            session,
            room_id=salle_cible,
            owner_id=demande.requester_id,
            slot=creneau,
            title=f"Accès exceptionnel {demande.reference}",
            attendees=1,
            source=BookingSource.ADMIN,
            created_by_admin_id=admin_user_id,
            ignore_rules=True,
            now=now,
        )
        demande.booking_id = reservation.id

    demande.status = decision
    demande.decided_by_admin_id = admin_user_id
    demande.decision_comment = comment
    demande.alternative_room_id = alternative_room_id
    demande.decided_at = now

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="access_request",
        target_label=demande.reference,
        target_id=demande.id,
        before={"status": RequestStatus.OUVERT.value},
        after={
            "status": decision.value,
            "alternative_room_id": str(alternative_room_id)
            if alternative_room_id
            else None,
            "booking_id": str(demande.booking_id) if demande.booking_id else None,
        },
    )
    session.flush()
    return demande


def claimants(session: Session, request_id: uuid.UUID) -> list[User]:
    """Autres demandeurs du même créneau, pour l'écran d'arbitrage."""
    demande = get(session, request_id)
    return list(
        session.scalars(
            select(User)
            .join(AccessRequest, AccessRequest.requester_id == User.id)
            .where(
                AccessRequest.room_id == demande.room_id,
                AccessRequest.status == RequestStatus.OUVERT,
                AccessRequest.requested_range.op("&&")(
                    Range(
                        demande.requested_range.lower,
                        demande.requested_range.upper,
                        bounds="[)",
                    )
                ),
            )
            .distinct()
        )
    )
