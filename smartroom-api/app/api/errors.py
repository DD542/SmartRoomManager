"""Traduction des erreurs en réponses HTTP.

Le service métier ne connaît pas HTTP : il lève une `DomainError` porteuse d'un
code et d'un statut. La conversion se fait ici, une seule fois, pour que toutes
les routes répondent avec la même enveloppe — celle que le front sait lire et
affiche telle quelle.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.context import current_context
from app.api.messages import traduire
from app.core.errors import DomainError

logger = logging.getLogger(__name__)

#: Violation d'une contrainte EXCLUDE. Si elle remonte jusqu'ici, c'est qu'une
#: écriture a franchi le moteur de disponibilité et s'est heurtée à la base :
#: le créneau a été pris entre la vérification et le COMMIT.
EXCLUSION_VIOLATION = "23P01"
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"

#: Messages des statuts que FastAPI lève lui-même, avant tout code métier.
MESSAGES_HTTP = {
    401: ("non_authentifie", "Authentification requise."),
    403: ("interdit", "Accès refusé."),
    404: ("introuvable", "Ressource introuvable."),
    405: ("methode_non_autorisee", "Méthode non autorisée sur cette ressource."),
    413: ("charge_trop_grande", "Fichier trop volumineux."),
    415: ("format_non_supporte", "Format de fichier non pris en charge."),
}


def enveloppe(code: str, message: str, **extra: Any) -> dict[str, Any]:
    """Forme unique des erreurs : `{ error: { code, message, ... } }`."""
    return {"error": {"code": code, "message": message, **extra}}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domaine(_: Request, erreur: DomainError) -> JSONResponse:
        # `headers` laisse une erreur emporter ses en-têtes jusqu'à la réponse.
        # Sans cela, ce qu'une route pose sur l'objet `Response` injecté est
        # perdu dès qu'elle lève : le gestionnaire fabrique une réponse neuve,
        # qui ne sait rien de la précédente. C'est le mécanisme que `_http`
        # utilise déjà pour `Retry-After`.
        return JSONResponse(
            status_code=erreur.http_status,
            content=enveloppe(**erreur.payload()),
            headers=getattr(erreur, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, erreur: RequestValidationError) -> JSONResponse:
        """Pydantic rend une liste technique ; on garde le premier message pour
        l'affichage et la liste complète pour surligner les champs du formulaire.

        Les messages sont traduits : le front les affiche tels quels, et une
        expression régulière rendue à l'écran ne dit rien à l'utilisateur.
        """
        champs = [
            {
                "field": ".".join(str(part) for part in item["loc"][1:]) or "body",
                "message": traduire(item),
            }
            for item in erreur.errors()
        ]
        premier = champs[0]["message"] if champs else "Requête invalide."
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=enveloppe("validation", premier, fields=champs),
        )

    @app.exception_handler(RateLimitExceeded)
    async def _debit(_: Request, erreur: RateLimitExceeded) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content=enveloppe(
                "trop_de_requetes",
                "Trop de tentatives. Réessayez dans quelques instants.",
            ),
            headers={"Retry-After": str(getattr(erreur, "retry_after", 60) or 60)},
        )

    @app.exception_handler(IntegrityError)
    async def _integrite(_: Request, erreur: IntegrityError) -> JSONResponse:
        sqlstate = getattr(getattr(erreur, "orig", None), "sqlstate", None)

        if sqlstate == EXCLUSION_VIOLATION:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content=enveloppe(
                    "conflit",
                    "Ce créneau vient d'être réservé par quelqu'un d'autre. "
                    "Rafraîchissez la page pour voir les disponibilités à jour.",
                ),
            )
        if sqlstate == UNIQUE_VIOLATION:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content=enveloppe("doublon", "Cette valeur est déjà utilisée."),
            )
        if sqlstate == FOREIGN_KEY_VIOLATION:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content=enveloppe(
                    "reference",
                    "Cet élément est référencé ailleurs et ne peut pas être supprimé.",
                ),
            )

        # Toute autre violation est un défaut de code : on la trace sans exposer
        # la contrainte PostgreSQL au client.
        logger.exception("Violation d'intégrité non traduite", exc_info=erreur)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=enveloppe("integrite", "L'enregistrement a été refusé par la base."),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, erreur: StarletteHTTPException) -> JSONResponse:
        """Uniformise les statuts levés par le framework lui-même.

        Sans cela, un 404 de routage rendrait `{"detail": "Not Found"}` là où le
        front attend `{"error": {...}}`.
        """
        code, message = MESSAGES_HTTP.get(
            erreur.status_code, ("erreur", "La requête n'a pas abouti.")
        )
        if isinstance(erreur.detail, str) and erreur.detail and erreur.status_code < 500:
            message = erreur.detail if erreur.detail not in {"Not Found", "Forbidden"} else message
        return JSONResponse(
            status_code=erreur.status_code,
            content=enveloppe(code, message),
            headers=getattr(erreur, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _inattendue(request: Request, erreur: Exception) -> JSONResponse:
        """Dernier filet : aucune trace technique ne sort vers le client.

        L'identifiant de requête accompagne la réponse : il relie le message
        affiché à l'écran à la trace complète côté serveur.
        """
        identifiant = getattr(request.state, "request_id", current_context().request_id)
        logger.exception("Erreur non gérée [%s]", identifiant, exc_info=erreur)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=enveloppe(
                "erreur_interne",
                "Une erreur inattendue est survenue. L'incident a été enregistré.",
                request_id=identifiant,
            ),
        )
