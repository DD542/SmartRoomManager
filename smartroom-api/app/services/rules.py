"""Résolution des règles applicables à une salle.

Trois portées se superposent : la salle, son bâtiment, le global. La plus
spécifique gagne — et une seule requête suffit, l'ordre de spécificité étant
calculé en SQL plutôt qu'en Python par trois allers-retours.

Les fonctions de ce module sont sans effet de bord : elles lisent, elles ne
décident pas. La décision appartient à `availability.check_slot`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.db.enums import BookingStatus, RuleScope
from app.models import Booking, BookingRule, ClosureBuilding, ClosurePeriod, ClosureRoom, OpeningHour, Room

FUSEAU = ZoneInfo(get_settings().timezone)

#: Ordre de spécificité : la salle l'emporte sur le bâtiment, qui l'emporte sur
#: le global. Utilisé tel quel dans les ORDER BY.
SPECIFICITE = case(
    (BookingRule.scope == RuleScope.SALLE, 1),
    (BookingRule.scope == RuleScope.BATIMENT, 2),
    else_=3,
)

SPECIFICITE_HORAIRES = case(
    (OpeningHour.scope == RuleScope.SALLE, 1),
    (OpeningHour.scope == RuleScope.BATIMENT, 2),
    else_=3,
)


@dataclass(frozen=True, slots=True)
class ResolvedRules:
    """Règles effectivement appliquées à une salle, et leur provenance."""

    scope: RuleScope
    min_duration_min: int
    max_duration_min: int
    buffer_min: int
    max_advance_days: int
    cancel_deadline_min: int
    checkin_window_min: int
    weekly_quota_hours: int
    max_active_bookings: int
    validation_capacity_threshold: int | None

    @property
    def min_duration(self) -> timedelta:
        return timedelta(minutes=self.min_duration_min)

    @property
    def max_duration(self) -> timedelta:
        return timedelta(minutes=self.max_duration_min)

    @property
    def buffer(self) -> timedelta:
        return timedelta(minutes=self.buffer_min)


@dataclass(frozen=True, slots=True)
class OpeningWindow:
    """Amplitude d'ouverture d'un jour donné."""

    weekday: int
    is_open: bool
    opens_at: time
    closes_at: time
    scope: RuleScope

    def contains(self, debut: time, fin: time) -> bool:
        return self.is_open and self.opens_at <= debut and fin <= self.closes_at


def charger_salle(session: Session, room_id: uuid.UUID) -> Room:
    salle = session.get(Room, room_id)
    if salle is None or salle.deleted_at is not None:
        raise NotFoundError("Salle introuvable.")
    return salle


def resolve_rules(session: Session, salle: Room) -> ResolvedRules:
    """Règle la plus spécifique parmi salle, bâtiment et global.

    La règle globale est garantie par la migration : la résolution ne peut pas
    échouer sur une base correctement initialisée.
    """
    regle = session.scalars(
        select(BookingRule)
        .where(
            (BookingRule.room_id == salle.id)
            | (BookingRule.building_id == salle.floor.building_id)
            | (BookingRule.scope == RuleScope.GLOBAL)
        )
        .order_by(SPECIFICITE)
        .limit(1)
    ).first()

    if regle is None:  # pragma: no cover - impossible après migration
        raise NotFoundError(
            "Aucune règle de réservation : la règle globale est absente de la base."
        )

    return ResolvedRules(
        scope=regle.scope,
        min_duration_min=regle.min_duration_min,
        max_duration_min=regle.max_duration_min,
        buffer_min=regle.buffer_min,
        max_advance_days=regle.max_advance_days,
        cancel_deadline_min=regle.cancel_deadline_min,
        checkin_window_min=regle.checkin_window_min,
        weekly_quota_hours=regle.weekly_quota_hours,
        max_active_bookings=regle.max_active_bookings,
        validation_capacity_threshold=regle.validation_capacity_threshold,
    )


def resolve_opening(session: Session, salle: Room, jour: date) -> OpeningWindow | None:
    """Horaires d'ouverture de la salle ce jour-là, même hiérarchie de portée.

    Renvoie `None` si aucune ligne n'existe : « non configuré », état distinct
    de « fermé », qui est une ligne `is_open = False`.
    """
    # `date.weekday()` compte lundi = 0 ; la base suit EXTRACT(DOW), dimanche = 0.
    jour_semaine = (jour.weekday() + 1) % 7

    horaire = session.scalars(
        select(OpeningHour)
        .where(
            OpeningHour.weekday == jour_semaine,
            (OpeningHour.room_id == salle.id)
            | (OpeningHour.building_id == salle.floor.building_id)
            | (OpeningHour.scope == RuleScope.GLOBAL),
        )
        .order_by(SPECIFICITE_HORAIRES)
        .limit(1)
    ).first()

    if horaire is None:
        return None

    return OpeningWindow(
        weekday=jour_semaine,
        is_open=horaire.is_open,
        opens_at=horaire.opens_at,
        closes_at=horaire.closes_at,
        scope=horaire.scope,
    )


def find_closure(session: Session, salle: Room, jour: date) -> ClosurePeriod | None:
    """Fermeture exceptionnelle couvrant ce jour pour cette salle.

    Une fermeture globale s'applique sans liaison ; une fermeture de portée
    restreinte n'agit que si la salle ou son bâtiment y figure.
    """
    return session.scalars(
        select(ClosurePeriod)
        .outerjoin(ClosureBuilding, ClosureBuilding.closure_id == ClosurePeriod.id)
        .outerjoin(ClosureRoom, ClosureRoom.closure_id == ClosurePeriod.id)
        .where(
            ClosurePeriod.date_span.op("@>")(jour),
            ClosurePeriod.is_global.is_(True)
            | (ClosureBuilding.building_id == salle.floor.building_id)
            | (ClosureRoom.room_id == salle.id),
        )
        .limit(1)
    ).first()


def semaine_de(moment: datetime) -> tuple[datetime, datetime]:
    """Bornes de la semaine ISO contenant ce moment, en heure locale.

    Le quota est hebdomadaire : il se compte du lundi au dimanche, pas sur une
    fenêtre glissante de sept jours.
    """
    local = moment.astimezone(FUSEAU)
    lundi = (local - timedelta(days=local.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return lundi, lundi + timedelta(days=7)


def weekly_minutes(
    session: Session,
    user_id: uuid.UUID,
    moment: datetime,
    *,
    ignore_booking_id: uuid.UUID | None = None,
) -> int:
    """Minutes déjà réservées par l'utilisateur sur la semaine de ce moment.

    Les réservations annulées et supprimées sont exclues : un créneau libéré
    doit rendre son quota.
    """
    debut, fin = semaine_de(moment)

    conditions = [
        Booking.owner_id == user_id,
        Booking.status != BookingStatus.ANNULEE,
        Booking.deleted_at.is_(None),
        Booking.time_range.op("&&")(_intervalle(debut, fin)),
    ]
    if ignore_booking_id is not None:
        conditions.append(Booking.id != ignore_booking_id)

    total = 0
    for reservation in session.scalars(select(Booking).where(*conditions)):
        plage = reservation.time_range
        # Seule la part de la réservation qui tombe dans la semaine compte.
        depart = max(plage.lower, debut)
        arrivee = min(plage.upper, fin)
        total += max(0, int((arrivee - depart).total_seconds() // 60))
    return total


def active_bookings(
    session: Session,
    user_id: uuid.UUID,
    moment: datetime,
    *,
    ignore_booking_id: uuid.UUID | None = None,
) -> int:
    """Nombre de réservations à venir détenues par l'utilisateur."""
    conditions = [
        Booking.owner_id == user_id,
        Booking.status == BookingStatus.CONFIRMEE,
        Booking.deleted_at.is_(None),
        Booking.time_range.op("&&")(_intervalle(moment, moment + timedelta(days=3650))),
    ]
    if ignore_booking_id is not None:
        conditions.append(Booking.id != ignore_booking_id)

    return len(list(session.scalars(select(Booking.id).where(*conditions))))


def _intervalle(debut: datetime, fin: datetime):
    """Construit un TSTZRANGE littéral pour les comparaisons de recouvrement."""
    from sqlalchemy.dialects.postgresql import Range

    return Range(debut, fin, bounds="[)")
