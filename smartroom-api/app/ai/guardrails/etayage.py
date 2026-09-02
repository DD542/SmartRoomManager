"""Détection des affirmations non étayées.

Un modèle qui ne sait pas produit une phrase plausible plutôt qu'un aveu. Sur
un assistant de réservation, cela donne des horaires inventés et des règles qui
n'existent pas — le genre d'erreur qu'un utilisateur ne peut pas détecter, et
qui coûte plus cher qu'une absence de réponse.

Le contrôle porte sur ce qui est **vérifiable mécaniquement** : les nombres,
les heures, les durées, les noms de salles et de bâtiments. Chacun doit se
retrouver dans ce que les outils ont rendu ou dans les extraits documentaires.
Le reste — une tournure vague, une nuance — échappe à ce contrôle, et le
document d'architecture le dit.

Deux cas se distinguent, et ils n'ont pas la même gravité :

  * **aucune preuve du tout** : le modèle a répondu sans appeler d'outil ni
    consulter d'article, alors que sa réponse contient des faits. C'est le cas
    franc, et le seul où l'on retire la réponse ;
  * **preuves partielles** : un nombre isolé ne se retrouve pas. La réponse est
    conservée, assortie d'une réserve visible à l'écran. Réécrire un texte
    diffusé jeton par jeton produirait un clignotement, et retirer une réponse
    juste à 90 % pour un chiffre arrondi serait pire que la laisser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Nombres, heures, durées, pourcentages.
_CHIFFRES = re.compile(
    r"\b\d{1,4}(?:[.,]\d{1,2})?\s*(?:h(?:\d{2})?|%|min|minutes?|heures?|jours?)?\b",
    re.I,
)

#: Adresses. Constaté en éprouvant la boucle : interrogé sur la localisation
#: d'une salle, le modèle a rendu l'adresse du plan enveloppée dans une image
#: Markdown, en lui inventant un hôte — `http://example.com/media/...`. Ni les
#: nombres ni les noms propres ne l'auraient vu.
_ADRESSES = re.compile(r"(?:https?://\S+|/media/\S+)")

#: Noms propres du parc : « Salle Curie », « Eiffel 3 », « Labo Pasteur ».
_ENTITES = re.compile(
    r"\b(?:Salle|Labo|Atelier|Amphi|Bâtiment|Eiffel)\s+[A-ZÀÂÉÈÊÎÔÙÜÇ][\wÀ-ÿ'-]*(?:\s+\d+)?",
)

#: Formules par lesquelles l'assistant reconnaît qu'il ne sait pas. Une réponse
#: qui en contient une n'a pas à être étayée : elle n'affirme rien.
_AVEUX = (
    "je n'ai pas trouvé",
    "je ne trouve pas",
    "je n'ai pas cette information",
    "je ne sais pas",
    "aucun article",
    "aucune salle",
    "je ne peux pas",
)


@dataclass(frozen=True, slots=True)
class Verdict:
    etaye: bool
    #: Faits présents dans la réponse et absents des preuves.
    orphelins: tuple[str, ...] = ()
    #: Vrai quand la réponse affirme des faits sans qu'aucune preuve n'existe.
    sans_preuve: bool = False

    @property
    def reserve(self) -> str | None:
        """Texte de la réserve à afficher, ou `None` s'il n'y en a pas."""
        if self.etaye:
            return None
        if self.sans_preuve:
            return (
                "Cette réponse n'est adossée à aucune donnée de l'application. "
                "Je préfère ne pas l'affirmer : reformulez, ou ouvrez un ticket."
            )
        details = ", ".join(self.orphelins[:4])
        return (
            f"Une partie de cette réponse n'est pas confirmée par les données "
            f"consultées ({details}). Vérifiez avant de vous y fier."
        )

    def pour_journal(self) -> dict[str, object]:
        return {
            "etaye": self.etaye,
            "sans_preuve": self.sans_preuve,
            "orphelins": list(self.orphelins),
        }


def _normaliser(texte: str) -> str:
    """Compare sans se laisser arrêter par la casse ni les espaces fins."""
    return re.sub(r"\s+", " ", texte).lower().replace(" ", " ").replace("\xa0", " ")


def verifier(reponse: str, preuves: str, *, outils_appeles: int = 0) -> Verdict:
    """Confronte une réponse à ce qui la soutient.

    `preuves` est la concaténation des résultats d'outils et des extraits
    documentaires du tour. `outils_appeles` distingue « rien n'a été consulté »
    de « tout a été consulté et ne dit rien ».
    """
    texte = _normaliser(reponse)
    fond = _normaliser(preuves)

    if any(aveu in texte for aveu in _AVEUX):
        return Verdict(etaye=True)

    faits: list[str] = []

    for trouve in _CHIFFRES.findall(reponse):
        fait = trouve.strip()
        # Les nombres d'un seul chiffre sans unité — « une », « deux salles » —
        # sont trop courants pour être des faits vérifiables.
        if len(fait) <= 1:
            continue
        faits.append(fait)

    faits.extend(match.strip() for match in _ENTITES.findall(reponse))
    faits.extend(match.rstrip(").,;\"'") for match in _ADRESSES.findall(reponse))

    if not faits:
        # Aucune affirmation vérifiable : rien à étayer. C'est le cas des
        # réponses de conversation — « d'accord », « je vous écoute ».
        return Verdict(etaye=True)

    if not fond.strip() and outils_appeles == 0:
        return Verdict(
            etaye=False, sans_preuve=True, orphelins=tuple(dict.fromkeys(faits))[:6]
        )

    orphelins = []
    for fait in dict.fromkeys(faits):
        aiguille = _normaliser(fait)
        # Le nombre est cherché tel quel, puis sans son unité : « 15 min » est
        # étayé par « 15 minutes », et l'inverse.
        nu = re.sub(r"[^\d.,]", "", aiguille)
        if aiguille in fond:
            continue
        if nu and nu in fond:
            continue
        orphelins.append(fait)

    return Verdict(etaye=not orphelins, orphelins=tuple(orphelins)[:6])
