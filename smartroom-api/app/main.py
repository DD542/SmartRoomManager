"""Point d'entrée FastAPI.

Trois responsabilités et pas une de plus : monter les routes, traduire les
erreurs métier en statuts HTTP, et tenir la tâche de maintenance en vie tant que
l'application tourne.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.errors import register_exception_handlers
from app.api.router import api_router
from app.core.config import get_settings
from app.db.session import get_session
from app.tasks.maintenance import boucle

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Démarre la maintenance périodique, et l'arrête sans laisser de tâche orpheline."""
    tache = asyncio.create_task(boucle(), name="maintenance")
    logger.info(
        "Maintenance planifiée toutes les %s s.", settings.maintenance_interval_seconds
    )
    try:
        yield
    finally:
        tache.cancel()
        # `gather` avec `return_exceptions` : l'annulation est attendue, elle ne
        # doit pas remonter comme une erreur d'extinction.
        await asyncio.gather(tache, return_exceptions=True)


app = FastAPI(
    title=settings.app_name,
    version="0.3.0",
    description="Système de réservation intelligente des salles — API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router)


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
