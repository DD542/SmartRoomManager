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

from fastapi import Depends, FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.providers.selection import SelecteurModeles
from app.api.context import RequestContextMiddleware
from app.api.errors import register_exception_handlers
from app.api.v1.router import v1_router
from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.logging import configurer as configurer_journal
from app.core.storage import racine as racine_media
from app.db.session import get_session
from app.tasks.scheduler import build_scheduler

settings = get_settings()

# Avant tout le reste : une erreur de démarrage doit sortir au bon format,
# sinon la première ligne du journal de production est déjà illisible.
configurer_journal(niveau=settings.log_level, json_actif=settings.log_json)
logger = logging.getLogger(__name__)

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
    {
        "name": "authentification",
        "description": "Sessions, mots de passe, permissions.",
    },
    {"name": "parc", "description": "Bâtiments, étages, salles, équipements, plans."},
    {
        "name": "disponibilité",
        "description": "Créneaux libres, vérification, recherche.",
    },
    {
        "name": "recommandation",
        "description": "Classement des salles, alternatives, arbitrage.",
    },
    {
        "name": "réservations",
        "description": "Créer, déplacer, annuler, valider la présence.",
    },
    {"name": "demandes d'accès", "description": "Dérogations et leur arbitrage."},
    {"name": "règles", "description": "Règles de réservation, horaires, fermetures."},
    {"name": "comptes", "description": "Utilisateurs, administrateurs, invitations."},
    {"name": "support", "description": "Tickets, base de connaissances, chatbot."},
    {
        "name": "notifications",
        "description": "Notifications applicatives et gabarits d'e-mail.",
    },
    {"name": "statistiques", "description": "Agrégats des tableaux de bord."},
    {"name": "audit", "description": "Journal des écritures sensibles."},
    {"name": "administration", "description": "Actions de back-office."},
    {"name": "technique", "description": "Supervision."},
]


async def _prechauffer() -> None:
    """Charge les modèles d'inférence, sans jamais empêcher le démarrage.

    Une absence d'Ollama est un état normal — l'assistant retombe alors sur son
    moteur déterministe. Elle ne doit pas remonter en erreur de démarrage.
    """
    try:
        charges = await SelecteurModeles().prechauffer()
    except asyncio.CancelledError:
        raise
    except Exception as souci:  # pragma: no cover - filet de démarrage
        logger.warning("Préchauffage abandonné : %s", souci)
        return
    if charges:
        logger.info("Modèles préchauffés : %s", ", ".join(charges))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Démarre les tâches planifiées, et les arrête sans en laisser d'orpheline."""
    scheduler = build_scheduler()
    scheduler.start()
    logger.info(
        "Tâches planifiées : réservations toutes les %s s, agrégats toutes les %s s.",
        settings.maintenance_interval_seconds,
        settings.stats_cache_seconds * 3,
    )

    # En arrière-plan : l'API doit répondre avant que le modèle soit prêt, pas
    # après. Sans cela, la première question d'une session attend le chargement
    # des poids, dépasse le budget de premier jeton et part au repli.
    prechauffage = asyncio.create_task(_prechauffer())

    try:
        yield
    finally:
        prechauffage.cancel()
        # `wait=False` : l'extinction ne doit pas attendre la fin d'un
        # rafraîchissement de vue matérialisée qui peut durer.
        scheduler.shutdown(wait=False)


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

#: Fichiers déposés et photos : servis depuis le domaine de l'application,
#: ils ne doivent rien pouvoir y exécuter. Un SVG accepte du script ; ouvert
#: directement, il tournerait avec les droits du site, et pourrait demander un
#: jeton avec le cookie de session. `sandbox` coupe le script, `nosniff`
#: empêche le navigateur de deviner un autre type que celui annoncé.
CSP_FICHIERS = (
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
)


@app.middleware("http")
async def entetes_de_securite(request, call_next):
    """En-têtes de durcissement, sur chaque réponse de l'API."""
    reponse = await call_next(request)
    reponse.headers.setdefault("X-Content-Type-Options", "nosniff")
    reponse.headers.setdefault("X-Frame-Options", "DENY")
    reponse.headers.setdefault("Referrer-Policy", "no-referrer")
    chemin = request.url.path
    if chemin.startswith(f"{settings.media_url}/") or chemin.endswith("/avatar"):
        reponse.headers["Content-Security-Policy"] = CSP_FICHIERS
    return reponse


register_exception_handlers(app)
app.include_router(v1_router)

# Les fichiers téléversés sont servis par l'application elle-même : le parc tient
# dans quelques mégaoctets, et un service de stockage séparé sortirait de la
# liste de dépendances arrêtée. En production, `media_root` doit désigner un
# volume monté, sinon un redéploiement effacerait les plans déposés.
app.mount(settings.media_url, StaticFiles(directory=racine_media()), name="media")


@app.api_route(
    "/health",
    methods=["GET", "HEAD"],
    tags=["technique"],
    summary="Le processus est-il vivant ?",
    description=(
        "Sonde de vivacité. Ne touche pas la base : l'orchestrateur s'en sert "
        "pour décider de **redémarrer** le conteneur, et une base momentanément "
        "indisponible ferait tuer une application parfaitement saine — puis la "
        "suivante, en boucle, pendant que la base se rétablit."
    ),
)
def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


@app.get(
    "/api/v1/health",
    tags=["technique"],
    summary="L'API répond-elle ? (accessible depuis le front)",
    description=(
        "Même sonde que `/health`, servie sous le préfixe de l'API pour passer "
        "par le relais du front. Le client l'interroge avant de reprendre une "
        "session : sur l'hébergement de démonstration, l'API s'endort et met "
        "une minute à se réveiller, et une rotation de jeton envoyée à un "
        "service endormi pouvait être rejouée — ce que le serveur sanctionne "
        "en révoquant la session. Ne dit rien de l'environnement."
    ),
)
def health_publique() -> dict[str, str]:
    return {"status": "ok"}


@app.get(
    "/health/ready",
    tags=["technique"],
    summary="Le service peut-il répondre ?",
    description=(
        "Sonde de disponibilité. Vérifie la base et la migration appliquée : "
        "l'orchestrateur s'en sert pour décider de **router du trafic**. Un "
        "503 retire l'instance de la rotation sans la tuer."
    ),
    responses={503: {"description": "Base injoignable ou schéma non migré."}},
)
def readiness(
    response: Response, session: Session = Depends(get_session)
) -> dict[str, object]:
    try:
        version = session.execute(
            text("SELECT version_num FROM alembic_version LIMIT 1")
        ).scalar_one_or_none()
        tables = session.execute(
            text(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
            )
        ).scalar_one()
    except Exception:
        logger.warning("Sonde de disponibilité en échec.", exc_info=True)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "indisponible", "raison": "base_injoignable"}

    if version is None:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "indisponible", "raison": "schema_non_migre"}

    return {
        "status": "ok",
        "environment": settings.environment,
        "schema_version": version,
        "tables": tables,
    }
