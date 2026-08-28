"""Traitement du texte non fiable : message utilisateur et documents.

Le vrai garde-fou n'est pas ce filtre, c'est la **structure du prompt** : le
message et les extraits arrivent encadrés par des délimiteurs et annoncés comme
des données à lire, jamais comme des instructions. Le prompt système, lui, est
monté côté serveur et n'est jamais concaténé à du contenu utilisateur.

Ce module ajoute trois choses par-dessus :

  1. il **neutralise les délimiteurs** qu'un message contiendrait — sans quoi
     un utilisateur pourrait fermer le bloc de données et écrire hors de lui ;
  2. il **signale** les tournures d'écrasement de consigne connues, pour le
     journal et le tableau de bord ; c'est un capteur, pas une barrière ;
  3. il **coupe** ce qui dépasse la taille annoncée, avant que le budget de
     contexte n'ait à le faire.

Un filtre par motifs ne peut pas être exhaustif, et prétendre le contraire
serait le pire des deux mondes : une fausse sécurité, et l'illusion qu'on peut
se passer de la structure du prompt.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Délimiteurs réservés au serveur. Un message qui les contient est réécrit.
DELIMITEURS = (
    "<<<MESSAGE_UTILISATEUR>>>",
    "<<<FIN_MESSAGE>>>",
    "<<<EXTRAITS_DOCUMENTAIRES>>>",
    "<<<FIN_EXTRAITS>>>",
    "<<<RESUME>>>",
    "<<<FIN_RESUME>>>",
)

#: Tournures d'écrasement de consigne. La liste est indicative : elle sert à
#: compter et à journaliser, jamais à décider seule d'un refus.
_SOUPCONS = (
    re.compile(r"\bignor\w*\s+(tes|les|toutes?\s+les|vos)\s+(instructions?|consignes?|règles?)", re.I),
    re.compile(r"\boubli\w*\s+(tout|ce qui précède|tes instructions)", re.I),
    re.compile(r"\b(tu es|vous êtes)\s+(maintenant|désormais)\b", re.I),
    re.compile(r"\b(affiche|montre|révèle|donne)[^.]{0,30}\b(prompt|instructions? système|consignes système)", re.I),
    re.compile(r"\bmode\s+(développeur|debug|administrateur|sans restriction)\b", re.I),
    re.compile(r"\bagis\s+(comme|en tant que)\s+(si tu|un autre)", re.I),
    re.compile(r"\b(system|assistant)\s*:\s*", re.I),
    # Les mots peuvent s'empiler : « ignore all previous instructions ». Le
    # motif d'origine exigeait un seul qualificatif et laissait passer la
    # formulation la plus courante — constaté par un test.
    re.compile(r"\bignore\s+(?:all\s+)?(?:previous\s+|above\s+|prior\s+)?(?:instructions?|rules?)", re.I),
    re.compile(r"\b(au nom de|pour le compte de)\s+(un autre|quelqu'un d'autre)", re.I),
)


@dataclass(frozen=True, slots=True)
class Inspection:
    """Le texte assaini, et ce qu'on a observé en le lisant."""

    texte: str
    delimiteurs_neutralises: int = 0
    soupcons: tuple[str, ...] = ()
    tronque: bool = False

    @property
    def suspect(self) -> bool:
        return bool(self.soupcons) or self.delimiteurs_neutralises > 0

    def pour_journal(self) -> dict[str, object]:
        # Le texte n'est pas journalisé ici : c'est la conversation qui le
        # conserve, avec sa rétention et son écran. Le dupliquer dans le
        # journal d'exploitation en ferait une seconde copie que personne ne
        # purge.
        return {
            "injection_suspectee": self.suspect,
            "delimiteurs_neutralises": self.delimiteurs_neutralises,
            "motifs": list(self.soupcons),
            "tronque": self.tronque,
        }


def assainir(texte: str, *, taille_max: int = 2000) -> Inspection:
    """Prépare un texte non fiable pour l'insertion dans le contexte."""
    original = texte or ""
    neutralises = 0
    propre = original

    for marque in DELIMITEURS:
        occurrences = propre.count(marque)
        if occurrences:
            neutralises += occurrences
            # Les chevrons sont remplacés, pas retirés : l'utilisateur doit
            # relire son message tel qu'il l'a écrit, et le modèle doit voir
            # que la séquence n'est plus un délimiteur.
            propre = propre.replace(marque, marque.replace("<", "‹").replace(">", "›"))

    tronque = len(propre) > taille_max
    if tronque:
        propre = propre[:taille_max]

    motifs = tuple(sorted({motif.pattern for motif in _SOUPCONS if motif.search(propre)}))

    return Inspection(
        texte=propre.strip(),
        delimiteurs_neutralises=neutralises,
        soupcons=motifs,
        tronque=tronque,
    )


def encadrer_extrait(titre: str, contenu: str) -> str:
    """Encadre un extrait documentaire, sa source nommée.

    Les documents viennent de la base de connaissances, écrite par des
    administrateurs. Ce n'est pas parce qu'une source est interne qu'elle peut
    donner des ordres au modèle : un article modifié — par erreur ou non —
    reprogrammerait sinon l'assistant pour tous les utilisateurs.
    """
    inspection = assainir(contenu, taille_max=4000)
    return f"[Source : {titre}]\n{inspection.texte}"
