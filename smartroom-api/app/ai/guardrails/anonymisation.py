"""Anonymisation avant envoi à un fournisseur distant.

Le fournisseur distant n'existe que pour la démonstration en ligne, faute de
GPU chez l'hébergeur. Il reste désactivé par défaut, et refuse d'émettre tant
que cette fonction n'est pas branchée — un oubli de configuration ne doit pas
se traduire par l'envoi de noms et d'adresses à un tiers.

Ce qui part est remplacé par des jetons stables *le temps de la conversation* :
`PERSONNE_1`, `COURRIEL_2`. Stables, parce qu'un modèle doit pouvoir suivre que
la personne du deuxième tour est celle du premier. Le temps d'une conversation
seulement, parce qu'un jeton réutilisé d'une session à l'autre redeviendrait un
identifiant.

La table de correspondance ne quitte jamais le serveur. Les réponses sont
retraduites à l'affichage.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.ai.providers.base import Message

_COURRIEL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
#: Prénom Nom, deux capitales successives.
#:
#: L'exclusion porte sur le **premier** mot, par anticipation. Écrite en
#: rétrospection — `(?<!Salle )` — elle ne servait à rien : la correspondance
#: commence sur « Salle », et ce qui la précède est « la ». « Salle Curie »
#: partait donc masqué en `PERSONNE_1`, ce qui rendait les réponses
#: incompréhensibles. Constaté par un test.
_PERSONNE = re.compile(
    r"\b(?!(?:Salle|Labo|Amphi|Atelier|Bâtiment|Batiment|Eiffel)\b)"
    r"[A-ZÀ-Þ][a-zà-ÿ]+\s+[A-ZÀ-Þ][a-zà-ÿ]{2,}\b"
)
_TELEPHONE = re.compile(r"\b0[1-9](?:[ .-]?\d{2}){4}\b")


@dataclass
class Anonymiseur:
    """Substitution réversible, portée par une conversation."""

    _vers_jeton: dict[str, str] = field(default_factory=dict)
    _vers_clair: dict[str, str] = field(default_factory=dict)

    def _jeton(self, valeur: str, prefixe: str) -> str:
        if valeur in self._vers_jeton:
            return self._vers_jeton[valeur]
        jeton = f"{prefixe}_{sum(1 for cle in self._vers_jeton.values() if cle.startswith(prefixe)) + 1}"
        self._vers_jeton[valeur] = jeton
        self._vers_clair[jeton] = valeur
        return jeton

    def masquer(self, texte: str) -> str:
        propre = _COURRIEL.sub(lambda trouve: self._jeton(trouve.group(0), "COURRIEL"), texte)
        propre = _TELEPHONE.sub(lambda trouve: self._jeton(trouve.group(0), "TELEPHONE"), propre)
        return _PERSONNE.sub(lambda trouve: self._jeton(trouve.group(0), "PERSONNE"), propre)

    def restituer(self, texte: str) -> str:
        for jeton, clair in self._vers_clair.items():
            texte = texte.replace(jeton, clair)
        return texte

    def __call__(self, messages: Sequence[Message]) -> list[Message]:
        return [
            Message(
                role=message.role,
                contenu=self.masquer(message.contenu),
                appels=message.appels,
                outil_nom=message.outil_nom,
                outil_id=message.outil_id,
            )
            for message in messages
        ]

    @property
    def substitutions(self) -> int:
        return len(self._vers_jeton)


def anonymiser(messages: Sequence[Message]) -> list[Message]:
    """Anonymisation sans mémoire, pour un appel isolé."""
    return Anonymiseur()(messages)
