"""Fournisseur distant compatible OpenAI, pour la démonstration en ligne.

Il n'existe que parce qu'aucun hébergement gratuit ne fait tourner un modèle de
sept milliards de paramètres. Il est désactivé tant qu'aucune URL ni clé ne
sont fournies, et il refuse d'émettre si l'anonymisation exigée n'est pas
branchée : un oubli de configuration ne doit pas se traduire par l'envoi de
noms et d'adresses à un tiers.

Le protocole diffère d'Ollama sur deux points seulement — le flux est du SSE
`data:` et les appels d'outils arrivent par morceaux indexés — et ces deux
différences sont absorbées ici. Le reste du code ne les voit pas.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator, Callable, Sequence
from typing import Any

import httpx

from app.ai.providers.base import (
    AppelOutil,
    DelaiDepasse,
    ErreurFournisseur,
    Fragment,
    LLMProvider,
    Message,
    Mesures,
    TypeFragment,
)

logger = logging.getLogger("app.ai.distant")

#: Reçoit les messages sortants et rend leur version anonymisée.
Anonymiseur = Callable[[Sequence[Message]], Sequence[Message]]


class ClientDistant(LLMProvider):
    nom = "distant"

    def __init__(
        self,
        *,
        base_url: str,
        cle: str,
        timeout_premier_jeton_ms: int = 2_500,
        timeout_total_ms: int = 20_000,
        anonymiseur: Anonymiseur | None = None,
        exiger_anonymisation: bool = True,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._cle = cle
        self._delai_premier = timeout_premier_jeton_ms / 1000
        self._delai_total = timeout_total_ms / 1000
        self._anonymiseur = anonymiseur
        self._exiger = exiger_anonymisation
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base,
                timeout=httpx.Timeout(self._delai_total, connect=5.0),
                headers={"Authorization": f"Bearer {self._cle}"},
            )
        return self._client

    async def fermer(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    async def disponible(self) -> bool:
        if not self._base or not self._cle:
            return False
        if self._exiger and self._anonymiseur is None:
            logger.warning("Fournisseur distant désactivé : anonymisation absente")
            return False
        return True

    def _preparer(self, messages: Sequence[Message]) -> list[dict[str, Any]]:
        if self._exiger and self._anonymiseur is None:
            raise ErreurFournisseur(
                "Envoi distant refusé : aucune anonymisation n'est branchée.",
                code="ia_anonymisation_absente",
            )
        sortants = self._anonymiseur(messages) if self._anonymiseur else messages
        return [message.pour_api() for message in sortants]

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
            "messages": self._preparer(messages),
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_jetons,
        }
        if outils:
            charge["tools"] = [{"type": "function", "function": outil} for outil in outils]
        if format_json:
            charge["response_format"] = {"type": "json_object"}

        depart = time.perf_counter()
        premier_jeton_ms: int | None = None
        # Les morceaux d'appels arrivent indexés : l'index est la seule chose
        # qui relie un nom reçu en premier à ses arguments reçus ensuite.
        partiels: dict[int, dict[str, Any]] = {}
        jetons_reponse = 0
        arret = "fin"

        # Même politique que pour Ollama : le silence est surveillé par httpx,
        # en `read`, ce qui couvre l'attente des en-têtes ; le budget total du
        # tour est vérifié entre deux lignes.
        delais = httpx.Timeout(self._delai_premier, connect=5.0, write=10.0, pool=5.0)

        try:
            async with self._http().stream(
                "POST", "/chat/completions", json=charge, timeout=delais
            ) as reponse:
                if reponse.status_code >= 400:
                    corps = (await reponse.aread()).decode("utf-8", "replace")[:300]
                    raise ErreurFournisseur(
                        f"Fournisseur distant : refus ({reponse.status_code}) {corps}"
                    )

                async for ligne in reponse.aiter_lines():
                    if time.perf_counter() - depart > self._delai_total:
                        raise DelaiDepasse("Fournisseur distant : budget du tour dépassé.")

                    if not ligne.startswith("data:"):
                        continue
                    donnees = ligne[5:].strip()
                    if donnees == "[DONE]":
                        break

                    try:
                        evenement = json.loads(donnees)
                    except json.JSONDecodeError:
                        continue

                    choix = (evenement.get("choices") or [{}])[0]
                    delta = choix.get("delta") or {}
                    if choix.get("finish_reason"):
                        arret = choix["finish_reason"]

                    if contenu := delta.get("content"):
                        jetons_reponse += 1
                        if premier_jeton_ms is None:
                            premier_jeton_ms = int((time.perf_counter() - depart) * 1000)
                        yield Fragment(type=TypeFragment.TEXTE, texte=contenu)

                    for morceau in delta.get("tool_calls") or []:
                        index = int(morceau.get("index", 0))
                        courant = partiels.setdefault(
                            index, {"id": morceau.get("id"), "nom": "", "arguments": ""}
                        )
                        fonction = morceau.get("function") or {}
                        courant["nom"] += fonction.get("name") or ""
                        courant["arguments"] += fonction.get("arguments") or ""
                        if premier_jeton_ms is None:
                            premier_jeton_ms = int((time.perf_counter() - depart) * 1000)

        except httpx.TimeoutException as souci:
            raise DelaiDepasse(f"Fournisseur distant : délai dépassé ({souci}).") from souci
        except httpx.HTTPError as souci:
            raise ErreurFournisseur(f"Fournisseur distant injoignable : {souci}") from souci

        if appels := _assembler(partiels):
            yield Fragment(type=TypeFragment.OUTILS, appels=appels)

        yield Fragment(
            type=TypeFragment.FIN,
            mesures=Mesures(
                fournisseur=self.nom,
                modele=modele,
                premier_jeton_ms=premier_jeton_ms,
                total_ms=int((time.perf_counter() - depart) * 1000),
                jetons_reponse=jetons_reponse,
                arret=arret,
            ),
        )

    async def vectoriser(self, textes: Sequence[str], *, modele: str) -> list[list[float]]:
        if not textes:
            return []
        try:
            reponse = await self._http().post(
                "/embeddings", json={"model": modele, "input": list(textes)}
            )
            reponse.raise_for_status()
        except httpx.HTTPError as souci:
            raise ErreurFournisseur(f"Vectorisation distante impossible : {souci}") from souci

        lignes = reponse.json().get("data") or []
        if len(lignes) != len(textes):
            raise ErreurFournisseur("Nombre de vecteurs distant incohérent.")
        return [ligne["embedding"] for ligne in sorted(lignes, key=lambda x: x.get("index", 0))]


def _assembler(partiels: dict[int, dict[str, Any]]) -> tuple[AppelOutil, ...]:
    """Recompose les appels reçus par morceaux, en ignorant les inachevés."""
    appels: list[AppelOutil] = []
    for index in sorted(partiels):
        morceau = partiels[index]
        if not morceau["nom"]:
            continue
        try:
            arguments = json.loads(morceau["arguments"] or "{}")
        except json.JSONDecodeError:
            logger.warning("Arguments distants illisibles", extra={"outil": morceau["nom"]})
            continue
        if not isinstance(arguments, dict):
            continue
        identifiant = morceau.get("id")
        appels.append(
            AppelOutil(nom=morceau["nom"], arguments=arguments, identifiant=str(identifiant))
            if identifiant
            else AppelOutil(nom=morceau["nom"], arguments=arguments)
        )
    return tuple(appels)
