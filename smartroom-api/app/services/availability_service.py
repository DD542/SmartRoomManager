"""Orchestration du moteur de disponibilité.

Ce module fait le pont, dans un seul sens : il charge depuis PostgreSQL, traduit
en structures du domaine, appelle des fonctions pures, et rend leur résultat. Le
domaine n'a jamais connaissance d'une session ni d'un modèle ORM.

Les horodatages franchissent la frontière en UTC. Le TSTZRANGE de PostgreSQL est
déjà absolu ; la conversion en Europe/Paris n'a lieu qu'à l'affichage.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Select, case, func, select, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.db.enums import BookingStatus, RoomStatus, RuleScope
from app.domain import availability as dom_availability
from app.domain import conflicts as dom_conflicts
from app.domain import rules as dom_rules
from app.domain.types import (
    BookingRef,
    Closure,
    Conflict,
    OpeningWindow,
    RoomProfile,
    RuleSet,
    RuleViolation,
    SearchCriteria,
    TimeSlot,
)
from app.models import (
    Booking,
    BookingRule,
    ClosureBuilding,
    ClosurePeriod,
    ClosureRoom,
    Floor,
    OpeningHour,
    Room,
)

FUSEAU = ZoneInfo(get_settings().timezone)

#: Fenêtre d'observation de l'occupation, alignée sur le moteur de recommandation.
FENETRE_OCCUPATION = 30

#: Recherche multicritère : une seule requête filtrante, scoring en mémoire ensuite.
#:
#: Chemin d'accès attendu :
#:   - idx_rooms_search (status, capacity, floor_id) WHERE deleted_at IS NULL
#:   - ex_bookings_no_overlap, dont l'index GiST (room_id, time_range) filtré sur
#:     les réservations actives sert le NOT EXISTS
#:   - idx_room_equipments_equipment (equipment_id, room_id) pour le filtre matériel
#:
#: Sans créneau demandé, `avec_creneau` désactive l'anti-jointure : la recherche
#: porte alors sur le parc et non sur un moment, et toute salle est « libre ».
#:
#: Plan mesuré sur le jeu de démonstration — 8 salles, 263 réservations, 8,9 ms :
#:   Sort  (Sort Key: r.capacity, r.name)
#:     Hash Join  (r.floor_id = f.id)
#:       Hash Right Join  (occupation)
#:         GroupAggregate sur v_room_occupancy_daily
#:         Seq Scan on rooms  (Filter: deleted_at IS NULL, status, capacity)
#:       Seq Scan on floors
#:     SubPlan 3 : Bitmap Index Scan on ex_bookings_no_overlap
#:       Index Cond: (time_range && $creneau)
#:
#: L'anti-jointure emprunte bien l'index GiST de la contrainte : c'est le point
#: qui compte, puisque `bookings` est la seule table qui grossira. Le parcours
#: séquentiel de `rooms` et `floors` est le bon choix du planificateur sur huit
#: lignes ; `idx_rooms_search` prendra le relais quand le parc s'étoffera.
#:
#: L'agrégat d'équipements passe par un sous-select corrélé plutôt qu'une
#: jointure : joindre room_equipments multiplierait les lignes de salles et
#: fausserait le COUNT du filtre matériel.
SQL_RECHERCHE = text(
    """
WITH occupation AS (
    SELECT room_id, AVG(occupancy_rate) AS taux
      FROM v_room_occupancy_daily
     WHERE occupancy_date >= CURRENT_DATE - CAST(:fenetre AS integer)
     GROUP BY room_id
)
SELECT r.id,
       r.name,
       r.capacity,
       f.building_id,
       f.level                                   AS floor_level,
       r.is_accessible,
       (r.status = 'disponible')                 AS is_available,
       COALESCE(o.taux, 0)::float                AS occupancy_rate,
       COALESCE(
           ARRAY(SELECT re.equipment_id FROM room_equipments re WHERE re.room_id = r.id),
           '{}'::uuid[]
       )                                         AS equipment_ids,
       (
           NOT CAST(:avec_creneau AS boolean)
           OR NOT EXISTS (
               SELECT 1
                 FROM bookings bk
                WHERE bk.room_id = r.id
                  AND bk.status <> 'annulee'
                  AND bk.deleted_at IS NULL
                  AND bk.time_range && tstzrange(
                          CAST(:debut AS timestamptz), CAST(:fin AS timestamptz), '[)')
           )
       )                                         AS libre
  FROM rooms r
  JOIN floors f ON f.id = r.floor_id
  LEFT JOIN occupation o ON o.room_id = r.id
 WHERE r.deleted_at IS NULL
   AND r.status <> 'archivee'
   AND (CAST(:effectif AS integer) IS NULL OR r.capacity >= CAST(:effectif AS integer))
   AND (CAST(:batiment AS uuid) IS NULL OR f.building_id = CAST(:batiment AS uuid))
   AND (NOT CAST(:pmr AS boolean) OR r.is_accessible)
   AND (
        cardinality(CAST(:equipements AS uuid[])) = 0
        OR (
            SELECT count(*)
              FROM room_equipments re
             WHERE re.room_id = r.id
               AND re.equipment_id = ANY(CAST(:equipements AS uuid[]))
        ) = cardinality(CAST(:equipements AS uuid[]))
   )
 ORDER BY r.capacity, r.name
"""
)


@dataclass(frozen=True, slots=True)
class SlotReport:
    """Verdict complet sur un créneau : ce qui bloque, et ce qui se force."""

    slot: TimeSlot
    room_id: uuid.UUID
    conflicts: tuple[Conflict, ...] = ()
    violations: tuple[RuleViolation, ...] = ()
    requires_validation: bool = False

    @property
    def blocking(self) -> tuple[Conflict, ...]:
        return dom_conflicts.blocking(self.conflicts)

    @property
    def available(self) -> bool:
        return not self.blocking and not self.violations

    @property
    def forcible(self) -> bool:
        """Un chevauchement ne se force jamais, une règle non forçable non plus."""
        return not self.blocking and all(item.forcible for item in self.violations)


def en_utc(moment: datetime) -> datetime:
    return moment.astimezone(UTC)


def to_slot(plage: Range[datetime]) -> TimeSlot:
    return TimeSlot(start=plage.lower, end=plage.upper)


def to_range(slot: TimeSlot) -> Range[datetime]:
    """Le domaine parle en [start, end[, le TSTZRANGE aussi : la borne est la même."""
    return Range(slot.start, slot.end, bounds="[)")


def charger_salle(session: Session, room_id: uuid.UUID) -> Room:
    salle = session.scalars(
        select(Room)
        .options(selectinload(Room.floor).selectinload(Floor.building))
        .where(Room.id == room_id, Room.deleted_at.is_(None))
    ).one_or_none()
    if salle is None:
        raise NotFoundError("Salle introuvable.")
    return salle


def _specificite(colonne_salle, colonne_batiment) -> Select:
    """Ordonne salle avant bâtiment avant global, pour un DISTINCT ON."""
    return case(
        (colonne_salle == RuleScope.SALLE, 1),
        (colonne_batiment == RuleScope.BATIMENT, 2),
        else_=3,
    )


def load_rules(session: Session, salle: Room) -> RuleSet:
    """Règles applicables, résolues salle → bâtiment → global.

    Une seule requête : la ligne la plus spécifique gagne. Sans ligne du tout,
    les valeurs du sujet s'appliquent — c'est le seul endroit où elles vivent.
    """
    priorite = case(
        (BookingRule.scope == RuleScope.SALLE, 1),
        (BookingRule.scope == RuleScope.BATIMENT, 2),
        else_=3,
    )
    regle = session.scalars(
        select(BookingRule)
        .where(
            (BookingRule.scope == RuleScope.GLOBAL)
            | ((BookingRule.scope == RuleScope.SALLE) & (BookingRule.room_id == salle.id))
            | (
                (BookingRule.scope == RuleScope.BATIMENT)
                & (BookingRule.building_id == salle.floor.building_id)
            )
        )
        .order_by(priorite)
        .limit(1)
    ).one_or_none()

    if regle is None:
        return RuleSet.defaults()

    return RuleSet(
        min_duration=timedelta(minutes=regle.min_duration_min),
        max_duration=timedelta(minutes=regle.max_duration_min),
        buffer=timedelta(minutes=regle.buffer_min),
        max_advance=timedelta(days=regle.max_advance_days),
        min_advance=timedelta(minutes=regle.min_advance_min),
        max_active_bookings=regle.max_active_bookings,
        cancel_deadline=timedelta(minutes=regle.cancel_deadline_min),
        checkin_window=timedelta(minutes=regle.checkin_window_min),
        validation_capacity_threshold=regle.validation_capacity_threshold,
    )


def load_openings(session: Session, salle: Room) -> tuple[OpeningWindow, ...]:
    """Horaires de la salle, à défaut ceux du bâtiment, à défaut le global.

    La résolution se fait par portée entière et non jour par jour : une salle qui
    déclare ses propres horaires les déclare tous, sinon un lundi manquant
    hériterait du bâtiment et créerait une amplitude incohérente.
    """
    for portee, condition in (
        (RuleScope.SALLE, OpeningHour.room_id == salle.id),
        (RuleScope.BATIMENT, OpeningHour.building_id == salle.floor.building_id),
        (RuleScope.GLOBAL, OpeningHour.id.is_not(None)),
    ):
        lignes = session.scalars(
            select(OpeningHour)
            .where(OpeningHour.scope == portee, condition, OpeningHour.is_open.is_(True))
            .order_by(OpeningHour.weekday)
        ).all()
        if lignes:
            return tuple(
                OpeningWindow(
                    weekday=item.weekday, opens_at=item.opens_at, closes_at=item.closes_at
                )
                for item in lignes
            )
    return ()


def load_closures(
    session: Session, salle: Room, first_day: date, last_day: date
) -> tuple[Closure, ...]:
    """Fermetures couvrant la période, globales ou ciblant la salle ou son bâtiment."""
    periode = Range(first_day, last_day + timedelta(days=1), bounds="[)")

    lignes = session.scalars(
        select(ClosurePeriod)
        .outerjoin(ClosureBuilding, ClosureBuilding.closure_id == ClosurePeriod.id)
        .outerjoin(ClosureRoom, ClosureRoom.closure_id == ClosurePeriod.id)
        .where(
            ClosurePeriod.date_span.op("&&")(periode),
            ClosurePeriod.is_global.is_(True)
            | (ClosureBuilding.building_id == salle.floor.building_id)
            | (ClosureRoom.room_id == salle.id),
        )
        .distinct()
    ).all()

    return tuple(
        Closure(
            label=item.label,
            first_day=item.date_span.lower,
            # DATERANGE est stocké en [début, fin[ : le dernier jour fermé est la
            # veille de la borne supérieure.
            last_day=item.date_span.upper - timedelta(days=1),
        )
        for item in lignes
    )


def load_bookings(
    session: Session,
    room_id: uuid.UUID,
    window: TimeSlot,
    *,
    ignore_booking_id: uuid.UUID | None = None,
) -> tuple[BookingRef, ...]:
    """Réservations actives recouvrant la fenêtre.

    Le filtre `&&` emprunte l'index GiST de la contrainte anti-chevauchement :
    aucune réservation hors fenêtre n'est chargée en Python.
    """
    requete = select(Booking).where(
        Booking.room_id == room_id,
        Booking.status != BookingStatus.ANNULEE,
        Booking.deleted_at.is_(None),
        Booking.time_range.op("&&")(to_range(window)),
    )
    if ignore_booking_id is not None:
        requete = requete.where(Booking.id != ignore_booking_id)

    return tuple(
        BookingRef(
            id=item.id,
            room_id=item.room_id,
            slot=to_slot(item.time_range),
            title=item.title,
            owner_id=item.owner_id,
            created_at=item.created_at,
            is_blocking=item.owner_id is None,
        )
        for item in session.scalars(requete)
    )


def count_active_bookings(
    session: Session, user_id: uuid.UUID, *, now: datetime, ignore_booking_id: uuid.UUID | None = None
) -> int:
    """Réservations à venir non annulées. Un COUNT, jamais un chargement."""
    requete = (
        select(func.count())
        .select_from(Booking)
        .where(
            Booking.owner_id == user_id,
            Booking.status != BookingStatus.ANNULEE,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("&&")(Range(en_utc(now), None, bounds="[)")),
        )
    )
    if ignore_booking_id is not None:
        requete = requete.where(Booking.id != ignore_booking_id)
    return session.scalar(requete) or 0


def open_windows_for(
    session: Session, salle: Room, first_day: date, last_day: date
) -> tuple[TimeSlot, ...]:
    """Amplitude ouverte de la salle sur une période, fermetures déduites."""
    return dom_availability.open_windows(
        first_day,
        last_day,
        load_openings(session, salle),
        load_closures(session, salle, first_day, last_day),
        FUSEAU,
    )


def free_slots(
    session: Session,
    room_id: uuid.UUID,
    first_day: date,
    last_day: date,
    *,
    min_duration: timedelta | None = None,
) -> tuple[TimeSlot, ...]:
    """Créneaux libres d'une salle sur une période. Trois requêtes, pas une de plus.

    C'est ce que consomme le calendrier de disponibilité : les trous réellement
    réservables, battement appliqué, trous trop courts écartés.
    """
    salle = charger_salle(session, room_id)
    regles = load_rules(session, salle)
    fenetres = open_windows_for(session, salle, first_day, last_day)
    if not fenetres:
        return ()

    couverture = TimeSlot(start=fenetres[0].start, end=fenetres[-1].end)
    occupees = [item.slot for item in load_bookings(session, room_id, couverture)]

    return dom_availability.free_slots(
        fenetres,
        occupees,
        min_duration=min_duration or regles.min_duration,
        buffer=regles.buffer,
    )


def check_slot(
    session: Session,
    *,
    room_id: uuid.UUID,
    slot: TimeSlot,
    attendees: int = 1,
    requester_id: uuid.UUID | None = None,
    ignore_booking_id: uuid.UUID | None = None,
    now: datetime | None = None,
    check_quotas: bool = True,
) -> SlotReport:
    """Réservabilité d'un créneau précis, règles violées énumérées.

    Le verdict ne décide rien : il rapporte. C'est l'appelant qui choisit de
    forcer une règle — et jamais un chevauchement, que la base refuserait.
    """
    now = en_utc(now or datetime.now(UTC))
    salle = charger_salle(session, room_id)
    regles = load_rules(session, salle)

    jours = dom_rules.local_days(slot, FUSEAU)
    fenetres = open_windows_for(session, salle, jours[0], jours[-1])
    fermetures = load_closures(session, salle, jours[0], jours[-1])

    voisines = load_bookings(
        session, room_id, slot.expanded(regles.buffer), ignore_booking_id=ignore_booking_id
    )
    conflits = dom_conflicts.detect(slot, voisines, buffer=regles.buffer)

    actives = (
        count_active_bookings(session, requester_id, now=now, ignore_booking_id=ignore_booking_id)
        if requester_id is not None
        else 0
    )

    violations = dom_rules.evaluate(
        slot,
        rules=regles,
        now=now,
        tz=FUSEAU,
        attendees=attendees,
        capacity=salle.capacity,
        active_bookings=actives,
        open_windows=fenetres,
        closures=fermetures,
        neighbours=voisines,
        check_quotas=check_quotas and requester_id is not None,
    )

    return SlotReport(
        slot=slot,
        room_id=room_id,
        conflicts=conflits,
        violations=violations,
        requires_validation=dom_rules.requires_validation(attendees, regles),
    )


def search_rooms(
    session: Session, criteria: SearchCriteria
) -> tuple[tuple[RoomProfile, bool], ...]:
    """Salles candidates et leur disponibilité, en une seule requête filtrante.

    Le drapeau `libre` accompagne chaque salle plutôt que de la faire disparaître :
    l'écran doit pouvoir afficher « occupée à cette heure » avec le score, sans
    quoi l'utilisateur ne comprendrait pas l'absence de la salle qu'il visait.
    """
    # Les bornes voyagent séparément : psycopg n'adapte pas un `Range`
    # SQLAlchemy dans une requête textuelle, le TSTZRANGE se construit en SQL.
    lignes = session.execute(
        SQL_RECHERCHE,
        {
            "fenetre": FENETRE_OCCUPATION,
            "avec_creneau": criteria.slot is not None,
            "debut": criteria.slot.start if criteria.slot else None,
            "fin": criteria.slot.end if criteria.slot else None,
            "effectif": criteria.attendees,
            "batiment": criteria.building_id,
            "pmr": criteria.accessible_only,
            "equipements": [str(item) for item in criteria.equipment_ids],
        },
    ).all()

    return tuple(
        (
            RoomProfile(
                id=ligne.id,
                name=ligne.name,
                capacity=ligne.capacity,
                building_id=ligne.building_id,
                floor_level=ligne.floor_level,
                equipment_ids=frozenset(ligne.equipment_ids),
                is_accessible=ligne.is_accessible,
                is_available=ligne.is_available,
                occupancy_rate=ligne.occupancy_rate,
            ),
            bool(ligne.libre),
        )
        for ligne in lignes
    )


def room_profile(session: Session, room_id: uuid.UUID) -> RoomProfile:
    """Portrait d'une salle pour le domaine, occupation comprise."""
    salle = session.scalars(
        select(Room)
        .options(
            selectinload(Room.floor),
            selectinload(Room.room_equipments),
        )
        .where(Room.id == room_id, Room.deleted_at.is_(None))
    ).one_or_none()
    if salle is None:
        raise NotFoundError("Salle introuvable.")

    taux = session.execute(
        text(
            "SELECT COALESCE(AVG(occupancy_rate), 0)::float "
            "  FROM v_room_occupancy_daily "
            " WHERE room_id = CAST(:salle AS uuid) "
            "   AND occupancy_date >= CURRENT_DATE - CAST(:fenetre AS integer)"
        ),
        {"salle": str(room_id), "fenetre": FENETRE_OCCUPATION},
    ).scalar_one()

    return RoomProfile(
        id=salle.id,
        name=salle.name,
        capacity=salle.capacity,
        building_id=salle.floor.building_id,
        floor_level=salle.floor.level,
        equipment_ids=frozenset(lien.equipment_id for lien in salle.room_equipments),
        is_accessible=salle.is_accessible,
        is_available=salle.status is RoomStatus.DISPONIBLE,
        occupancy_rate=float(taux),
    )


def describe_conflicts(conflicts: Sequence[Conflict]) -> tuple[str, ...]:
    return dom_conflicts.report(conflicts, FUSEAU)


def calendar_events(
    session: Session,
    *,
    window: TimeSlot,
    viewer_id: uuid.UUID | None = None,
    room_ids: Sequence[uuid.UUID] | None = None,
    building_id: uuid.UUID | None = None,
    limit: int = 500,
) -> list[tuple[Booking, Room, bool]]:
    """Réservations recoupant une plage visible, pour le calendrier.

    Le filtre `&&` emprunte l'index GiST de la contrainte anti-chevauchement :
    seules les lignes visibles à l'écran sont chargées, quelle que soit la
    taille de l'historique.
    """
    requete = (
        select(Booking, Room)
        .join(Room, Room.id == Booking.room_id)
        .where(
            Booking.status != BookingStatus.ANNULEE,
            Booking.deleted_at.is_(None),
            Booking.time_range.op("&&")(to_range(window)),
        )
        .order_by(Booking.time_range)
        .limit(limit)
    )
    if room_ids:
        requete = requete.where(Booking.room_id.in_(list(room_ids)))
    if building_id is not None:
        requete = requete.join(Floor, Floor.id == Room.floor_id).where(
            Floor.building_id == building_id
        )

    return [
        (reservation, salle, viewer_id is not None and reservation.owner_id == viewer_id)
        for reservation, salle in session.execute(requete).all()
    ]


def closed_windows(
    session: Session, *, room_id: uuid.UUID, window: TimeSlot
) -> tuple[TimeSlot, ...]:
    """Plages fermées d'une salle sur une période.

    Complément des amplitudes d'ouverture : le calendrier grise ces plages
    plutôt que de laisser croire qu'on peut y déposer un créneau.
    """
    salle = charger_salle(session, room_id)
    jours = dom_rules.local_days(window, FUSEAU)
    ouvertes = open_windows_for(session, salle, jours[0], jours[-1])
    return dom_availability.subtract(window, list(ouvertes))
