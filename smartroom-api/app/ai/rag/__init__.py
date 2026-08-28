"""Base de connaissances vectorisée : découpage, vecteurs, index, recherche."""

from app.ai.rag.decoupage import Fragment, decouper
from app.ai.rag.indexation import (
    Rapport,
    desindexer_article,
    etat_index,
    indexer_article,
    rattraper,
    reindexer_tout,
)
from app.ai.rag.recherche import Extrait, rechercher
from app.ai.rag.vecteurs import CACHE, CacheVecteurs, Vectoriseur, vectoriseur_partage

__all__ = [
    "CACHE",
    "CacheVecteurs",
    "Extrait",
    "Fragment",
    "Rapport",
    "Vectoriseur",
    "decouper",
    "desindexer_article",
    "etat_index",
    "indexer_article",
    "rattraper",
    "rechercher",
    "vectoriseur_partage",
    "reindexer_tout",
]
