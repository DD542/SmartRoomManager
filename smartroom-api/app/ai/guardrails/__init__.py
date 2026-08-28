"""Garde-fous : ce qui sépare une démonstration d'un système utilisable.

    injection.py   le texte non fiable reste une donnée
    etayage.py     une affirmation sans preuve est annoncée comme telle
    repli.py       le moteur déterministe, mode par défaut et filet
    anonymisation  ce qui part vers un fournisseur distant, s'il est activé

La validation des arguments, elle, vit avec les outils : c'est leur schéma qui
la porte, et la séparer de lui les ferait diverger.
"""

from app.ai.guardrails.anonymisation import Anonymiseur, anonymiser
from app.ai.guardrails.etayage import Verdict, verifier
from app.ai.guardrails.injection import Inspection, assainir, encadrer_extrait
from app.ai.guardrails.repli import MoteurDeterministe, ReponseRepli

__all__ = [
    "Anonymiseur",
    "Inspection",
    "MoteurDeterministe",
    "ReponseRepli",
    "Verdict",
    "anonymiser",
    "assainir",
    "encadrer_extrait",
    "verifier",
]
