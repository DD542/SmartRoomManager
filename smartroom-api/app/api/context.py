"""Contexte de requête, porté par un middleware ASGI.

Les services journalisent l'audit sans recevoir l'acteur en paramètre : le faire
descendre à travers dix signatures polluerait chaque appel pour un besoin
transversal. Un `ContextVar` le rend disponible là où il sert, et reste isolé
entre requêtes concurrentes — contrairement à une variable de module.

Le middleware est écrit en ASGI pur, sans `BaseHTTPMiddleware` : ce dernier
exécute la suite de l'application dans une tâche distincte, où la valeur posée
ici ne serait pas toujours visible.
"""

from __future__ import annotations

import ipaddress
import uuid
from contextvars import ContextVar
from dataclasses import dataclass

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


@dataclass(slots=True)
class RequestContext:
    """Ce que l'audit doit savoir d'une requête, et rien de plus.

    Volontairement **mutable**. FastAPI exécute chaque dépendance et chaque
    route synchrone dans un fil du pool, avec une *copie* du contexte : un
    `ContextVar.set()` fait dans la dépendance ne serait pas visible de la
    route. Les copies partagent la référence de l'objet, pas l'objet lui-même :
    le muter propage l'information là où un remplacement se perdrait.
    """

    request_id: str
    ip_address: str | None = None
    user_agent: str | None = None
    user_id: uuid.UUID | None = None
    user_label: str = "Système"
    is_admin: bool = False


_CONTEXTE: ContextVar[RequestContext] = ContextVar(
    "smartroom_request_context",
    default=RequestContext(request_id="hors-requete"),
)


def current_context() -> RequestContext:
    return _CONTEXTE.get()


def bind_principal(*, user_id: uuid.UUID, user_label: str, is_admin: bool) -> None:
    """Complète le contexte une fois l'identité établie.

    L'authentification n'a pas encore eu lieu quand le middleware s'exécute :
    c'est la dépendance qui résout le principal qui appelle ceci.
    """
    contexte = current_context()
    contexte.user_id = user_id
    contexte.user_label = user_label
    contexte.is_admin = is_admin


def _adresse(headers: Headers, client: tuple[str, int] | None) -> str | None:
    """Adresse du client, validée comme telle.

    La colonne est de type INET : une valeur non analysable — un `X-Forwarded-For`
    falsifié, ou le pseudo-hôte d'un client de test — ferait échouer l'écriture
    d'audit. Mieux vaut ne rien inscrire qu'interrompre l'action journalisée.
    """
    candidats: list[str] = []
    transmise = headers.get("x-forwarded-for")
    if transmise:
        # Seule la première valeur désigne le client : les suivantes sont
        # ajoutées par les intermédiaires.
        candidats.append(transmise.split(",")[0].strip())
    if client:
        candidats.append(client[0])

    for candidat in candidats:
        try:
            return str(ipaddress.ip_address(candidat))
        except ValueError:
            continue
    return None


class RequestContextMiddleware:
    """Ouvre un contexte par requête et renvoie son identifiant au client.

    L'en-tête `X-Request-Id` relie une erreur affichée à l'écran à sa trace
    serveur, ce qu'un message d'erreur seul ne permet pas.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        identifiant = headers.get("x-request-id") or uuid.uuid4().hex

        # Le gestionnaire d'erreur de dernier recours est monté au-dessus de ce
        # middleware : le `ContextVar` n'y est plus visible. Le `scope`, lui,
        # traverse toute la pile.
        scope.setdefault("state", {})["request_id"] = identifiant

        jeton = _CONTEXTE.set(
            RequestContext(
                request_id=identifiant,
                ip_address=_adresse(headers, scope.get("client")),
                user_agent=(headers.get("user-agent") or "")[:255] or None,
            )
        )

        async def envoyer(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append("X-Request-Id", identifiant)
            await send(message)

        try:
            await self.app(scope, receive, envoyer)
        finally:
            _CONTEXTE.reset(jeton)
