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
        dimensions: int | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._cle = cle
        self._delai_premier = timeout_premier_jeton_ms / 1000
        self._delai_total = timeout_total_ms / 1000
        self._anonymiseur = anonymiseur
        self._exiger = exiger_anonymisation
        #: Dimension reclamee aux embeddings. La colonne pgvector est figee par
        #: la migration 0007 ; un modele qui rend davantage ne degrade pas la
        #: recherche, il fait echouer l'insertion.
        #:
        #: Mesure sur gemini-embedding-001 : 3 072 dimensions par defaut, 768
        #: avec ce parametre. La troncature est sans consequence ici, la
        #: recherche comparant par cosinus — une mesure qui ignore la norme.
        self._dimensions = dimensions
        #: Signatures de raisonnement, par identifiant d'appel d'outil.
        #:
        #: Les modèles Gemini 3 joignent à chaque appel une `thought_signature`
        #: et exigent de la retrouver au tour suivant :
        #:
        #:   400 Function call is missing a thought_signature in functionCall
        #:       parts. This is required for tools to work correctly.
        #:
        #: Elle voyage dans `extra_content`, hors du protocole OpenAI, et se
        #: perdait donc à la traduction. Le premier appel passait, l'outil
        #: s'exécutait, et le second échouait — l'utilisateur voyait la carte
        #: apparaître puis la réponse s'arrêter.
        #:
        #: Gardée ici plutôt que dans `AppelOutil` : c'est une particularité de
        #: ce protocole, que la boucle d'agent n'a pas à connaître. La table vit
        #: le temps du client, donc celui du tour.
        self._signatures: dict[str, Any] = {}
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

    def _rendre(self, texte: str) -> str:
        """Retraduit les jetons d'anonymisation avant l'affichage.

        Ce que l'anonymiseur a masqué à l'aller doit revenir au retour, sinon
        l'utilisateur lit « PERSONNE_1 » là où il attendait un nom. La table de
        correspondance ne quitte pas le serveur : elle vit dans l'anonymiseur,
        que le sélecteur crée pour la durée du tour.

        Sans anonymiseur — un fournisseur qui n'en exige pas — le texte passe
        inchangé.
        """
        rendre = getattr(self._anonymiseur, "restituer", None)
        return rendre(texte) if rendre else texte

    def _preparer(self, messages: Sequence[Message]) -> list[dict[str, Any]]:
        if self._exiger and self._anonymiseur is None:
            raise ErreurFournisseur(
                "Envoi distant refusé : aucune anonymisation n'est branchée.",
                code="ia_anonymisation_absente",
            )
        sortants = self._anonymiseur(messages) if self._anonymiseur else messages
        return [
            self._rendre_signature(_arguments_en_chaine(message.pour_api()))
            for message in sortants
        ]

    def _rendre_signature(self, charge: dict[str, Any]) -> dict[str, Any]:
        """Rattache à chaque appel la signature reçue avec lui.

        Sans mémoire de signature — Ollama, OpenAI, Gemini 2 — la charge repart
        inchangée : rien n'est fabriqué là où rien n'a été reçu.
        """
        appels = charge.get("tool_calls")
        if not appels or not self._signatures:
            return charge
        return charge | {
            "tool_calls": [
                appel | {"extra_content": signature}
                if (signature := self._signatures.get(str(appel.get("id"))))
                else appel
                for appel in appels
            ]
        }

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
            charge["tools"] = [
                {"type": "function", "function": outil} for outil in outils
            ]
        if format_json:
            charge["response_format"] = {"type": "json_object"}

        depart = time.perf_counter()
        premier_jeton_ms: int | None = None
        # Les morceaux d'appels arrivent indexés : l'index est la seule chose
        # qui relie un nom reçu en premier à ses arguments reçus ensuite.
        partiels: dict[int, dict[str, Any]] = {}
        jetons_reponse = 0
        arret = "fin"
        #: Texte reçu mais pas encore rendu, retenu jusqu'au prochain blanc.
        #:
        #: Les jetons d'anonymisation — `PERSONNE_1` — ne contiennent aucune
        #: espace, mais le modèle les diffuse en plusieurs morceaux. Rendre
        #: chaque morceau tel quel laisserait passer « PERSON », puis « NE_1 » :
        #: la retraduction ne reconnaîtrait ni l'un ni l'autre. Attendre le
        #: blanc suivant garantit qu'un jeton est entier quand on le traduit.
        tampon = ""

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
                        raise DelaiDepasse(
                            "Fournisseur distant : budget du tour dépassé."
                        )

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
                            premier_jeton_ms = int(
                                (time.perf_counter() - depart) * 1000
                            )
                        tampon += contenu
                        for texte in _mots_complets(tampon):
                            tampon = tampon[len(texte) :]
                            yield Fragment(
                                type=TypeFragment.TEXTE, texte=self._rendre(texte)
                            )

                    for morceau in delta.get("tool_calls") or []:
                        # L'index correle les morceaux d'un meme appel d'un
                        # fragment a l'autre. Certaines facades — celle de
                        # Gemini — rendent l'appel entier d'un coup et
                        # l'omettent : deux appels simultanes tomberaient alors
                        # sous la meme cle, noms et arguments concatenes,
                        # l'appel devenant inexploitable. Sans index, chacun
                        # prend donc une place neuve.
                        brut = morceau.get("index")
                        index = (
                            int(brut)
                            if brut is not None
                            else max(partiels, default=-1) + 1
                        )
                        courant = partiels.setdefault(
                            index, {"id": morceau.get("id"), "nom": "", "arguments": ""}
                        )
                        fonction = morceau.get("function") or {}
                        courant["nom"] += fonction.get("name") or ""
                        courant["arguments"] += fonction.get("arguments") or ""
                        if extra := morceau.get("extra_content"):
                            courant["extra"] = extra
                        if premier_jeton_ms is None:
                            premier_jeton_ms = int(
                                (time.perf_counter() - depart) * 1000
                            )

        except httpx.TimeoutException as souci:
            raise DelaiDepasse(
                f"Fournisseur distant : délai dépassé ({souci})."
            ) from souci
        except httpx.HTTPError as souci:
            raise ErreurFournisseur(
                f"Fournisseur distant injoignable : {souci}"
            ) from souci

        # Le dernier mot n'est suivi d'aucun blanc : sans cette vidange, la fin
        # de chaque réponse manquerait à l'écran.
        if tampon:
            yield Fragment(type=TypeFragment.TEXTE, texte=self._rendre(tampon))

        # Retenues avant l'assemblage, qui ne garde que ce que la boucle
        # d'agent doit connaître — nom, arguments, identifiant.
        self._signatures.update(
            {
                str(morceau["id"]): morceau["extra"]
                for morceau in partiels.values()
                if morceau.get("id") and morceau.get("extra")
            }
        )

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

    async def vectoriser(
        self, textes: Sequence[str], *, modele: str
    ) -> list[list[float]]:
        if not textes:
            return []
        try:
            corps: dict[str, Any] = {"model": modele, "input": list(textes)}
            if self._dimensions:
                corps["dimensions"] = self._dimensions
            reponse = await self._http().post("/embeddings", json=corps)
            reponse.raise_for_status()
        except httpx.HTTPError as souci:
            raise ErreurFournisseur(
                f"Vectorisation distante impossible : {souci}"
            ) from souci

        lignes = reponse.json().get("data") or []
        if len(lignes) != len(textes):
            raise ErreurFournisseur("Nombre de vecteurs distant incohérent.")
        return [
            ligne["embedding"]
            for ligne in sorted(lignes, key=lambda x: x.get("index", 0))
        ]


def _mots_complets(tampon: str) -> tuple[str, ...]:
    """Rend la part du tampon dont on sait qu'elle ne coupe aucun mot.

    Soit tout ce qui précède le dernier blanc, ce blanc compris ; soit rien,
    quand le tampon n'en contient aucun. Le reste attend le fragment suivant.

    Un tuple plutôt qu'une valeur simple : l'appelant écrit une boucle, qui
    n'émet rien quand il n'y a rien à émettre.
    """
    dernier = max(
        (position for position, lettre in enumerate(tampon) if lettre.isspace()),
        default=-1,
    )
    return (tampon[: dernier + 1],) if dernier >= 0 else ()


def _arguments_en_chaine(charge: dict[str, Any]) -> dict[str, Any]:
    """Reserialise les arguments d'appel d'outil, que ce protocole veut en texte.

    Troisieme divergence avec Ollama, apres le flux `data:` et les morceaux
    indexes. `AppelOutil.arguments` est un dictionnaire — c'est la forme utile
    a la boucle d'agent — et Ollama l'accepte tel quel. Le protocole OpenAI,
    lui, transporte une chaine JSON :

        Value is not a string: {"question":"absence"}

    Mesure sur la facade Gemini. L'erreur ne survient qu'au **second** aller-
    retour, celui qui renvoie le resultat de l'outil au modele : le premier
    appel reussit, l'outil s'execute, puis le tour bascule au repli avec pour
    seul indice « ia_fournisseur » au journal. L'utilisateur voit la bonne
    carte et, sous elle, « je n'ai pas compris la demande ».

    Invisible en local, ou Ollama sert seul.
    """
    appels = charge.get("tool_calls")
    if not appels:
        return charge
    return charge | {
        "tool_calls": [
            appel
            | {
                "function": appel["function"]
                | {
                    "arguments": (
                        arguments
                        if isinstance(arguments := appel["function"]["arguments"], str)
                        else json.dumps(arguments, ensure_ascii=False)
                    )
                }
            }
            for appel in appels
        ]
    }


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
            logger.warning(
                "Arguments distants illisibles", extra={"outil": morceau["nom"]}
            )
            continue
        if not isinstance(arguments, dict):
            continue
        identifiant = morceau.get("id")
        appels.append(
            AppelOutil(
                nom=morceau["nom"], arguments=arguments, identifiant=str(identifiant)
            )
            if identifiant
            else AppelOutil(nom=morceau["nom"], arguments=arguments)
        )
    return tuple(appels)
