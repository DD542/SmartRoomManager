"""Socle commun : base éphémère et schéma migré, une seule fois par session.

Le conteneur ne démarre que si un test le demande. `pytest tests/domain` reste
donc exécutable sur une machine sans Docker, en moins d'une seconde — c'est ce
qui permet de le lancer à chaque sauvegarde de fichier.

Deux façons de fournir la base, dans cet ordre :

  1. `TEST_DATABASE_URL` si la variable existe. C'est le mode de la chaîne
     d'intégration continue, où PostgreSQL tourne déjà en service.
  2. Un conteneur `postgres:16-alpine` démarré par testcontainers, sinon.

Le schéma est monté par `alembic upgrade head`, jamais par `create_all` : c'est
la migration qui sera jouée en production, c'est elle qu'il faut éprouver. Les
extensions — pgcrypto, btree_gist, citext, pg_trgm — sont créées par la
migration initiale, un conteneur nu suffit donc.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator

import pytest

#: Image figée : une version majeure différente n'a pas les mêmes plans, et
#: `EXCLUDE USING gist` n'est pas un détail de version.
#:
#: `pgvector/pgvector:pg16` et non `postgres:16-alpine` depuis la migration
#: `0007_rag_pgvector` : sans l'extension, la migration échoue et aucun test
#: d'intégration ne démarre.
IMAGE_POSTGRES = "pgvector/pgvector:pg16"


def _appliquer_environnement(dsn: str) -> None:
    """Publie le DSN dans l'environnement, puis invalide la configuration.

    `get_settings` est mémoïsé et `app.db.session` construit son moteur à
    l'import : sans invalidation, l'application resterait branchée sur la base
    de développement pendant que les tests écrivent dans le conteneur.
    """
    from sqlalchemy.engine import make_url

    # Aucun test ne parle à un modèle. Une suite dont le résultat dépend de la
    # présence d'Ollama sur la machine ne prouve rien : elle passerait ici et
    # échouerait en intégration continue, ou l'inverse. Le repli forcé rend la
    # couche IA entièrement déterministe pendant les tests.
    os.environ["IA_FORCER_REPLI"] = "true"

    url = make_url(dsn)
    os.environ["POSTGRES_HOST"] = url.host or "127.0.0.1"
    os.environ["POSTGRES_PORT"] = str(url.port or 5432)
    os.environ["POSTGRES_USER"] = url.username or "smartroom"
    os.environ["POSTGRES_PASSWORD"] = url.password or "smartroom"
    os.environ["POSTGRES_DB"] = url.database or "smartroom"
    os.environ.setdefault("JWT_SECRET", "secret-de-test-suffisamment-long-pour-passer")
    os.environ.setdefault("ENVIRONMENT", "local")
    os.environ.setdefault("MAIL_ENABLED", "false")

    # Magasin de médias isolé, comme la base l'est déjà.
    #
    # Sans cela, les tests écrivent et *suppriment* dans le dossier de
    # développement : un dépôt de plan efface celui qu'il remplace, et lancer
    # la suite retirait au jeu de démonstration des visuels que rien ne
    # signalait ensuite — une salle se retrouvait « sans plan » sans que
    # personne n'y ait touché.
    os.environ["MEDIA_ROOT"] = tempfile.mkdtemp(prefix="smartroom-medias-")

    from app.ai.reglages import get_reglages_ia
    from app.core.config import get_settings

    get_settings.cache_clear()
    # Même raison : les réglages IA sont mémoïsés, et un cache constitué avant
    # la pose de `IA_FORCER_REPLI` laisserait les tests appeler le modèle.
    get_reglages_ia.cache_clear()

    # Le moteur du module est reconstruit sur la nouvelle adresse. Les tâches
    # planifiées et les scripts passent par lui : le laisser pointer ailleurs
    # ferait écrire un test dans une base qu'il ne relit jamais.
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker

    from app.db import session as module_session

    module_session.engine.dispose()
    module_session.settings = get_settings()
    module_session.engine = create_engine(
        module_session.settings.database_url, pool_pre_ping=True, future=True
    )
    module_session.SessionLocal = sessionmaker(
        bind=module_session.engine,
        autoflush=False,
        expire_on_commit=False,
        class_=Session,
    )


def _migrer(dsn: str) -> None:
    """Monte le schéma. Idempotent : `head` sur une base à jour ne fait rien."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    racine = Path(__file__).resolve().parent.parent
    configuration = Config(str(racine / "alembic.ini"))
    configuration.set_main_option("script_location", str(racine / "alembic"))
    configuration.set_main_option("sqlalchemy.url", dsn)
    command.upgrade(configuration, "head")


@pytest.fixture(scope="session")
def dsn_postgres() -> Iterator[str]:
    """Adresse d'une base migrée, prête à recevoir les tests d'intégration."""
    fournie = os.getenv("TEST_DATABASE_URL")
    if fournie:
        _appliquer_environnement(fournie)
        _migrer(fournie)
        yield fournie
        return

    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:  # pragma: no cover - dépend de l'installation locale
        pytest.skip(
            "testcontainers n'est pas installé et TEST_DATABASE_URL n'est pas "
            "définie : les tests d'intégration ont besoin d'un PostgreSQL réel."
        )

    conteneur = PostgresContainer(
        IMAGE_POSTGRES,
        username="smartroom",
        password="smartroom",
        dbname="smartroom",
        driver="psycopg",
    )
    # Collation figée : une base créée avec celle de l'hôte trierait « École »
    # différemment d'une machine à l'autre, et un test de tri deviendrait
    # dépendant du poste qui le lance.
    conteneur.with_env("POSTGRES_INITDB_ARGS", "--encoding=UTF8 --locale=C")
    conteneur.with_env("TZ", "Europe/Paris")
    conteneur.with_env("PGTZ", "Europe/Paris")

    try:
        conteneur.start()
    except Exception as erreur:  # pragma: no cover - dépend du poste
        pytest.skip(f"Docker indisponible pour le conteneur de test : {erreur}")

    dsn = conteneur.get_connection_url()
    try:
        _appliquer_environnement(dsn)
        _migrer(dsn)
        yield dsn
    finally:
        conteneur.stop()


@pytest.fixture(scope="session")
def moteur(dsn_postgres: str):
    """Moteur partagé par la session, sur la base migrée."""
    from sqlalchemy import create_engine

    moteur = create_engine(dsn_postgres, future=True, pool_pre_ping=True)
    yield moteur
    moteur.dispose()
