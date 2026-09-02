"""Moteur et fabrique de sessions SQLAlchemy."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    # `pool_pre_ping` évite les erreurs « server closed the connection » après
    # une coupure réseau ou un redémarrage du conteneur PostgreSQL.
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, class_=Session
)


def get_session() -> Iterator[Session]:
    """Dépendance FastAPI : une session par requête, refermée quoi qu'il arrive."""
    with SessionLocal() as session:
        yield session
