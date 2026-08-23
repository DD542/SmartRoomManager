"""Point d'entrée FastAPI.

Phase 2 : seul le contrôle de santé est exposé, il vérifie que la base répond et
que la migration est appliquée. Les routes métier arrivent en phase 3, avec le
moteur de disponibilité.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_session

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
    description="Système de réservation intelligente des salles — API.",
)


@app.get("/health", tags=["technique"])
def health(session: Session = Depends(get_session)) -> dict[str, object]:
    """Répond 200 si la base est jointe et la migration appliquée."""
    version = session.execute(
        text("SELECT version_num FROM alembic_version LIMIT 1")
    ).scalar_one_or_none()
    tables = session.execute(
        text(
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        )
    ).scalar_one()
    return {
        "status": "ok",
        "environment": settings.environment,
        "schema_version": version,
        "tables": tables,
    }
