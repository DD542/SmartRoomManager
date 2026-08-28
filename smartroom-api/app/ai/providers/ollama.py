"""Client Ollama, en flux.

Ollama répond à `/api/chat` par du NDJSON : un objet JSON par ligne, le dernier
portant `done: true` et les compteurs. Le client traduit ce flux en `Fragment`
et n'expose rien de la forme de l'API au reste du code.

Deux points méritent d'être lus avant de modifier ce fichier :

  * le chronomètre du premier jeton est armé autour de la première ligne, et
    non autour de la requête entière — c'est le silence initial qui dit qu'un
    modèle n'est pas chargé, et c'est lui qui doit déclencher le repli ;
  * les appels d'outils n'arrivent pas par morceaux, contrairement au texte :
    ils sont accumulés puis émis d'un bloc, car un appel partiel n'est pas
    validable.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx

from app.ai.providers.base import (
    AppelOutil,
    DelaiDepasse,
    ErreurFournisseur,
    Fragment,
    Message,
    Mesures,
    TypeFragment,
)
from app.ai.providers.base import LLMProvider

logger = logging.getLogger("app.ai.ollama")

#: Nanosecondes rendues par Ollama, ramenées en millisecondes.
_NS_PAR_MS = 1_000_000


class ClientOllama(LLMProvider):
    nom = "ollama"

    def __init__(
        self,
        *,
        base_url: str,
        keep_alive: str = "30m",
        timeout_premier_jeton_ms: int = 2_500,
        timeout_total_ms: int = 20_000,
        timeout_sante_ms: int = 800,
        sante_cache_s: int = 15,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._keep_alive = keep_alive
        self._delai_premier = timeout_premier_jeton_ms / 1000
        self._delai_total = timeout_total_ms / 1000
        self._delai_sante = timeout_sante_ms / 1000
        self._cache_sante_s = sante_cache_s
        self._sante: tuple[float, bool] | None = None
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------ base

    def _http(self) -> httpx.AsyncClient:
        """Client partagé : rouvrir une connexion par tour coûterait la poignée
        de main TCP à chaque message, soit une part visible du budget de 800 ms."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base,
                timeout=httpx.Timeout(self._delai_total, connect=2.0),
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            )
        return self._client

    async def fermer(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    # ---------------------------------------------------------------- santé

    async def disponible(self) -> bool:
        maintenant = time.monotonic()
        if self._sante is not None and maintenant - self._sante[0] < self._cache_sante_s:
            return self._sante[1]

        try:
            reponse = await self._http().get("/api/tags", timeout=self._delai_sante)
            vivant = reponse.status_code == 200
        except (httpx.HTTPError, asyncio.TimeoutError) as souci:
            # Journalisé en information et non en erreur : un Ollama absent est
            # un état de fonctionnement prévu, pas un incident.
            logger.info("Ollama injoignable", extra={"detail": str(souci)})
            vivant = False

        self._sante = (maintenant, vivant)
        return vivant

    async def modeles(self) -> list[str]:
        """Modèles réellement installés. Sert au démarrage à vérifier que ceux
        qui sont configurés existent, plutôt que de le découvrir en plein tour."""
        try:
            reponse = await self._http().get("/api/tags", timeout=self._delai_sante)
            reponse.raise_for_status()
        except httpx.HTTPError:
            return []
        return [item.get("name", "") for item in reponse.json().get("models", [])]

    async def charges(self) -> list[str]:
        """Modèles actuellement résidents en mémoire, d'après `/api/ps`."""
        try:
            reponse = await self._http().get("/api/ps", timeout=self._delai_sante)
            reponse.raise_for_status()
        except httpx.HTTPError:
            return []
        return [item.get("name", "") for item in reponse.json().get("models", [])]

    async def prechauffer(self, modele: str) -> bool:
        """Charge un modèle en mémoire sans rien lui demander.

        Mesuré sur la machine de développement : le premier appel après le
        démarrage d'Ollama a pris **79 secondes** pour `qwen2.5:3b`, dont
        l'essentiel en lecture du fichier de poids et initialisation CUDA ; les
        appels suivants tiennent en 1,1 seconde. Sans préchauffage, tout
        premier message d'une session partirait donc au repli déterministe, et
        le modèle ne servirait jamais.

        Appelé au démarrage de l'application, en arrière-plan : l'API doit
        répondre avant que le modèle soit prêt, pas après.
        """
        try:
            reponse = await self._http().post(
                "/api/generate",
                json={"model": modele, "keep_alive": self._keep_alive},
                timeout=180.0,
            )
            reponse.raise_for_status()
        except httpx.HTTPError as souci:
            logger.warning(
                "Préchauffage impossible", extra={"modele": modele, "detail": str(souci)}
            )
            return False
        logger.info("Modèle préchauffé", extra={"modele": modele})
        return True

    # ------------------------------------------------------------- discussion

    async def discuter(
        self,
        messages: Sequence[Message],
        *,
        modele: str,
        outils: Sequence[dict[str, Any]] | None = None,
        temperature: float = 0.2,
        max_jetons: int = 800,
        format_json: bool = False,
    ) -> AsyncIterator[Fragment]:
        charge: dict[str, Any] = {
            "model": modele,
            "messages": [message.pour_api() for message in messages],
            "stream": True,
            "keep_alive": self._keep_alive,
            "options": {"temperature": temperature, "num_predict": max_jetons},
        }
        if outils:
            # Ollama attend l'enveloppe `{"type": "function", "function": …}`,
            # comme les API compatibles OpenAI. Envoyés à plat — la forme du
            # catalogue — les schémas sont **ignorés sans erreur** : la réponse
            # revient en texte, aucun outil n'est appelé, et rien ne le signale.
            # Le catalogue garde donc sa forme nue, et chaque fournisseur
            # l'habille à sa manière.
            charge["tools"] = [{"type": "function", "function": outil} for outil in outils]
        if format_json:
            charge["format"] = "json"

        depart = time.perf_counter()
        premier_jeton_ms: int | None = None
        appels: list[AppelOutil] = []
        mesures_finales: dict[str, Any] = {}
        arret = "fin"

        # Le silence est surveillé par httpx lui-même, en `read` : il couvre
        # aussi l'attente des en-têtes, où se loge le chargement d'un modèle
        # froid. Un chronomètre posé plus haut ne l'aurait pas vu — mesuré :
        # Ollama retient ses en-têtes pendant les 79 secondes du premier appel.
        #
        # Le même délai vaut avant le premier jeton et entre deux jetons : un
        # silence de deux secondes et demie au milieu d'une phrase condamne le
        # tour autant qu'un silence au début.
        delais = httpx.Timeout(
            self._delai_premier, connect=2.0, write=10.0, pool=5.0
        )

        try:
            async with self._http().stream(
                "POST", "/api/chat", json=charge, timeout=delais
            ) as reponse:
                if reponse.status_code >= 400:
                    corps = (await reponse.aread()).decode("utf-8", "replace")[:300]
                    raise ErreurFournisseur(
                        f"Ollama a refusé la requête ({reponse.status_code}) : {corps}"
                    )

                async for ligne in reponse.aiter_lines():
                    # Budget total du tour, vérifié entre deux lignes : une
                    # génération qui n'en finit pas coûte à l'utilisateur ce
                    # qu'elle prend, et le repli répond plus vite qu'elle.
                    if time.perf_counter() - depart > self._delai_total:
                        raise DelaiDepasse(
                            "Ollama dépasse le budget de génération du tour."
                        )

                    if not ligne.strip():
                        continue

                    try:
                        evenement = json.loads(ligne)
                    except json.JSONDecodeError:
                        # Une ligne illisible n'interrompt pas le flux : elle est
                        # signalée et ignorée. Interrompre coûterait la réponse
                        # entière pour un octet perdu.
                        logger.warning("Ligne Ollama illisible", extra={"taille": len(ligne)})
                        continue

                    if erreur := evenement.get("error"):
                        raise ErreurFournisseur(f"Ollama : {erreur}")

                    message = evenement.get("message") or {}

                    if contenu := message.get("content"):
                        if premier_jeton_ms is None:
                            premier_jeton_ms = int((time.perf_counter() - depart) * 1000)
                        yield Fragment(type=TypeFragment.TEXTE, texte=contenu)

                    for brut in message.get("tool_calls") or []:
                        appel = _lire_appel(brut)
                        if appel is not None:
                            appels.append(appel)
                            if premier_jeton_ms is None:
                                premier_jeton_ms = int((time.perf_counter() - depart) * 1000)

                    if evenement.get("done"):
                        mesures_finales = evenement
                        arret = evenement.get("done_reason") or "fin"
                        break

        except httpx.TimeoutException as souci:
            # httpx surveille aussi la lecture des en-têtes, avant que notre
            # chronomètre ne soit armé : au premier appel, c'est lui qui voit
            # le chargement du modèle. Le traduire en `DelaiDepasse` fait dire
            # la vérité au journal — un délai, pas une panne réseau.
            raise DelaiDepasse(f"Ollama n'a pas répondu à temps : {souci}") from souci
        except httpx.HTTPError as souci:
            raise ErreurFournisseur(f"Ollama injoignable : {souci}") from souci

        if appels:
            yield Fragment(type=TypeFragment.OUTILS, appels=tuple(appels))

        yield Fragment(
            type=TypeFragment.FIN,
            mesures=Mesures(
                fournisseur=self.nom,
                modele=modele,
                premier_jeton_ms=premier_jeton_ms,
                total_ms=int((time.perf_counter() - depart) * 1000),
                chargement_ms=int(mesures_finales.get("load_duration", 0) // _NS_PAR_MS),
                jetons_invite=int(mesures_finales.get("prompt_eval_count", 0)),
                jetons_reponse=int(mesures_finales.get("eval_count", 0)),
                arret=arret,
            ),
        )

    # ---------------------------------------------------------------- vecteurs

    async def vectoriser(self, textes: Sequence[str], *, modele: str) -> list[list[float]]:
        if not textes:
            return []

        try:
            reponse = await self._http().post(
                "/api/embed",
                json={"model": modele, "input": list(textes), "keep_alive": self._keep_alive},
                timeout=self._delai_total,
            )
            reponse.raise_for_status()
        except httpx.HTTPError as souci:
            raise ErreurFournisseur(f"Vectorisation impossible : {souci}") from souci

        vecteurs = reponse.json().get("embeddings") or []
        if len(vecteurs) != len(textes):
            # Un décalage rendrait des fragments indexés sous le vecteur d'un
            # autre : mieux vaut échouer que produire un index faux.
            raise ErreurFournisseur(
                f"Ollama a rendu {len(vecteurs)} vecteurs pour {len(textes)} textes."
            )
        return vecteurs


def _lire_appel(brut: dict[str, Any]) -> AppelOutil | None:
    """Traduit un appel d'outil d'Ollama, quelle que soit la forme des arguments.

    Selon les modèles, `arguments` arrive en objet ou en chaîne JSON. Les deux
    sont acceptés ; tout le reste est ignoré et journalisé, car un appel qu'on
    ne sait pas lire ne doit pas devenir un appel qu'on devine.
    """
    fonction = brut.get("function") or {}
    nom = fonction.get("name")
    if not nom:
        return None

    arguments = fonction.get("arguments")
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments or "{}")
        except json.JSONDecodeError:
            logger.warning("Arguments d'outil illisibles", extra={"outil": nom})
            return None
    if not isinstance(arguments, dict):
        logger.warning("Arguments d'outil de forme inattendue", extra={"outil": nom})
        return None

    identifiant = brut.get("id")
    if identifiant:
        return AppelOutil(nom=nom, arguments=arguments, identifiant=str(identifiant))
    return AppelOutil(nom=nom, arguments=arguments)
