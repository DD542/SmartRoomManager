"""Production des vecteurs, et cache des questions déjà posées.

Vectoriser coûte un aller-retour au modèle — 90 ms par requête mesurés sur la
machine de développement. C'est peu, mais c'est payé **avant** le premier jeton
de la réponse, dans un budget qui en compte 800 au total. Les questions se
répètent ; le cache les rend gratuites la deuxième fois.

Le cache est en mémoire du processus, volontairement. Un cache partagé
demanderait Redis, hors de la liste de dépendances arrêtée, pour un gain nul
sur un déploiement à une seule instance.
"""

from __future__ import annotations

import hashlib
import logging
from collections import OrderedDict
from collections.abc import Sequence

from app.ai.providers.base import ErreurFournisseur, LLMProvider, RoleModele
from app.ai.providers.selection import SelecteurModeles
from app.ai.reglages import get_reglages_ia

logger = logging.getLogger("app.ai.rag.vecteurs")


class CacheVecteurs:
    """Cache borné, éviction du plus ancien utilisé.

    Borné parce qu'un cache sans limite est une fuite de mémoire à retardement :
    chaque question inédite y laisserait 768 flottants, indéfiniment.
    """

    def __init__(self, capacite: int = 512) -> None:
        self._entrees: OrderedDict[str, list[float]] = OrderedDict()
        self._capacite = capacite
        self.touches = 0
        self.manques = 0

    @staticmethod
    def _cle(texte: str, modele: str) -> str:
        # Le modèle entre dans la clé : deux modèles ne produisent pas des
        # vecteurs comparables, et resservir le vecteur de l'un pour l'autre
        # donnerait des distances absurdes.
        return hashlib.blake2b(f"{modele}\x00{texte}".encode(), digest_size=16).hexdigest()

    def obtenir(self, texte: str, modele: str) -> list[float] | None:
        cle = self._cle(texte, modele)
        vecteur = self._entrees.get(cle)
        if vecteur is None:
            self.manques += 1
            return None
        self._entrees.move_to_end(cle)
        self.touches += 1
        return vecteur

    def poser(self, texte: str, modele: str, vecteur: list[float]) -> None:
        cle = self._cle(texte, modele)
        self._entrees[cle] = vecteur
        self._entrees.move_to_end(cle)
        while len(self._entrees) > self._capacite:
            self._entrees.popitem(last=False)

    def vider(self) -> None:
        self._entrees.clear()

    @property
    def statistiques(self) -> dict[str, int | float]:
        total = self.touches + self.manques
        return {
            "entrees": len(self._entrees),
            "touches": self.touches,
            "manques": self.manques,
            "taux": round(self.touches / total, 3) if total else 0.0,
        }


CACHE = CacheVecteurs()

class Vectoriseur:
    """Façade au-dessus du fournisseur, avec cache et dégradation explicite."""

    def __init__(
        self, selecteur: SelecteurModeles | None = None, *, cache: CacheVecteurs | None = None
    ) -> None:
        self._selecteur = selecteur or SelecteurModeles()
        self._cache = cache or CACHE
        self._reglages = get_reglages_ia()

    async def disponible(self) -> bool:
        try:
            await self._selecteur.pour(RoleModele.VECTEURS)
        except ErreurFournisseur:
            return False
        return True

    async def vectoriser(self, textes: Sequence[str]) -> list[list[float]] | None:
        """Rend un vecteur par texte, ou `None` si aucun modèle n'est joignable.

        `None` et non une exception : l'absence de vecteurs n'est pas une panne
        mais un mode dégradé — la recherche hybride retombe alors sur son seul
        volet lexical, qui ne demande aucun modèle.
        """
        if not textes:
            return []

        try:
            fournisseur, modele = await self._selecteur.pour(RoleModele.VECTEURS)
        except ErreurFournisseur as souci:
            logger.info("Vectorisation indisponible", extra={"detail": souci.message})
            return None

        resultats: list[list[float] | None] = [self._cache.obtenir(t, modele) for t in textes]
        manquants = [index for index, valeur in enumerate(resultats) if valeur is None]

        if manquants:
            try:
                produits = await fournisseur.vectoriser(
                    [textes[index] for index in manquants], modele=modele
                )
            except ErreurFournisseur as souci:
                logger.warning("Vectorisation échouée", extra={"detail": souci.message})
                return None

            for index, vecteur in zip(manquants, produits, strict=True):
                self._cache.poser(textes[index], modele, vecteur)
                resultats[index] = vecteur

        return [vecteur for vecteur in resultats if vecteur is not None]

    async def modele_courant(self) -> str | None:
        try:
            _, modele = await self._selecteur.pour(RoleModele.VECTEURS)
        except ErreurFournisseur:
            return None
        return modele


_PARTAGE: Vectoriseur | None = None


def vectoriseur_partage() -> Vectoriseur:
    """Instance unique du processus.

    Mesuré : construire un `Vectoriseur` par recherche coûtait 280 ms, sans
    aucun appel au modèle — chaque instance rouvrait un client HTTP et refaisait
    le test de vie d'Ollama, dont le cache mourait avec elle. Partagée, la
    recherche retombe à quelques millisecondes quand la question est en cache.
    """
    global _PARTAGE
    if _PARTAGE is None:
        _PARTAGE = Vectoriseur()
    return _PARTAGE
