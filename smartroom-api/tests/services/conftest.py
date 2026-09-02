"""Fixtures d'intégration : un vrai PostgreSQL, une transaction annulée par test.

Les contraintes vivant dans la base, ces tests s'exécutent contre le schéma
réel — un SQLite en mémoire ne connaît ni TSTZRANGE, ni EXCLUDE, ni les index
partiels, c'est-à-dire précisément ce qu'ils vérifient.

La base est fournie par `tests/conftest.py` : conteneur éphémère, ou
`TEST_DATABASE_URL` en intégration continue. Aucune commande à lancer à la main.

    pytest tests/services

Régime d'isolation : une connexion, une transaction ouverte au début du test et
annulée à la fin, quoi qu'il arrive. La session est liée en
`join_transaction_mode="create_savepoint"`, ce qui transforme les `commit` des
routes en relâchement de point de sauvegarde : la transaction extérieure reste
ouverte et annulable. Aucun test ne voit les écritures d'un autre, et l'ordre
d'exécution est sans effet.

Les tests de concurrence n'utilisent pas ce régime — voir `test_concurrency.py`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta  # noqa: F401
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.db.enums import RoomStatus
from app.db.session import get_session
from app.domain.types import TimeSlot
from app.main import app
from app.models import (
    AdminAccount,
    AdminPermission,
    Building,
    Equipment,
    Floor,
    Permission,
    Room,
    User,
)
from tests import fabriques
from tests.fabriques import (
    FabriqueAdministrateur,
    FabriqueBatiment,
    FabriqueCompte,
    FabriqueEquipement,
    FabriqueEtage,
    FabriqueSalle,
)
from tests.horloge import charge_creneau
from tests.horloge import creneau as _creneau
from tests.horloge import prochain

#: Réexporté : de nombreux tests l'importent depuis ce module.
MOT_DE_PASSE = fabriques.MOT_DE_PASSE

pytestmark = pytest.mark.integration


@pytest.fixture(scope="session")
def engine(moteur):
    """Alias historique du moteur de session, conservé pour les tests existants."""
    return moteur


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
    fabriques.brancher(session)
    try:
        yield session
    finally:
        fabriques.debrancher()
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


# --------------------------------------------------------------------------- #
# Parc
# --------------------------------------------------------------------------- #


@pytest.fixture
def batiment(session: Session, marque: str) -> Building:
    return FabriqueBatiment(name=f"Campus intégration {marque}")


@pytest.fixture
def etage(session: Session, batiment: Building) -> Floor:
    return FabriqueEtage(
        building=batiment, code="V", label="Étage intégration", level=3
    )


@pytest.fixture
def video(session: Session, marque: str) -> Equipment:
    return FabriqueEquipement(code=f"video-{marque}", label="Vidéoprojecteur")


@pytest.fixture
def creer_salle(session: Session, etage: Floor, marque: str):
    """Fabrique une salle et pose son amplitude d'ouverture.

    `horaires=None` produit une salle sans amplitude propre : elle héritera
    alors du bâtiment, puis du global. C'est le cas dont ont besoin les tests
    de résolution de portée.
    """

    def _creer(
        nom: str = "Salle",
        *,
        capacity: int = 12,
        equipements: list[Equipment] | None = None,
        accessible: bool = True,
        statut: RoomStatus = RoomStatus.DISPONIBLE,
        horaires: tuple[time, time] | None = (time(8, 0), time(20, 0)),
    ) -> Room:
        piece = FabriqueSalle(
            floor=etage,
            name=f"{nom} {marque}",
            capacity=capacity,
            area_m2=Decimal("24.00"),
            status=statut,
            is_accessible=accessible,
        )
        if equipements:
            fabriques.equiper(session, piece, *equipements)
        if horaires is not None:
            ouvre, ferme = horaires
            fabriques.poser_horaires(session, piece, ouvre=ouvre, ferme=ferme)
        return piece

    return _creer


@pytest.fixture
def salle(creer_salle) -> Room:
    return creer_salle("Vinci")


# --------------------------------------------------------------------------- #
# Comptes
# --------------------------------------------------------------------------- #


@pytest.fixture
def creer_compte(session: Session):
    def _creer(prenom: str = "Camille") -> User:
        return FabriqueCompte(
            email=f"{prenom.lower()}-{uuid.uuid4().hex[:8]}@ece.fr",
            first_name=prenom,
        )

    return _creer


@pytest.fixture
def compte(creer_compte) -> User:
    return creer_compte()


@pytest.fixture
def administrateur(session: Session, creer_compte) -> AdminAccount:
    return FabriqueAdministrateur(user=creer_compte("Lea"))


def accorder(session: Session, admin: AdminAccount, *codes: str) -> None:
    """Ajoute des permissions à un administrateur, puis invalide son cache.

    L'invalidation est nécessaire : la garde lit `admin.permissions`, chargé au
    premier accès. Sans elle, une permission accordée après ce chargement
    resterait invisible et le test échouerait sur un 403 incompréhensible.
    """
    for code in codes:
        permission = session.scalars(
            select(Permission).where(Permission.code == code)
        ).one()
        session.add(
            AdminPermission(admin_user_id=admin.user_id, permission_id=permission.id)
        )
    session.flush()
    session.expire(admin, ["grants", "permissions"])


def connecter(client: TestClient, email: str, *, admin: bool = False) -> dict[str, str]:
    """Ouvre une session et rend l'en-tête d'autorisation correspondant."""
    chemin = "/api/v1/auth/admin/login" if admin else "/api/v1/auth/login"
    reponse = client.post(chemin, json={"email": email, "password": MOT_DE_PASSE})
    assert reponse.status_code == 200, reponse.text
    return {"Authorization": f"Bearer {reponse.json()['access_token']}"}


# --------------------------------------------------------------------------- #
# Temps
# --------------------------------------------------------------------------- #


@pytest.fixture
def jour_ouvre() -> date:
    """Prochain mardi : jour ouvré garanti, hors fermetures du jeu de démonstration."""
    return prochain(1)


def creneau(jour: date, heure: int, minutes: int = 0, duree: int = 60) -> TimeSlot:
    """Créneau exprimé en heure locale, normalisé en UTC par `TimeSlot`."""
    return _creneau(jour, heure, minutes, duree)


def charge(slot: TimeSlot) -> dict[str, str]:
    return charge_creneau(slot)


@pytest.fixture
def maintenant() -> datetime:
    return datetime.now(UTC)
