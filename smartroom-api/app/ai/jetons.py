"""Comptage des jetons, sans dépendance à quoi que ce soit d'autre.

Placé à la racine de la couche et non dans `agent/` : le budget de contexte
s'en sert, le découpage du RAG aussi. Tant qu'il vivait avec la boucle, importer
le découpeur tirait l'agent, qui tirait les garde-fous, qui tiraient les outils
— lesquels tiraient le découpeur. Un cycle, pour une fonction de trois lignes.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("app.ai.jetons")

_encodeur: Any | None = None
_encodeur_charge = False


def compter_jetons(texte: str) -> int:
    """Compte les jetons d'un texte.

    `tiktoken` n'est pas le tokeniseur de Qwen : il surestime de 5 à 10 % sur
    du français. L'écart va dans le bon sens — le budget réel est un peu plus
    large que le budget calculé — et éviterait de toute façon d'ajouter une
    dépendance par famille de modèles.

    S'il est absent ou si son fichier d'encodage n'est pas téléchargeable — cas
    d'un hébergement sans accès sortant — une estimation par caractères prend
    le relais. Compter approximativement vaut mieux que refuser de démarrer.
    """
    global _encodeur, _encodeur_charge

    if not _encodeur_charge:
        _encodeur_charge = True
        try:
            import tiktoken

            _encodeur = tiktoken.get_encoding("cl100k_base")
        except Exception as souci:  # pragma: no cover - dépend du réseau
            logger.info(
                "tiktoken indisponible, estimation par caractères",
                extra={"detail": str(souci)},
            )
            _encodeur = None

    if _encodeur is not None:
        return len(_encodeur.encode(texte))
    # 3,6 caractères par jeton : moyenne mesurée sur du français courant.
    return max(1, round(len(texte) / 3.6))
