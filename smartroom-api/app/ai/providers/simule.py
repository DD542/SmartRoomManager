"""Fournisseur simulé : le seul moyen d'avoir des tests reproductibles.

Une inférence réelle rend un texte différent à chaque exécution, met des
centaines de millisecondes, et exige une machine équipée. Un test qui en
dépendrait ne prouverait rien de la boucle d'agent, seulement que le modèle
était de bonne humeur.

Ce fournisseur joue une partition écrite d'avance : tour 1 appelle tel outil,
tour 2 répond tel texte. Il enregistre aussi ce qu'il a reçu, ce qui permet de
vérifier l'inverse — que le contexte transmis contient bien le prompt système,
les résultats d'outils, et rien de ce qui devait être écarté.
"""

from __future__ import annotations

import hashlib
import struct
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any

from app.ai.providers.base import (
    AppelOutil,
    ErreurFournisseur,
    Fragment,
    LLMProvider,
    Message,
    Mesures,
    TypeFragment,
)


@dataclass(frozen=True, slots=True)
class TourSimule:
    """Ce que le modèle est censé produire à un tour donné.

    `erreur` prend le pas sur le reste : c'est ainsi que les tests éprouvent le
    repli, sans avoir à éteindre quoi que ce soit.
    """

    texte: str = ""
    appels: tuple[AppelOutil, ...] = ()
    erreur: Exception | None = None
    #: Latence simulée, pour éprouver les délais sans attendre réellement.
    premier_jeton_ms: int = 40
    #: Découpe le texte en morceaux, comme le ferait un vrai flux.
    taille_morceau: int = 12


@dataclass
class AppelRecu:
    """Trace d'un appel, pour les assertions des tests."""

    messages: tuple[Message, ...]
    modele: str
    outils: tuple[str, ...]
    temperature: float
    format_json: bool


class FournisseurSimule(LLMProvider):
    nom = "simule"

    def __init__(
        self,
        tours: Sequence[TourSimule] | None = None,
        *,
        disponible_: bool = True,
        dimension: int = 768,
    ) -> None:
        self._tours = list(tours or [])
        self._position = 0
        self._disponible = disponible_
        self._dimension = dimension
        self.recus: list[AppelRecu] = []

    # ------------------------------------------------------------ pilotage

    def programmer(self, *tours: TourSimule) -> None:
        """Remplace la partition. Utile entre deux scénarios d'un même test."""
        self._tours = list(tours)
        self._position = 0

    def rendre_indisponible(self) -> None:
        self._disponible = False

    @property
    def tours_consommes(self) -> int:
        return self._position

    # ------------------------------------------------------------- interface

    async def disponible(self) -> bool:
        return self._disponible

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
        self.recus.append(
            AppelRecu(
                messages=tuple(messages),
                modele=modele,
                outils=tuple(outil["name"] for outil in (outils or [])),
                temperature=temperature,
                format_json=format_json,
            )
        )

        if self._position >= len(self._tours):
            raise ErreurFournisseur(
                f"Partition épuisée : {self._position + 1} tours demandés, "
                f"{len(self._tours)} programmés."
            )

        tour = self._tours[self._position]
        self._position += 1

        if tour.erreur is not None:
            raise tour.erreur

        depart = time.perf_counter()

        for debut in range(0, len(tour.texte), tour.taille_morceau):
            yield Fragment(
                type=TypeFragment.TEXTE,
                texte=tour.texte[debut : debut + tour.taille_morceau],
            )

        if tour.appels:
            yield Fragment(type=TypeFragment.OUTILS, appels=tour.appels)

        yield Fragment(
            type=TypeFragment.FIN,
            mesures=Mesures(
                fournisseur=self.nom,
                modele=modele,
                premier_jeton_ms=tour.premier_jeton_ms,
                total_ms=int((time.perf_counter() - depart) * 1000),
                jetons_invite=sum(len(m.contenu) // 4 for m in messages),
                jetons_reponse=max(1, len(tour.texte) // 4),
            ),
        )

    async def vectoriser(
        self, textes: Sequence[str], *, modele: str
    ) -> list[list[float]]:
        """Vecteurs déterministes, dérivés du texte.

        Deux textes identiques rendent le même vecteur, deux textes différents
        des vecteurs différents : c'est tout ce dont les tests du lot 3 ont
        besoin. La ressemblance sémantique, elle, ne se simule pas — les tests
        de pertinence porteront sur la fusion des rangs, pas sur le sens.
        """
        return [_vecteur_stable(texte, self._dimension) for texte in textes]


def _vecteur_stable(texte: str, dimension: int) -> list[float]:
    graine = hashlib.blake2b(texte.encode("utf-8"), digest_size=8).digest()
    (valeur,) = struct.unpack("<Q", graine)
    composantes: list[float] = []
    for index in range(dimension):
        valeur = (
            valeur * 6_364_136_223_846_793_005 + index * 1_442_695_040_888_963_407
        ) % (2**64)
        composantes.append(((valeur >> 11) / float(1 << 53)) * 2.0 - 1.0)

    norme = sum(composante * composante for composante in composantes) ** 0.5 or 1.0
    return [composante / norme for composante in composantes]
