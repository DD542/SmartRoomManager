"""Découpage des articles en fragments vectorisables.

Un vecteur porte le sens de ce qu'on lui donne. Donné un article entier, il en
moyenne tous les paragraphes et ne distingue plus celui qui répond à la
question. Donné trois mots, il ne porte plus assez de contexte pour être
comparé. Entre les deux, un fragment de quelques phrases.

Trois règles, dans cet ordre :

  1. On coupe aux frontières de paragraphe. Un paragraphe traite d'une chose ;
     le couper en deux produit deux fragments dont aucun ne répond.
  2. Un paragraphe trop long est coupé aux phrases, jamais au milieu d'un mot.
  3. Les fragments se recouvrent : la dernière phrase de l'un ouvre le suivant.
     Sans recouvrement, une réponse à cheval sur deux fragments est perdue par
     les deux.

Le titre de l'article est répété en tête de chaque fragment. C'est peu coûteux
et cela change beaucoup : un fragment qui dit « il faut le faire une heure
avant » sans dire de quoi il parle ne sera jamais retrouvé.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from app.ai.jetons import compter_jetons

#: Fin de phrase suivie d'une majuscule, d'un chiffre ou d'un guillemet.
_FIN_DE_PHRASE = re.compile(r"(?<=[.!?…])\s+(?=[«\"A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ0-9])")


@dataclass(frozen=True, slots=True)
class Fragment:
    position: int
    contenu: str

    @property
    def empreinte(self) -> str:
        """Empreinte du contenu, pour ne pas revectoriser ce qui n'a pas changé."""
        return hashlib.md5(self.contenu.encode("utf-8")).hexdigest()  # noqa: S324


def _phrases(texte: str) -> list[str]:
    return [phrase.strip() for phrase in _FIN_DE_PHRASE.split(texte) if phrase.strip()]


def _paragraphes(texte: str) -> list[str]:
    return [bloc.strip() for bloc in re.split(r"\n\s*\n", texte) if bloc.strip()]


def decouper(
    *,
    titre: str,
    corps: str,
    taille: int = 300,
    recouvrement: int = 60,
) -> list[Fragment]:
    """Découpe un article. Rend au moins un fragment dès qu'il y a du texte.

    `taille` et `recouvrement` sont en jetons, comptés par le même outil que le
    budget de contexte : deux unités différentes finiraient par diverger.
    """
    corps = (corps or "").strip()
    if not corps:
        return []

    entete = f"{titre.strip()} —"
    cout_entete = compter_jetons(entete)
    budget = max(60, taille - cout_entete)

    morceaux: list[str] = []
    for paragraphe in _paragraphes(corps):
        if compter_jetons(paragraphe) <= budget:
            morceaux.append(paragraphe)
            continue

        # Paragraphe trop long : on le remplit phrase à phrase.
        courant: list[str] = []
        for phrase in _phrases(paragraphe) or [paragraphe]:
            candidat = " ".join([*courant, phrase])
            if courant and compter_jetons(candidat) > budget:
                morceaux.append(" ".join(courant))
                courant = [phrase]
            else:
                courant.append(phrase)
        if courant:
            morceaux.append(" ".join(courant))

    # Regroupement : deux paragraphes courts tiennent ensemble et donnent un
    # fragment plus riche qu'un paragraphe isolé de dix mots.
    groupes: list[str] = []
    tampon: list[str] = []
    for morceau in morceaux:
        candidat = "\n\n".join([*tampon, morceau])
        if tampon and compter_jetons(candidat) > budget:
            groupes.append("\n\n".join(tampon))
            tampon = [morceau]
        else:
            tampon.append(morceau)
    if tampon:
        groupes.append("\n\n".join(tampon))

    fragments: list[Fragment] = []
    for index, groupe in enumerate(groupes):
        contenu = groupe
        if index > 0 and recouvrement > 0:
            queue = _queue(groupes[index - 1], recouvrement)
            if queue:
                contenu = f"{queue}\n\n{groupe}"
        fragments.append(Fragment(position=index, contenu=f"{entete} {contenu}"))

    return fragments


def _queue(texte: str, budget: int) -> str:
    """Dernières phrases d'un fragment, dans la limite du budget de recouvrement."""
    retenues: list[str] = []
    for phrase in reversed(_phrases(texte)):
        candidat = " ".join([phrase, *retenues])
        if compter_jetons(candidat) > budget:
            break
        retenues.insert(0, phrase)
    return " ".join(retenues)
