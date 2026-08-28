"""Réglages de la couche d'intelligence artificielle.

Séparés de `app.core.config` pour une raison de nature, pas de commodité : ces
valeurs sont destinées à être modifiées en marche depuis l'écran A-13, alors
que `Settings` décrit ce que l'application est au démarrage — adresse de la
base, secret de signature, origines autorisées. Mélanger les deux ferait croire
qu'un secret se recharge à chaud, ou qu'un seuil de similarité demande un
redémarrage.

Toutes les variables portent le préfixe `IA_`.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class ReglagesIA(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", env_prefix="IA_"
    )

    # ------------------------------------------------------------ fourniture

    #: Étage A. Vide désactive Ollama sans toucher au reste.
    ollama_url: str = "http://127.0.0.1:11434"

    #: Étage B, facultatif : toute API compatible OpenAI. Laissé vide, aucun
    #: appel distant n'est possible — c'est l'état par défaut, et il est voulu.
    distant_url: str = ""
    distant_cle: str = ""
    distant_modele_raisonnement: str = ""
    distant_modele_rapide: str = ""
    distant_modele_vecteurs: str = ""

    #: Refuse d'émettre vers l'étage B tant qu'aucune fonction d'anonymisation
    #: n'est branchée. Un oubli de configuration ne doit pas se traduire par une
    #: fuite de noms et d'adresses vers un tiers.
    distant_exiger_anonymisation: bool = True

    # --------------------------------------------------------------- modèles

    modele_raisonnement: str = "qwen2.5:7b"
    modele_rapide: str = "qwen2.5:3b"
    modele_vecteurs: str = "nomic-embed-text"
    #: Dimension rendue par le modèle de vecteurs. Fixe la colonne pgvector du
    #: lot 3 : la changer impose une migration, jamais un simple redémarrage.
    dimension_vecteurs: int = 768

    #: Durée pendant laquelle Ollama garde les poids en mémoire. Le rechargement
    #: coûte plusieurs secondes et se voit à l'écran ; trente minutes couvrent
    #: une démonstration entière.
    keep_alive: str = "30m"

    # ---------------------------------------------------------------- délais

    #: Au-delà, la réponse simple immédiate vaut mieux que la réponse fine
    #: tardive : c'est le déclencheur principal du repli déterministe.
    #:
    #: Six secondes et non deux et demie. Mesuré avec le prompt réel et le
    #: catalogue d'outils — 3 439 jetons d'invite : 3 455 ms au premier appel,
    #: 1 524 ms ensuite, l'invite étant mise en cache par Ollama. À 2 500 ms,
    #: **chaque première question d'une session partait au repli** et le modèle
    #: ne servait jamais. Le repli, lui, répond en 150 à 600 ms : attendre six
    #: secondes avant d'y renoncer reste supportable.
    timeout_premier_jeton_ms: int = 6_000
    timeout_total_ms: int = 20_000
    #: Test de vie. Court : il précède chaque tour, il ne doit rien coûter.
    timeout_sante_ms: int = 800
    #: Durée de validité du dernier test de vie, pour ne pas interroger Ollama
    #: à chaque message.
    sante_cache_s: int = 15

    # ------------------------------------------------------------- génération

    #: Basse et non nulle : à zéro, un modèle qui s'engage dans une mauvaise
    #: formulation d'appel d'outil s'y enferme d'un tour à l'autre.
    temperature: float = 0.2
    temperature_routage: float = 0.0
    max_jetons_reponse: int = 800
    max_jetons_routage: int = 60

    # ---------------------------------------------------------------- budget

    budget_contexte_total: int = 9_200
    budget_historique: int = 2_500
    budget_extraits: int = 1_200
    budget_resume: int = 400
    budget_resultats_outils: int = 2_000
    #: Nombre de tours conservés intégralement avant résumé des plus anciens.
    tours_avant_resume: int = 8

    # ----------------------------------------------------------------- agent

    max_iterations: int = 5
    max_outils_par_tour: int = 8
    budget_tour_ms: int = 25_000
    tentatives_validation: int = 2

    # ------------------------------------------------------------------- RAG

    rag_top_k: int = 4
    rag_seuil_similarite: float = 0.32
    rag_poids_fusion: int = 60
    rag_taille_fragment: int = 300
    rag_recouvrement: int = 60

    # ------------------------------------------------------------ discussion

    debit_messages: str = "20/minute"
    taille_message: int = 2_000
    retention_jours: int = 90
    confirmation_ttl_s: int = 900

    # --------------------------------------------------------------- prompts

    prompt_systeme_version: int = 1

    #: Coupe toute inférence et force le moteur déterministe. Sert à éprouver
    #: le repli sans arrêter Ollama, et à tenir une démonstration en ligne.
    forcer_repli: bool = Field(default=False)

    @property
    def distant_configure(self) -> bool:
        return bool(self.distant_url and self.distant_cle)


@lru_cache
def get_reglages_ia() -> ReglagesIA:
    """Instance unique. `cache_clear()` la recharge — c'est ce que fait A-13."""
    return ReglagesIA()
