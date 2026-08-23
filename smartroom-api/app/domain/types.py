"""Structures du domaine.

Tout y est figé et sans dépendance : ces objets traversent le domaine sans
jamais être mutés, et se construisent en mémoire dans un test comme dans un
service. Les horodatages sont normalisés en UTC à la construction ; la
conversion en Europe/Paris n'a lieu qu'à la frontière de l'API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from enum import Enum
from uuid import UUID


class OverlapKind(str, Enum):
    """Qualification géométrique de deux intervalles, sans notion de règle."""

    IDENTIQUE = "identique"
    ENGLOBANT = "englobant"
    ENGLOBE = "englobe"
    PARTIEL_DEBUT = "partiel_debut"
    PARTIEL_FIN = "partiel_fin"
    ADJACENT = "adjacent"
    AUCUN = "aucun"


#: Les cinq recouvrements réels. La base les refuse par `ex_bookings_no_overlap`,
#: quelle que soit l'intention de l'appelant : aucun n'est contournable.
RECOUVREMENTS: frozenset[OverlapKind] = frozenset(
    {
        OverlapKind.IDENTIQUE,
        OverlapKind.ENGLOBANT,
        OverlapKind.ENGLOBE,
        OverlapKind.PARTIEL_DEBUT,
        OverlapKind.PARTIEL_FIN,
    }
)


class RuleCode(str, Enum):
    DUREE_MIN = "duree_min"
    DUREE_MAX = "duree_max"
    HORIZON_MAX = "horizon_max"
    HORIZON_MIN = "horizon_min"
    PASSE = "passe"
    QUOTA = "quota"
    HORS_OUVERTURE = "hors_ouverture"
    FERMETURE = "fermeture"
    CAPACITE = "capacite"
    BATTEMENT = "battement"


class AlternativeKind(str, Enum):
    MEME_SALLE_AUTRE_CRENEAU = "meme_salle_autre_creneau"
    AUTRE_SALLE_MEME_CRENEAU = "autre_salle_meme_creneau"
    PROCHE = "proche"


def _en_utc(valeur: datetime, borne: str) -> datetime:
    if valeur.tzinfo is None or valeur.tzinfo.utcoffset(valeur) is None:
        raise ValueError(
            f"La borne « {borne} » doit porter un fuseau : un horodatage naïf "
            "rendrait la comparaison dépendante de la machine."
        )
    return valeur.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class TimeSlot:
    """Intervalle fermé-ouvert [start, end[, normalisé en UTC.

    La convention est appliquée sans exception : 14:00–15:00 et 15:00–16:00 ne
    se chevauchent pas, et une réservation qui finit à 15:00 laisse la salle
    libre à 15:00.
    """

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        debut = _en_utc(self.start, "start")
        fin = _en_utc(self.end, "end")
        if fin == debut:
            raise ValueError("Un créneau de durée nulle n'existe pas.")
        if fin < debut:
            raise ValueError("La fin du créneau doit suivre son début.")
        object.__setattr__(self, "start", debut)
        object.__setattr__(self, "end", fin)

    @classmethod
    def of(cls, start: datetime, duration: timedelta) -> TimeSlot:
        return cls(start=start, end=start + duration)

    @property
    def duration(self) -> timedelta:
        return self.end - self.start

    def overlaps(self, other: TimeSlot) -> bool:
        return self.start < other.end and other.start < self.end

    def contains(self, other: TimeSlot) -> bool:
        return self.start <= other.start and other.end <= self.end

    def touches(self, other: TimeSlot) -> bool:
        return self.end == other.start or other.end == self.start

    def gap_to(self, other: TimeSlot) -> timedelta:
        """Distance entre deux créneaux disjoints. Nulle s'ils se recouvrent."""
        if self.overlaps(other):
            return timedelta(0)
        if self.end <= other.start:
            return other.start - self.end
        return self.start - other.end

    def intersection(self, other: TimeSlot) -> TimeSlot | None:
        debut = max(self.start, other.start)
        fin = min(self.end, other.end)
        return TimeSlot(start=debut, end=fin) if debut < fin else None

    def shifted(self, by: timedelta) -> TimeSlot:
        return TimeSlot(start=self.start + by, end=self.end + by)

    def expanded(self, by: timedelta) -> TimeSlot:
        """Créneau élargi de part et d'autre, pour appliquer un battement."""
        return TimeSlot(start=self.start - by, end=self.end + by)


@dataclass(frozen=True, slots=True)
class BookingRef:
    """Une réservation telle que le domaine la voit. Aucun objet ORM ici."""

    id: UUID
    room_id: UUID
    slot: TimeSlot
    title: str
    owner_id: UUID | None = None
    created_at: datetime | None = None
    is_blocking: bool = False


@dataclass(frozen=True, slots=True)
class OpeningWindow:
    """Amplitude d'ouverture d'un jour de semaine, en heure locale."""

    weekday: int
    opens_at: time
    closes_at: time

    def __post_init__(self) -> None:
        if not 0 <= self.weekday <= 6:
            raise ValueError("Le jour de semaine va de 0 (dimanche) à 6 (samedi).")


@dataclass(frozen=True, slots=True)
class Closure:
    """Fermeture exceptionnelle, bornes de dates incluses comme le DATERANGE."""

    label: str
    first_day: date
    last_day: date

    def __post_init__(self) -> None:
        if self.last_day < self.first_day:
            raise ValueError("La fin de fermeture précède son début.")

    def covers(self, day: date) -> bool:
        return self.first_day <= day <= self.last_day


@dataclass(frozen=True, slots=True)
class RuleSet:
    """Règles résolues salle → bâtiment → global.

    Aucune de ces valeurs n'est écrite ailleurs dans le domaine : les changer en
    base suffit à changer le comportement du moteur.
    """

    min_duration: timedelta
    max_duration: timedelta
    buffer: timedelta
    max_advance: timedelta
    min_advance: timedelta
    max_active_bookings: int
    cancel_deadline: timedelta
    checkin_window: timedelta
    validation_capacity_threshold: int | None

    @classmethod
    def defaults(cls) -> RuleSet:
        """Valeurs du sujet, servant uniquement quand `booking_rules` est vide."""
        return cls(
            min_duration=timedelta(minutes=30),
            max_duration=timedelta(hours=4),
            buffer=timedelta(minutes=15),
            max_advance=timedelta(days=60),
            min_advance=timedelta(minutes=15),
            max_active_bookings=10,
            cancel_deadline=timedelta(hours=1),
            checkin_window=timedelta(minutes=10),
            validation_capacity_threshold=20,
        )


@dataclass(frozen=True, slots=True)
class RuleViolation:
    """Une règle enfreinte. `forcible` dit si l'administration peut passer outre."""

    code: RuleCode
    message: str
    forcible: bool = True


@dataclass(frozen=True, slots=True)
class Conflict:
    existing: BookingRef
    kind: OverlapKind
    overlap: timedelta
    gap: timedelta

    @property
    def is_blocking(self) -> bool:
        return self.kind in RECOUVREMENTS

    @property
    def overlap_minutes(self) -> int:
        return int(self.overlap.total_seconds() // 60)

    @property
    def gap_minutes(self) -> int:
        return int(self.gap.total_seconds() // 60)


@dataclass(frozen=True, slots=True)
class RoomProfile:
    """Portrait d'une salle pour le domaine, assemblé par le service."""

    id: UUID
    name: str
    capacity: int
    building_id: UUID
    floor_level: int
    equipment_ids: frozenset[UUID] = frozenset()
    is_accessible: bool = False
    is_available: bool = True
    occupancy_rate: float = 0.0


@dataclass(frozen=True, slots=True)
class UserProfile:
    id: UUID
    preferred_building_id: UUID | None = None
    preferred_floor_level: int | None = None
    active_bookings: int = 0
    no_show_rate: float = 0.0
    booked_room_counts: dict[UUID, int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class SearchCriteria:
    """Besoin exprimé. Le créneau est facultatif : le tableau de bord classe
    sans date, sur la capacité, le matériel et l'occupation observée."""

    slot: TimeSlot | None = None
    attendees: int | None = None
    building_id: UUID | None = None
    equipment_ids: frozenset[UUID] = frozenset()
    accessible_only: bool = False
    #: Exigence pour une recherche, simple préférence pour une alternative :
    #: proposer un substitut vaut mieux que n'en proposer aucun.
    equipment_strict: bool = True


@dataclass(frozen=True, slots=True)
class ScoreComponent:
    key: str
    label: str
    points: int
    max_points: int
    detail: str

    @property
    def ratio(self) -> float:
        return self.points / self.max_points if self.max_points else 0.0


@dataclass(frozen=True, slots=True)
class Score:
    components: tuple[ScoreComponent, ...] = ()

    @property
    def total(self) -> int:
        return sum(item.points for item in self.components)

    def get(self, key: str) -> ScoreComponent | None:
        return next((item for item in self.components if item.key == key), None)


@dataclass(frozen=True, slots=True)
class ScoredRoom:
    room: RoomProfile
    score: Score
    eligible: bool
    justification: str
    blockers: tuple[RuleViolation, ...] = ()


@dataclass(frozen=True, slots=True)
class Alternative:
    kind: AlternativeKind
    room_id: UUID
    slot: TimeSlot
    score: int
    justification: str


@dataclass(frozen=True, slots=True)
class ArbitrationFactor:
    """Un critère d'arbitrage exposé brut. `favours` reste None quand le critère
    n'oriente pas, pour ne pas suggérer une décision que le domaine ne prend pas."""

    key: str
    label: str
    value: float
    detail: str
    favours: bool | None = None


@dataclass(frozen=True, slots=True)
class ClaimantFile:
    user_id: UUID
    requested_at: datetime
    booking_id: UUID | None = None
    active_bookings: int = 0
    max_active_bookings: int = 10
    no_show_rate: float = 0.0
    display_name: str = ""
    factors: tuple[ArbitrationFactor, ...] = ()


@dataclass(frozen=True, slots=True)
class ArbitrationBrief:
    slot: TimeSlot
    room_id: UUID
    claimants: tuple[ClaimantFile, ...] = ()
