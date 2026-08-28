"""Quel modèle pour quel rôle, et chez quel fournisseur.

Le reste du code demande « un modèle de raisonnement » et non « qwen2.5:7b » :
c'est ce qui permet de changer de modèle par une variable d'environnement, et
de basculer du poste local à un fournisseur distant sans toucher à la boucle
d'agent.

L'ordre est fixe et sans surprise : Ollama d'abord, distant ensuite, rien
enfin. « Rien » n'est pas une panne — c'est le signal qui fait passer l'agent
au moteur déterministe, lequel n'a besoin d'aucun modèle.
"""

from __future__ import annotations

import logging

from app.ai.providers.base import FournisseurIndisponible, LLMProvider, RoleModele
from app.ai.providers.distant import Anonymiseur, ClientDistant
from app.ai.providers.ollama import ClientOllama
from app.ai.reglages import ReglagesIA, get_reglages_ia

logger = logging.getLogger("app.ai.selection")


class SelecteurModeles:
    """Choisit le couple (fournisseur, modèle) pour un rôle donné."""

    def __init__(
        self,
        reglages: ReglagesIA | None = None,
        *,
        anonymiseur: Anonymiseur | None = None,
    ) -> None:
        self._reglages = reglages or get_reglages_ia()
        self._anonymiseur = anonymiseur
        self._local: LLMProvider | None = None
        self._distant: LLMProvider | None = None
        #: Fournisseur imposé — les tests y placent le simulateur, et A-13 peut
        #: y forcer un étage pour éprouver une configuration.
        self._impose: LLMProvider | None = None

    # ------------------------------------------------------------ fabrication

    def _ollama(self) -> LLMProvider | None:
        if not self._reglages.ollama_url:
            return None
        if self._local is None:
            self._local = ClientOllama(
                base_url=self._reglages.ollama_url,
                keep_alive=self._reglages.keep_alive,
                timeout_premier_jeton_ms=self._reglages.timeout_premier_jeton_ms,
                timeout_total_ms=self._reglages.timeout_total_ms,
                timeout_sante_ms=self._reglages.timeout_sante_ms,
                sante_cache_s=self._reglages.sante_cache_s,
            )
        return self._local

    def _distant_ou_rien(self) -> LLMProvider | None:
        if not self._reglages.distant_configure:
            return None
        if self._distant is None:
            self._distant = ClientDistant(
                base_url=self._reglages.distant_url,
                cle=self._reglages.distant_cle,
                timeout_premier_jeton_ms=self._reglages.timeout_premier_jeton_ms,
                timeout_total_ms=self._reglages.timeout_total_ms,
                anonymiseur=self._anonymiseur,
                exiger_anonymisation=self._reglages.distant_exiger_anonymisation,
            )
        return self._distant

    # -------------------------------------------------------------- injection

    def imposer(self, fournisseur: LLMProvider | None) -> None:
        """Force un fournisseur pour tous les rôles. `None` rétablit l'ordre."""
        self._impose = fournisseur

    # ---------------------------------------------------------------- choix

    def modele_pour(self, role: RoleModele, fournisseur: LLMProvider) -> str:
        distant = fournisseur is self._distant
        if role is RoleModele.RAISONNEMENT:
            return (
                self._reglages.distant_modele_raisonnement
                if distant and self._reglages.distant_modele_raisonnement
                else self._reglages.modele_raisonnement
            )
        if role is RoleModele.RAPIDE:
            return (
                self._reglages.distant_modele_rapide
                if distant and self._reglages.distant_modele_rapide
                else self._reglages.modele_rapide
            )
        return (
            self._reglages.distant_modele_vecteurs
            if distant and self._reglages.distant_modele_vecteurs
            else self._reglages.modele_vecteurs
        )

    async def pour(self, role: RoleModele) -> tuple[LLMProvider, str]:
        """Rend le fournisseur joignable et le modèle à employer pour ce rôle.

        Lève `FournisseurIndisponible` quand aucun étage ne répond : c'est
        l'unique signal attendu par la boucle d'agent pour passer au repli.
        """
        # L'ordre compte : un fournisseur imposé passe **avant** le repli forcé.
        # « Imposer » veut dire imposer ; et sans cette priorité, aucun test ne
        # pourrait éprouver le chemin du modèle sur une suite qui coupe
        # l'inférence par `IA_FORCER_REPLI`.
        if self._impose is not None:
            return self._impose, self.modele_pour(role, self._impose)

        if self._reglages.forcer_repli:
            raise FournisseurIndisponible("Repli déterministe forcé par configuration.")

        for fabrique in (self._ollama, self._distant_ou_rien):
            fournisseur = fabrique()
            if fournisseur is None:
                continue
            if await fournisseur.disponible():
                return fournisseur, self.modele_pour(role, fournisseur)
            logger.info("Fournisseur écarté", extra={"fournisseur": fournisseur.nom})

        raise FournisseurIndisponible("Aucun fournisseur d'inférence disponible.")

    async def prechauffer(self) -> list[str]:
        """Charge les modèles locaux en mémoire, avant la première question.

        Ollama ne garde les poids que `keep_alive` — trente minutes ici — et
        les recharge depuis le disque ensuite. Mesuré sur le poste de
        développement : 79 secondes pour le premier appel, 1,1 seconde pour les
        suivants. Le budget de premier jeton étant de six secondes, **toute
        première question d'une session partait au repli déterministe**, qui ne
        connaît qu'une poignée d'intentions : l'assistant répondait « je n'ai
        pas compris » à des questions que le modèle traite sans peine.

        `ClientOllama.prechauffer` existait et se disait « appelé au démarrage
        de l'application » ; rien ne l'appelait.

        Deux modèles seulement : celui du raisonnement, et celui des vecteurs
        dont chaque recherche documentaire a besoin. Le modèle rapide se
        chargera à son premier usage — précharger trois modèles saturerait la
        mémoire d'un poste ordinaire pour un gain que la mesure ne montre pas.
        """
        if self._reglages.forcer_repli:
            return []

        local = self._ollama()
        if not isinstance(local, ClientOllama) or not await local.disponible():
            return []

        charges: list[str] = []
        for modele in (self._reglages.modele_raisonnement, self._reglages.modele_vecteurs):
            if modele and await local.prechauffer(modele):
                charges.append(modele)
        return charges

    async def diagnostic(self) -> dict[str, object]:
        """État des étages, pour le tableau de bord A-13 et le démarrage.

        Vérifie aussi que les modèles configurés sont réellement installés :
        découvrir un nom mal orthographié en plein tour coûte un repli, alors
        que le découvrir au démarrage coûte une ligne de journal.
        """
        local = self._ollama()
        distant = self._distant_ou_rien()
        installes: list[str] = []
        if isinstance(local, ClientOllama) and await local.disponible():
            installes = await local.modeles()

        attendus = {
            RoleModele.RAISONNEMENT.value: self._reglages.modele_raisonnement,
            RoleModele.RAPIDE.value: self._reglages.modele_rapide,
            RoleModele.VECTEURS.value: self._reglages.modele_vecteurs,
        }
        return {
            "repli_force": self._reglages.forcer_repli,
            "ollama": {
                "configure": local is not None,
                "joignable": bool(local and await local.disponible()),
                "modeles_installes": installes,
                "manquants": [
                    nom
                    for nom in attendus.values()
                    if installes and not any(m.startswith(nom.split(":")[0]) for m in installes)
                ],
            },
            "distant": {
                "configure": distant is not None,
                "utilisable": bool(distant and await distant.disponible()),
                "anonymisation": self._anonymiseur is not None,
            },
            "modeles": attendus,
        }

    async def fermer(self) -> None:
        for fournisseur in (self._local, self._distant):
            if fournisseur is not None:
                await fournisseur.fermer()
        self._local = None
        self._distant = None
