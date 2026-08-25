"""Règles de réservation, horaires d'ouverture et fermetures exceptionnelles.

Trois référentiels, une même logique de portée : une ligne « salle » coiffe une
ligne « bâtiment », qui coiffe la ligne « globale ». Le moteur résout cette
hiérarchie à chaque vérification ; ce module ne fait que la tenir à jour.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError, RuleViolationError
from app.core.pagination import PageParams, paginate
from app.db.enums import AuditAction, ClosureKind, RuleScope
from app.models import (
    Booking,
    BookingRule,
    Building,
    ClosureBuilding,
    ClosurePeriod,
    ClosureRoom,
    OpeningHour,
    Room,
)
from app.services import audit_service


#: Champs de tri acceptés. Sans liste blanche, `paginate` abandonne le tri
#: demandé au lieu de le refuser : l'écran afficherait un ordre qu'il n'a pas
#: demandé, en croyant l'avoir obtenu.
TRI_FERMETURES: dict[str, Any] = {
    "label": ClosurePeriod.label,
    "date_span": ClosurePeriod.date_span,
    "created_at": ClosurePeriod.created_at,
}


CHAMPS_REGLE = (
    "min_duration_min",
    "max_duration_min",
    "buffer_min",
    "max_advance_days",
    "min_advance_min",
    "cancel_deadline_min",
    "checkin_window_min",
    "weekly_quota_hours",
    "max_active_bookings",
    "validation_capacity_threshold",
)


def _perimetre(
    session: Session,
    scope: RuleScope,
    building_id: uuid.UUID | None,
    room_id: uuid.UUID | None,
) -> str:
    """Nomme la cible d'une surcharge pour le journal d'audit.

    « portée salle » ne dit pas laquelle : deux surcharges concurrentes sur
    deux salles produisaient des entrées identiques, et la trace ne permettait
    plus de savoir laquelle avait bougé.
    """
    if scope is RuleScope.SALLE and room_id is not None:
        nom = session.scalar(select(Room.name).where(Room.id == room_id))
        return f"salle {nom}" if nom else f"salle {room_id}"
    if scope is RuleScope.BATIMENT and building_id is not None:
        nom = session.scalar(select(Building.name).where(Building.id == building_id))
        return f"bâtiment {nom}" if nom else f"bâtiment {building_id}"
    return "établissement entier"


def _cible(scope: RuleScope, building_id: uuid.UUID | None, room_id: uuid.UUID | None) -> None:
    """La portée dicte la cible : une contrainte de base l'exige déjà, autant
    l'expliquer avant que PostgreSQL ne s'en charge sans message lisible."""
    if scope is RuleScope.SALLE and room_id is None:
        raise RuleViolationError("La portée « salle » exige une salle.", code="cible")
    if scope is RuleScope.BATIMENT and building_id is None:
        raise RuleViolationError(
            "La portée « bâtiment » exige un bâtiment.", code="cible"
        )
    if scope is RuleScope.GLOBAL and (room_id is not None or building_id is not None):
        raise RuleViolationError(
            "La portée « globale » ne cible ni salle ni bâtiment.", code="cible"
        )


# --------------------------------------------------------------------------- #
# Règles de réservation
# --------------------------------------------------------------------------- #


def list_rules(
    session: Session,
    *,
    scope: RuleScope | None = None,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> list[BookingRule]:
    requete = select(BookingRule)
    if scope is not None:
        requete = requete.where(BookingRule.scope == scope)
    if building_id is not None:
        requete = requete.where(BookingRule.building_id == building_id)
    if room_id is not None:
        requete = requete.where(BookingRule.room_id == room_id)
    return list(session.scalars(requete.order_by(BookingRule.scope)))


def resolve_rule_for_room(session: Session, room_id: uuid.UUID) -> BookingRule | None:
    """Règle effectivement appliquée à une salle, la plus spécifique d'abord."""
    from app.services.availability_service import charger_salle

    salle = charger_salle(session, room_id)
    for portee, condition in (
        (RuleScope.SALLE, BookingRule.room_id == salle.id),
        (RuleScope.BATIMENT, BookingRule.building_id == salle.floor.building_id),
        (RuleScope.GLOBAL, BookingRule.id.is_not(None)),
    ):
        regle = session.scalars(
            select(BookingRule).where(BookingRule.scope == portee, condition).limit(1)
        ).one_or_none()
        if regle is not None:
            return regle
    return None


def resolve_openings_for_room(session: Session, room_id: uuid.UUID) -> list[OpeningHour]:
    """Horaires effectivement appliqués à une salle, portée la plus fine d'abord.

    La résolution reproduit celle du moteur : par portée entière, la première qui
    déclare une ouverture l'emporte. Les jours fermés de cette portée sont rendus
    eux aussi, sans quoi l'écran afficherait une semaine amputée au lieu d'un
    dimanche explicitement fermé.
    """
    from app.services.availability_service import charger_salle

    salle = charger_salle(session, room_id)
    for portee, condition in (
        (RuleScope.SALLE, OpeningHour.room_id == salle.id),
        (RuleScope.BATIMENT, OpeningHour.building_id == salle.floor.building_id),
        (RuleScope.GLOBAL, OpeningHour.id.is_not(None)),
    ):
        lignes = list(
            session.scalars(
                select(OpeningHour)
                .where(OpeningHour.scope == portee, condition)
                .order_by(OpeningHour.weekday)
            )
        )
        if any(item.is_open for item in lignes):
            return lignes
    return []


def upsert_rule(
    session: Session,
    payload: Any,
    *,
    scope: RuleScope,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> BookingRule:
    """Crée ou remplace la règle d'une portée.

    `PUT` plutôt que `POST` : il n'existe qu'une règle par portée, et la
    contrainte d'unicité en base le garantit. Créer ou modifier n'a donc pas à
    exiger deux appels différents du front.
    """
    _cible(scope, building_id, room_id)

    regle = session.scalars(
        select(BookingRule).where(
            BookingRule.scope == scope,
            BookingRule.building_id.is_(building_id)
            if building_id is None
            else BookingRule.building_id == building_id,
            BookingRule.room_id.is_(room_id)
            if room_id is None
            else BookingRule.room_id == room_id,
        )
    ).one_or_none()

    creation = regle is None
    avant = None if creation else audit_service.snapshot(regle, CHAMPS_REGLE)

    if creation:
        regle = BookingRule(scope=scope, building_id=building_id, room_id=room_id)
        session.add(regle)

    for champ, valeur in payload.model_dump(exclude_unset=True).items():
        setattr(regle, champ, valeur)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.CREATION if creation else AuditAction.MODIFICATION,
        target_type="booking_rule",
        target_label=f"Règles — {_perimetre(session, scope, building_id, room_id)}",
        target_id=regle.id,
        before=avant,
        after=audit_service.snapshot(regle, CHAMPS_REGLE),
    )
    session.flush()
    return regle


def preview_rule(session: Session, payload: Any, *, days: int = 30) -> dict[str, Any]:
    """Mesure l'effet d'une règle sur l'historique récent, sans rien écrire.

    L'écran A-09 annonce « 12 réservations existantes deviendraient non
    conformes » : le calcul se fait ici, sur les réservations réelles, plutôt
    que sur une estimation.
    """
    depuis = datetime.now(UTC) - timedelta(days=days)
    reservations = list(
        session.scalars(
            select(Booking).where(
                Booking.deleted_at.is_(None),
                Booking.time_range.op("&&")(Range(depuis, None, bounds="[)")),
            )
        )
    )

    trop_courtes = trop_longues = trop_grandes = 0
    for reservation in reservations:
        duree = reservation.time_range.upper - reservation.time_range.lower
        minutes = duree.total_seconds() / 60
        if minutes < payload.min_duration_min:
            trop_courtes += 1
        if minutes > payload.max_duration_min:
            trop_longues += 1
        seuil = payload.validation_capacity_threshold
        if seuil is not None and reservation.attendee_count >= seuil:
            trop_grandes += 1

    return {
        "examined": len(reservations),
        "too_short": trop_courtes,
        "too_long": trop_longues,
        "would_need_validation": trop_grandes,
        "window_days": days,
    }


# --------------------------------------------------------------------------- #
# Horaires d'ouverture
# --------------------------------------------------------------------------- #


def list_openings(
    session: Session,
    *,
    scope: RuleScope | None = None,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> list[OpeningHour]:
    requete = select(OpeningHour)
    if scope is not None:
        requete = requete.where(OpeningHour.scope == scope)
    if building_id is not None:
        requete = requete.where(OpeningHour.building_id == building_id)
    if room_id is not None:
        requete = requete.where(OpeningHour.room_id == room_id)
    return list(session.scalars(requete.order_by(OpeningHour.weekday)))


def replace_openings(
    session: Session,
    windows: list[Any],
    *,
    scope: RuleScope,
    building_id: uuid.UUID | None = None,
    room_id: uuid.UUID | None = None,
) -> list[OpeningHour]:
    """Remplace en bloc les horaires d'une portée.

    Le remplacement est total et non incrémental : la résolution se fait par
    portée entière, et un lundi manquant hériterait du bâtiment, créant une
    amplitude incohérente avec le reste de la semaine.
    """
    _cible(scope, building_id, room_id)

    jours = [item.weekday for item in windows]
    if len(jours) != len(set(jours)):
        raise RuleViolationError(
            "Un jour de la semaine ne peut être défini qu'une fois.", code="doublon"
        )

    session.execute(
        delete(OpeningHour).where(
            OpeningHour.scope == scope,
            OpeningHour.building_id.is_(building_id)
            if building_id is None
            else OpeningHour.building_id == building_id,
            OpeningHour.room_id.is_(room_id)
            if room_id is None
            else OpeningHour.room_id == room_id,
        )
    )

    creees = [
        OpeningHour(
            scope=scope,
            building_id=building_id,
            room_id=room_id,
            weekday=fenetre.weekday,
            is_open=fenetre.is_open,
            opens_at=fenetre.opens_at,
            closes_at=fenetre.closes_at,
        )
        for fenetre in windows
    ]
    session.add_all(creees)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="opening_hours",
        target_label=f"Horaires — {_perimetre(session, scope, building_id, room_id)}",
        after={"days": len(creees), "scope": scope.value},
    )
    session.flush()
    return creees


# --------------------------------------------------------------------------- #
# Fermetures exceptionnelles
# --------------------------------------------------------------------------- #


def list_closures(
    session: Session,
    params: PageParams,
    *,
    first_day: date | None = None,
    last_day: date | None = None,
) -> tuple[list[ClosurePeriod], int]:
    requete = (
        select(ClosurePeriod)
        .options(
            selectinload(ClosurePeriod.buildings),
            selectinload(ClosurePeriod.rooms),
        )
        .order_by(ClosurePeriod.date_span)
    )
    if first_day is not None or last_day is not None:
        periode = Range(first_day, (last_day + timedelta(days=1)) if last_day else None,
                        bounds="[)")
        requete = requete.where(ClosurePeriod.date_span.op("&&")(periode))

    return paginate(session, requete, params, colonnes=TRI_FERMETURES)


def create_closure(session: Session, payload: Any) -> ClosurePeriod:
    """Crée une fermeture et la rattache à ses cibles.

    Une fermeture globale n'accepte aucune cible : cocher « tout le campus »
    puis désigner deux salles décrirait deux intentions contradictoires.
    """
    if payload.is_global and (payload.building_ids or payload.room_ids):
        raise RuleViolationError(
            "Une fermeture globale ne cible ni bâtiment ni salle.", code="cible"
        )
    if not payload.is_global and not (payload.building_ids or payload.room_ids):
        raise RuleViolationError(
            "Désignez au moins un bâtiment ou une salle.", code="cible"
        )

    fermeture = ClosurePeriod(
        label=payload.label,
        # DATERANGE est stocké en [début, fin[ : le dernier jour fermé est la
        # veille de la borne supérieure.
        date_span=Range(payload.first_day, payload.last_day + timedelta(days=1), bounds="[)"),
        kind=payload.kind,
        is_global=payload.is_global,
    )
    session.add(fermeture)
    session.flush()

    for building_id in payload.building_ids:
        if session.get(Building, building_id) is None:
            raise NotFoundError("Bâtiment introuvable.")
        session.add(ClosureBuilding(closure_id=fermeture.id, building_id=building_id))

    for room_id in payload.room_ids:
        if session.get(Room, room_id) is None:
            raise NotFoundError("Salle introuvable.")
        session.add(ClosureRoom(closure_id=fermeture.id, room_id=room_id))

    audit_service.record(
        session,
        action=AuditAction.CREATION,
        target_type="closure_period",
        target_label=fermeture.label,
        target_id=fermeture.id,
        after={
            "first_day": str(payload.first_day),
            "last_day": str(payload.last_day),
            "kind": payload.kind.value,
            "is_global": payload.is_global,
        },
    )
    session.flush()
    return fermeture


def delete_closure(session: Session, closure_id: uuid.UUID) -> None:
    fermeture = session.get(ClosurePeriod, closure_id)
    if fermeture is None:
        raise NotFoundError("Fermeture introuvable.")

    audit_service.record(
        session,
        action=AuditAction.SUPPRESSION,
        target_type="closure_period",
        target_label=fermeture.label,
        target_id=fermeture.id,
        before={"label": fermeture.label, "kind": fermeture.kind.value},
    )
    session.delete(fermeture)
    session.flush()


def impacted_bookings(session: Session, closure_id: uuid.UUID) -> list[Booking]:
    """Réservations que la fermeture rendrait impossibles.

    L'administration doit les voir avant de valider : fermer un bâtiment sans
    prévenir les vingt réunions du jour serait une décision prise à l'aveugle.
    """
    from app.services.availability_service import FUSEAU

    fermeture = session.get(ClosurePeriod, closure_id)
    if fermeture is None:
        raise NotFoundError("Fermeture introuvable.")

    debut = datetime.combine(fermeture.date_span.lower, datetime.min.time(), tzinfo=FUSEAU)
    fin = datetime.combine(fermeture.date_span.upper, datetime.min.time(), tzinfo=FUSEAU)

    requete = (
        select(Booking)
        .where(
            Booking.deleted_at.is_(None),
            Booking.time_range.op("&&")(Range(debut, fin, bounds="[)")),
        )
        .order_by(Booking.time_range)
    )

    if not fermeture.is_global:
        salles = {lien.room_id for lien in fermeture.rooms}
        batiments = {lien.building_id for lien in fermeture.buildings}
        conditions = []
        if salles:
            conditions.append(Booking.room_id.in_(salles))
        if batiments:
            from app.models import Floor

            conditions.append(
                select(Room.id)
                .join(Floor, Floor.id == Room.floor_id)
                .where(Room.id == Booking.room_id, Floor.building_id.in_(batiments))
                .exists()
            )
        if conditions:
            from sqlalchemy import or_

            requete = requete.where(or_(*conditions))

    return list(session.scalars(requete))
