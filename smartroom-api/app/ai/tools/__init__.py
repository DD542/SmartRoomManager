"""Les treize outils de l'assistant, et leur registre.

Chaque outil est une façade mince sur un service existant. L'identité de
l'utilisateur n'apparaît dans aucun schéma : elle est injectée côté serveur par
`ToolContext`, ce qui rend structurellement impossible qu'une sortie de modèle
agisse au nom d'un tiers.
"""

from app.ai.tools.base import (
    ArgumentsInvalides,
    Carte,
    Domaine,
    Outil,
    Statut,
    ToolContext,
    ToolResult,
)
from app.ai.tools.registre import (
    OUTILS,
    catalogue,
    domaine_de,
    ecritures,
    noms,
    obtenir,
    resume_catalogue,
    verifier_coherence,
)

__all__ = [
    "OUTILS",
    "ArgumentsInvalides",
    "Carte",
    "Domaine",
    "Outil",
    "Statut",
    "ToolContext",
    "ToolResult",
    "catalogue",
    "domaine_de",
    "ecritures",
    "noms",
    "obtenir",
    "resume_catalogue",
    "verifier_coherence",
]
