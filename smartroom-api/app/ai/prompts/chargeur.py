"""Lecture des prompts système versionnés.

Les prompts vivent dans des fichiers Markdown à côté de ce module, et non dans
des chaînes Python : ils sont relus par des humains, comparés d'une version à
l'autre dans les revues, et l'écran A-13 les modifiera à chaud au lot 5.

Chaque fichier porte un en-tête YAML minimal — version, rôle, modèle visé,
budget. Il est analysé sans dépendance : trois champs plats ne justifient pas
d'ajouter un analyseur YAML au projet.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

DOSSIER = Path(__file__).parent


@dataclass(frozen=True, slots=True)
class Prompt:
    version: int
    role: str
    modele_cible: str
    budget_jetons: int
    corps: str

    def avec_contexte(self, *, maintenant: datetime, fuseau: str) -> str:
        """Ajoute l'ancrage temporel du tour.

        La date est donnée par le serveur à chaque tour : sans elle, « demain »
        n'a pas de sens pour un modèle dont les poids sont figés, et il
        inventerait une date plausible.
        """
        horodatage = maintenant.astimezone(UTC).isoformat(timespec="seconds")
        return (
            f"{self.corps}\n\n"
            "## Ancrage du tour\n"
            f"- Date et heure courantes, UTC : {horodatage}\n"
            f"- Fuseau de l'établissement : {fuseau}\n"
        )


def _analyser(texte: str) -> tuple[dict[str, str], str]:
    if not texte.startswith("---"):
        return {}, texte

    _, entete, corps = texte.split("---", 2)
    champs: dict[str, str] = {}
    for ligne in entete.strip().splitlines():
        if ":" in ligne:
            cle, valeur = ligne.split(":", 1)
            champs[cle.strip()] = valeur.strip()
    return champs, corps.strip()


@lru_cache
def charger(version: int = 1, *, role: str = "systeme") -> Prompt:
    """Charge un prompt versionné. `charger.cache_clear()` le relit du disque."""
    chemin = DOSSIER / f"{role}_v{version}.md"
    if not chemin.exists():
        raise FileNotFoundError(f"Prompt introuvable : {chemin.name}")

    champs, corps = _analyser(chemin.read_text(encoding="utf-8"))
    return Prompt(
        version=int(champs.get("version", version)),
        role=champs.get("role", role),
        modele_cible=champs.get("modele_cible", ""),
        budget_jetons=int(champs.get("budget_jetons", 0)),
        corps=corps,
    )


def versions_disponibles(role: str = "systeme") -> list[int]:
    """Versions présentes sur le disque, croissantes. Alimente A-13."""
    versions: list[int] = []
    for chemin in DOSSIER.glob(f"{role}_v*.md"):
        try:
            versions.append(int(chemin.stem.rsplit("_v", 1)[1]))
        except (IndexError, ValueError):
            continue
    return sorted(versions)
