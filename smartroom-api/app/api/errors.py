"""Traduction des erreurs métier en réponses HTTP.

Le service métier ne connaît pas HTTP : il lève une `DomainError` porteuse d'un
code et d'un statut. La conversion se fait ici, une seule fois, pour que toutes
les routes répondent avec la même enveloppe — celle que le front sait lire.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.core.errors import DomainError

logger = logging.getLogger(__name__)

#: Violation d'une contrainte EXCLUDE. Si elle remonte jusqu'ici, c'est qu'une
#: écriture a franchi le moteur de disponibilité et s'est heurtée à la base :
#: le créneau a été pris entre la vérification et le COMMIT.
EXCLUSION_VIOLATION = "23P01"


def enveloppe(code: str, message: str, **extra: object) -> dict[str, object]:
    """Forme unique des erreurs : `{ error: { code, message, ... } }`."""
    return {"error": {"code": code, "message": message, **extra}}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domaine(_: Request, erreur: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=erreur.http_status,
            content=enveloppe(erreur.code, erreur.message),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, erreur: RequestValidationError) -> JSONResponse:
        # Pydantic renvoie une liste d'erreurs techniques ; on garde la première
        # pour le message affichable et la liste complète pour le formulaire.
        details = [
            {"field": ".".join(str(part) for part in item["loc"][1:]), "message": item["msg"]}
            for item in erreur.errors()
        ]
        premier = details[0]["message"] if details else "Requête invalide."
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=enveloppe("validation", premier, details=details),
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
        # Toute autre violation est un défaut de code : on la trace sans
        # exposer la contrainte PostgreSQL au client.
        logger.exception("Violation d'intégrité non traduite", exc_info=erreur)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=enveloppe("integrite", "L'enregistrement a été refusé par la base."),
        )
