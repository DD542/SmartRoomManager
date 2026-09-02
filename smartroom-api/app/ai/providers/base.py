"""Contrat commun à tous les fournisseurs d'inférence.

Le reste de la couche IA ne connaît que ce module : ni Ollama, ni un
fournisseur distant, ni le simulateur des tests n'apparaissent ailleurs. C'est
ce qui permet de changer de modèle, de machine ou d'hébergeur sans toucher à la
boucle d'agent, aux outils ni aux garde-fous.

Le flux est le même partout : une suite de `Fragment`. Un fragment porte du
texte, une liste d'appels d'outils, ou la fin du tour avec ses mesures. Un
appelant qui ne veut pas diffuser jeton par jeton passe par `agreger`.
"""

from __future__ import annotations

import enum
import json
import uuid
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.core.errors import DomainError


# --------------------------------------------------------------------------- #
# Erreurs
# --------------------------------------------------------------------------- #


class ErreurFournisseur(DomainError):
    """Panne d'inférence. Toujours rattrapable par le repli déterministe."""

    code = "ia_fournisseur"
    http_status = 503


class FournisseurIndisponible(ErreurFournisseur):
    """Aucun fournisseur joignable, ou repli forcé par configuration."""

    code = "ia_indisponible"


class DelaiDepasse(ErreurFournisseur):
    """Premier jeton ou génération complète au-delà du budget."""

    code = "ia_delai"


class SortieInexploitable(ErreurFournisseur):
    """Le modèle a rendu autre chose que du texte ou un appel d'outil lisible."""

    code = "ia_sortie_invalide"


# --------------------------------------------------------------------------- #
# Rôles
# --------------------------------------------------------------------------- #


class RoleModele(str, enum.Enum):
    """À quoi sert le modèle, et non lequel : le choix appartient au sélecteur."""

    RAPIDE = "rapide"
    RAISONNEMENT = "raisonnement"
    VECTEURS = "vecteurs"


class RoleMessage(str, enum.Enum):
    """Valeurs telles que les attendent Ollama et les API compatibles OpenAI."""

    SYSTEME = "system"
    UTILISATEUR = "user"
    ASSISTANT = "assistant"
    OUTIL = "tool"


# --------------------------------------------------------------------------- #
# Structures d'échange
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class AppelOutil:
    """Demande d'appel émise par le modèle.

    `identifiant` est fabriqué ici quand le fournisseur n'en donne pas : la
    boucle d'agent apparie les résultats aux demandes par cet identifiant, et
    deux appels du même outil dans un tour seraient sinon indistinguables.
    """

    nom: str
    arguments: dict[str, Any]
    identifiant: str = field(default_factory=lambda: uuid.uuid4().hex[:12])

    def signature(self) -> str:
        """Empreinte stable, pour détecter un appel répété à l'identique."""
        return f"{self.nom}:{json.dumps(self.arguments, sort_keys=True, ensure_ascii=False)}"


@dataclass(frozen=True, slots=True)
class Message:
    """Un tour de conversation, dans la forme attendue par les fournisseurs."""

    role: RoleMessage
    contenu: str = ""
    appels: tuple[AppelOutil, ...] = ()
    #: Nom de l'outil dont ce message porte le résultat (role == OUTIL).
    outil_nom: str | None = None
    outil_id: str | None = None

    def pour_api(self) -> dict[str, Any]:
        charge: dict[str, Any] = {"role": self.role.value, "content": self.contenu}
        if self.appels:
            charge["tool_calls"] = [
                {
                    "id": appel.identifiant,
                    "type": "function",
                    "function": {"name": appel.nom, "arguments": appel.arguments},
                }
                for appel in self.appels
            ]
        if self.role is RoleMessage.OUTIL:
            charge["name"] = self.outil_nom or ""
            if self.outil_id:
                charge["tool_call_id"] = self.outil_id
        return charge


@dataclass(frozen=True, slots=True)
class Mesures:
    """Ce qu'a coûté un appel. Alimente le journal et le tableau de bord A-13.

    Aucune donnée métier ici : ces valeurs sont journalisées telles quelles, et
    un contenu de conversation dans un journal d'exploitation serait une fuite.
    """

    fournisseur: str
    modele: str
    premier_jeton_ms: int | None = None
    total_ms: int = 0
    chargement_ms: int = 0
    jetons_invite: int = 0
    jetons_reponse: int = 0
    arret: str = "fin"

    def pour_journal(self) -> dict[str, Any]:
        return {
            "fournisseur": self.fournisseur,
            "modele": self.modele,
            "premier_jeton_ms": self.premier_jeton_ms,
            "total_ms": self.total_ms,
            "chargement_ms": self.chargement_ms,
            "jetons_invite": self.jetons_invite,
            "jetons_reponse": self.jetons_reponse,
            "arret": self.arret,
        }


class TypeFragment(str, enum.Enum):
    TEXTE = "texte"
    OUTILS = "outils"
    FIN = "fin"


@dataclass(frozen=True, slots=True)
class Fragment:
    type: TypeFragment
    texte: str = ""
    appels: tuple[AppelOutil, ...] = ()
    mesures: Mesures | None = None


@dataclass(frozen=True, slots=True)
class Reponse:
    """Vue complète d'un tour, pour les appelants qui ne diffusent pas."""

    texte: str
    appels: tuple[AppelOutil, ...]
    mesures: Mesures


# --------------------------------------------------------------------------- #
# Interface
# --------------------------------------------------------------------------- #


class LLMProvider(ABC):
    """Fournisseur d'inférence.

    Trois capacités, pas une de plus : discuter en flux, vectoriser, et dire si
    l'on est joignable. Tout ce qui relève du métier — outils, mémoire,
    garde-fous — vit ailleurs et reste identique quel que soit le fournisseur.
    """

    #: Nom court, repris dans les journaux et le tableau de bord.
    nom: str = "abstrait"

    @abstractmethod
    def discuter(
        self,
        messages: Sequence[Message],
        *,
        modele: str,
        outils: Sequence[dict[str, Any]] | None = None,
        temperature: float = 0.2,
        max_jetons: int = 800,
        format_json: bool = False,
    ) -> AsyncIterator[Fragment]:
        """Diffuse la réponse du modèle, fragment par fragment.

        Lève `DelaiDepasse` si le premier jeton tarde au-delà du budget, plutôt
        que de laisser un appelant attendre : c'est ce délai qui déclenche le
        repli, et il doit être franc.
        """

    @abstractmethod
    async def vectoriser(
        self, textes: Sequence[str], *, modele: str
    ) -> list[list[float]]:
        """Rend un vecteur par texte, dans l'ordre reçu."""

    @abstractmethod
    async def disponible(self) -> bool:
        """Test de vie court. Ne lève pas : un fournisseur absent rend `False`."""

    async def fermer(self) -> None:
        """Libère les ressources réseau. Sans effet par défaut."""


# --------------------------------------------------------------------------- #
# Utilitaire
# --------------------------------------------------------------------------- #


async def agreger(flux: AsyncIterator[Fragment]) -> Reponse:
    """Consomme un flux entier et en rend la vue complète.

    Utilisé par le routage et le résumé, qui n'ont rien à diffuser : leur
    sortie n'est jamais montrée à l'utilisateur.
    """
    morceaux: list[str] = []
    appels: list[AppelOutil] = []
    mesures: Mesures | None = None

    async for fragment in flux:
        if fragment.type is TypeFragment.TEXTE:
            morceaux.append(fragment.texte)
        elif fragment.type is TypeFragment.OUTILS:
            appels.extend(fragment.appels)
        elif fragment.type is TypeFragment.FIN:
            mesures = fragment.mesures

    if mesures is None:
        raise SortieInexploitable("Le fournisseur n'a pas clos son flux.")

    return Reponse(texte="".join(morceaux), appels=tuple(appels), mesures=mesures)
