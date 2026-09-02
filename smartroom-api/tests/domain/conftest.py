"""Fixtures du domaine.

Rien ici ne touche PostgreSQL ni FastAPI : les tests de ce dossier construisent
leurs données en mémoire et se lancent sur une machine sans base.

Les dates sont fixes. Deux d'entre elles sont choisies pour ce qu'elles cassent :
le 29 mars 2026 perd une heure locale, le 25 octobre 2026 en répète une.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domain.types import (
    BookingRef,
    Closure,
    OpeningWindow,
    RoomProfile,
    RuleSet,
    TimeSlot,
    UserProfile,
)

PARIS = ZoneInfo("Europe/Paris")

#: Mardi ordinaire, sans changement d'heure ni fermeture.
JOUR = date(2026, 8, 25)

#: Dernier dimanche de mars : 02:00 locale n'existe pas, la journée dure 23 h.
PRINTEMPS = date(2026, 3, 29)

#: Dernier dimanche d'octobre : 02:30 locale existe deux fois, la journée dure 25 h.
AUTOMNE = date(2026, 10, 25)


def utc(hour: int, minute: int = 0, *, day: date = JOUR) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def local(hour: int, minute: int = 0, *, day: date = JOUR) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=PARIS)


def slot(
    start_hour: int,
    start_minute: int,
    end_hour: int,
    end_minute: int = 0,
    *,
    day: date = JOUR,
) -> TimeSlot:
    """Créneau UTC, écrit en heures pleines pour rester lisible dans les cas."""
    return TimeSlot(
        start=utc(start_hour, start_minute, day=day),
        end=utc(end_hour, end_minute, day=day),
    )


def booking(
    plage: TimeSlot,
    titre: str = "Réunion",
    *,
    room_id: UUID | None = None,
    created_at: datetime | None = None,
    is_blocking: bool = False,
) -> BookingRef:
    return BookingRef(
        id=uuid4(),
        room_id=room_id or uuid4(),
        slot=plage,
        title=titre,
        created_at=created_at,
        is_blocking=is_blocking,
    )


def room(
    nom: str = "Salle de test",
    *,
    capacity: int = 12,
    building_id: UUID | None = None,
    floor_level: int = 2,
    equipment_ids: frozenset[UUID] = frozenset(),
    is_accessible: bool = True,
    is_available: bool = True,
    occupancy_rate: float = 0.1,
) -> RoomProfile:
    return RoomProfile(
        id=uuid4(),
        name=nom,
        capacity=capacity,
        building_id=building_id or uuid4(),
        floor_level=floor_level,
        equipment_ids=equipment_ids,
        is_accessible=is_accessible,
        is_available=is_available,
        occupancy_rate=occupancy_rate,
    )


def user(
    *,
    preferred_building_id: UUID | None = None,
    preferred_floor_level: int | None = None,
    active_bookings: int = 0,
    no_show_rate: float = 0.0,
    booked_room_counts: dict[UUID, int] | None = None,
) -> UserProfile:
    return UserProfile(
        id=uuid4(),
        preferred_building_id=preferred_building_id,
        preferred_floor_level=preferred_floor_level,
        active_bookings=active_bookings,
        no_show_rate=no_show_rate,
        booked_room_counts=booked_room_counts or {},
    )


def toute_la_semaine(
    opens: time = time(8, 0), closes: time = time(20, 0)
) -> tuple[OpeningWindow, ...]:
    return tuple(
        OpeningWindow(weekday=jour, opens_at=opens, closes_at=closes)
        for jour in range(7)
    )


@pytest.fixture
def regles() -> RuleSet:
    return RuleSet.defaults()


@pytest.fixture
def horaires() -> tuple[OpeningWindow, ...]:
    return toute_la_semaine()


@pytest.fixture
def ouverture_du_jour(horaires) -> tuple[TimeSlot, ...]:
    """Amplitude 08:00–20:00 locale du jour de référence, exprimée en UTC."""
    from app.domain.availability import daily_windows

    return daily_windows(JOUR, horaires, PARIS)


@pytest.fixture
def maintenant() -> datetime:
    """Horloge figée la veille du jour de référence, à 09:00 UTC."""
    return utc(9, day=JOUR - timedelta(days=1))


@pytest.fixture
def fermeture_du_jour() -> Closure:
    return Closure(label="Journée pédagogique", first_day=JOUR, last_day=JOUR)
