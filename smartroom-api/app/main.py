"""Point d'entrée FastAPI.

Quatre responsabilités : monter les routes, ouvrir un contexte par requête,
traduire les erreurs en réponses normalisées, et tenir la tâche de maintenance
en vie tant que l'application tourne.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.context import RequestContextMiddleware
from app.api.errors import register_exception_handlers
from app.api.v1.router import v1_router
from app.core.config import get_settings
from app.core.limiter import limiter
from app.db.session import get_session
from app.tasks.maintenance import boucle

logger = logging.getLogger(__name__)
settings = get_settings()

DESCRIPTION = """
API du **Système de réservation intelligente des salles**.

Deux moteurs en portent la valeur : la **disponibilité**, qui répond « ce
créneau est-il réservable, et sinon pourquoi », et la **recommandation**, qui
classe les salles et justifie son classement. La contrainte
`ex_bookings_no_overlap` reste le dernier rempart : la double réservation est
impossible au niveau base, indépendamment du code applicatif.

**Erreurs** — toutes les réponses ≥ 400 partagent la forme
`{"error": {"code", "message", "fields?"}}`. Le `message` est en français et
destiné à l'affichage direct ; le `code` est stable et machinable.

**Pagination** — toutes les collections rendent
`{"items", "total", "pagination"}`.

**Authentification** — jeton d'accès de 15 minutes porté par
`Authorization: Bearer`, jeton de rafraîchissement en cookie `httpOnly` avec
rotation à chaque renouvellement.
"""

TAGS = [
    {"name": "authentification", "description": "Sessions, mots de passe, permissions."},
    {"name": "parc", "description": "Bâtiments, étages, salles, équipements, plans."},
    {"name": "disponibilité", "description": "Créneaux libres, vérification, recherche."},
    {"name": "recommandation", "description": "Classement des salles, alternatives, arbitrage."},
    {"name": "réservations", "description": "Créer, déplacer, annuler, valider la présence."},
    {"name": "demandes d'accès", "description": "Dérogations et leur arbitrage."},
    {"name": "règles", "description": "Règles de réservation, horaires, fermetures."},
    {"name": "comptes", "description": "Utilisateurs, administrateurs, invitations."},
    {"name": "support", "description": "Tickets, base de connaissances, chatbot."},
    {"name": "notifications", "description": "Notifications applicatives et gabarits d'e-mail."},
    {"name": "statistiques", "description": "Agrégats des tableaux de bord."},
    {"name": "audit", "description": "Journal des écritures sensibles."},
    {"name": "administration", "description": "Actions de back-office."},
    {"name": "technique", "description": "Supervision."},
]


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
    version="1.0.0",
    description=DESCRIPTION,
    openapi_tags=TAGS,
    lifespan=lifespan,
)

app.state.limiter = limiter

# L'ordre compte : le contexte doit être ouvert avant que quoi que ce soit
# d'autre ne s'exécute, donc ajouté en dernier — Starlette empile à l'envers.
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-Id"],
)
app.add_middleware(RequestContextMiddleware)

register_exception_handlers(app)
app.include_router(v1_router)


@app.get(
    "/health",
    tags=["technique"],
    summary="Contrôle de santé",
    description="Répond 200 si la base est jointe et la migration appliquée.",
)
def health(session: Session = Depends(get_session)) -> dict[str, object]:
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
