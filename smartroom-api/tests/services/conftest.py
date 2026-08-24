"""Fixtures d'intégration : un vrai PostgreSQL, une transaction annulée par test.

Les contraintes vivant dans la base, ces tests s'exécutent contre le schéma
réel — un SQLite en mémoire ne connaît ni TSTZRANGE, ni EXCLUDE, ni les index
partiels, c'est-à-dire précisément ce qu'ils vérifient.

    docker compose up -d db
    alembic upgrade head
    pytest tests/services
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.security import hash_password
from app.db.enums import EquipmentCategory, RoomStatus, RuleScope
from app.db.session import get_session
from app.domain.types import TimeSlot
from app.main import app
from app.models import (
    AdminAccount,
    AdminPermission,
    Building,
    Equipment,
    Floor,
    OpeningHour,
    Permission,
    Room,
    RoomEquipment,
    User,
)

PARIS = ZoneInfo(get_settings().timezone)
MOT_DE_PASSE = "smartroom2026"


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
    """Session encapsulée dans une transaction systématiquement annulée.

    `create_savepoint` transforme les `commit` des routes en relâchement de
    point de sauvegarde : la transaction extérieure reste ouverte et annulable.
    """
    connexion = engine.connect()
    transaction = connexion.begin()
    session = Session(
        bind=connexion, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connexion.close()


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    """Client HTTP branché sur la session du test.

    `TestClient` n'est pas utilisé comme gestionnaire de contexte : le cycle de
    vie de l'application — donc la boucle de maintenance — ne démarre pas.
    """
    app.dependency_overrides[get_session] = lambda: session
    # Le limiteur est en mémoire et partagé : sans cela, la dizaine de
    # connexions d'une suite épuiserait le quota de la première minute. Il a
    # son propre test, qui le réactive.
    limiter.enabled = False
    limiter.reset()
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.dependency_overrides.clear()
        limiter.enabled = True


@pytest.fixture
def marque() -> str:
    return uuid.uuid4().hex[:6]


@pytest.fixture
def batiment(session: Session, marque: str) -> Building:
    chiffres = "".join(c for c in marque if c.isdigit())[:3] or "1"
    batiment = Building(code=f"V{chiffres}", name=f"Campus intégration {marque}")
    session.add(batiment)
    session.flush()
    return batiment


@pytest.fixture
def etage(session: Session, batiment: Building) -> Floor:
    etage = Floor(building_id=batiment.id, code="V", label="Étage intégration", level=3)
    session.add(etage)
    session.flush()
    return etage


@pytest.fixture
def video(session: Session, marque: str) -> Equipment:
    materiel = Equipment(
        code=f"video-{marque}",
        label="Vidéoprojecteur",
        category=EquipmentCategory.AUDIOVISUEL,
        icon="projector",
    )
    session.add(materiel)
    session.flush()
    return materiel


@pytest.fixture
def creer_salle(session: Session, etage: Floor, marque: str):
    def _creer(
        nom: str = "Salle",
        *,
        capacity: int = 12,
        equipements: list[Equipment] | None = None,
        accessible: bool = True,
        statut: RoomStatus = RoomStatus.DISPONIBLE,
        horaires: tuple[time, time] | None = (time(8, 0), time(20, 0)),
    ) -> Room:
        piece = Room(
            floor_id=etage.id,
            name=f"{nom} {marque}",
            slug=f"{nom.lower()}-{marque}-{uuid.uuid4().hex[:4]}",
            capacity=capacity,
            area_m2=Decimal("24.00"),
            status=statut,
            is_accessible=accessible,
        )
        session.add(piece)
        session.flush()

        for materiel in equipements or []:
            session.add(
                RoomEquipment(room_id=piece.id, equipment_id=materiel.id, quantity=1)
            )
        if horaires is not None:
            ouvre, ferme = horaires
            for jour in range(7):
                session.add(
                    OpeningHour(
                        scope=RuleScope.SALLE,
                        room_id=piece.id,
                        weekday=jour,
                        opens_at=ouvre,
                        closes_at=ferme,
                    )
                )
        session.flush()
        return piece

    return _creer


@pytest.fixture
def salle(creer_salle) -> Room:
    return creer_salle("Vinci")


@pytest.fixture
def creer_compte(session: Session):
    def _creer(prenom: str = "Camille") -> User:
        compte = User(
            email=f"{prenom.lower()}-{uuid.uuid4().hex[:8]}@ece.fr",
            password_hash=hash_password(MOT_DE_PASSE),
            first_name=prenom,
            last_name="Durand",
        )
        session.add(compte)
        session.flush()
        return compte

    return _creer


@pytest.fixture
def compte(creer_compte) -> User:
    return creer_compte()


@pytest.fixture
def administrateur(session: Session, creer_compte) -> AdminAccount:
    profil = creer_compte("Lea")
    admin = AdminAccount(user_id=profil.id, job_title="Responsable planning")
    session.add(admin)
    session.flush()
    return admin


def accorder(session: Session, admin: AdminAccount, *codes: str) -> None:
    for code in codes:
        permission = session.scalars(select(Permission).where(Permission.code == code)).one()
        session.add(
            AdminPermission(admin_user_id=admin.user_id, permission_id=permission.id)
        )
    session.flush()
    session.expire(admin, ["grants", "permissions"])


def connecter(client: TestClient, email: str, *, admin: bool = False) -> dict[str, str]:
    chemin = "/api/v1/auth/admin/login" if admin else "/api/v1/auth/login"
    reponse = client.post(chemin, json={"email": email, "password": MOT_DE_PASSE})
    assert reponse.status_code == 200, reponse.text
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


@pytest.fixture
def jour_ouvre() -> date:
    """Prochain mardi : jour ouvré garanti, hors fermetures du jeu de démonstration."""
    reference = date.today() + timedelta(days=1)
    while reference.weekday() != 1:
        reference += timedelta(days=1)
    return reference


def creneau(jour: date, heure: int, minutes: int = 0, duree: int = 60) -> TimeSlot:
    """Créneau exprimé en heure locale, normalisé en UTC par `TimeSlot`."""
    depart = datetime.combine(jour, time(heure, minutes), tzinfo=PARIS)
    return TimeSlot(start=depart, end=depart + timedelta(minutes=duree))


def charge(slot: TimeSlot) -> dict[str, str]:
    return {"starts_at": slot.start.isoformat(), "ends_at": slot.end.isoformat()}


@pytest.fixture
def maintenant() -> datetime:
    return datetime.now(UTC)
