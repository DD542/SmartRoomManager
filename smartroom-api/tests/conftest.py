"""Fixtures de test.

Les contraintes vivant dans la base, les tests s'exécutent contre un vrai
PostgreSQL — un SQLite en mémoire ne connaît ni TSTZRANGE, ni EXCLUDE, ni les
index partiels, c'est-à-dire précisément ce que ces tests vérifient.

Chaque test s'exécute dans une transaction annulée à la fin : la base reste
identique d'un test à l'autre, sans recréation de schéma.

    docker compose up -d db
    alembic upgrade head
    pytest
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.enums import BookingStatus, RoomStatus
from app.models import Booking, Building, Floor, Room, User

PARIS = ZoneInfo(get_settings().timezone)


@pytest.fixture(scope="session")
def engine():
    url = os.getenv("TEST_DATABASE_URL", get_settings().database_url)
    moteur = create_engine(url, future=True)
    with moteur.connect() as connexion:
        connexion.execute(text("SELECT 1 FROM alembic_version LIMIT 1"))
    yield moteur
    moteur.dispose()


@pytest.fixture
def session(engine) -> Iterator[Session]:
    """Session encapsulée dans une transaction systématiquement annulée."""
    connexion = engine.connect()
    transaction = connexion.begin()
    session = Session(bind=connexion, expire_on_commit=False, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connexion.close()


@pytest.fixture
def batiment(session: Session) -> Building:
    batiment = Building(code="T1", name="Bâtiment de test")
    session.add(batiment)
    session.flush()
    return batiment


@pytest.fixture
def etage(session: Session, batiment: Building) -> Floor:
    etage = Floor(building_id=batiment.id, code="T", label="Étage de test", level=9)
    session.add(etage)
    session.flush()
    return etage


@pytest.fixture
def salle(session: Session, etage: Floor) -> Room:
    salle = Room(
        floor_id=etage.id,
        name="Salle de test",
        slug=f"salle-test-{uuid.uuid4().hex[:8]}",
        capacity=12,
        area_m2=Decimal("28.00"),
        status=RoomStatus.DISPONIBLE,
    )
    session.add(salle)
    session.flush()
    return salle


@pytest.fixture
def utilisateur(session: Session) -> User:
    compte = User(
        email=f"test-{uuid.uuid4().hex[:8]}@ece.fr",
        password_hash="x" * 60,
        first_name="Test",
        last_name="Utilisateur",
    )
    session.add(compte)
    session.flush()
    return compte


@pytest.fixture
def jour_ouvre() -> date:
    """Prochain mardi : jour ouvré garanti, hors fermetures des seeds."""
    reference = date.today() + timedelta(days=1)
    while reference.weekday() != 1:
        reference += timedelta(days=1)
    return reference


def creneau(jour: date, heure: int, minutes: int, duree: int) -> Range[datetime]:
    depart = datetime.combine(jour, time(heure, minutes), tzinfo=PARIS)
    return Range(depart, depart + timedelta(minutes=duree), bounds="[)")


@pytest.fixture
def poser(session: Session, salle: Room, utilisateur: User):
    """Crée une réservation confirmée sur le créneau demandé."""

    def _poser(plage: Range[datetime], titre: str = "Réunion existante") -> Booking:
        reservation = Booking(
            room_id=salle.id,
            owner_id=utilisateur.id,
            title=titre,
            time_range=plage,
            attendee_count=4,
            status=BookingStatus.CONFIRMEE,
        )
        session.add(reservation)
        session.flush()
        return reservation

    return _poser
