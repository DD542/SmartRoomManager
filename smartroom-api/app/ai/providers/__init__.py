"""Fournisseurs d'inférence et contrat commun."""

from app.ai.providers.base import (
    AppelOutil,
    DelaiDepasse,
    ErreurFournisseur,
    Fragment,
    FournisseurIndisponible,
    LLMProvider,
    Mesures,
    Message,
    Reponse,
    RoleMessage,
    RoleModele,
    SortieInexploitable,
    TypeFragment,
    agreger,
)
from app.ai.providers.distant import ClientDistant
from app.ai.providers.ollama import ClientOllama
from app.ai.providers.selection import SelecteurModeles
from app.ai.providers.simule import FournisseurSimule, TourSimule

__all__ = [
    "AppelOutil",
    "ClientDistant",
    "ClientOllama",
    "DelaiDepasse",
    "ErreurFournisseur",
    "FournisseurIndisponible",
    "FournisseurSimule",
    "Fragment",
    "LLMProvider",
    "Mesures",
    "Message",
    "Reponse",
    "RoleMessage",
    "RoleModele",
    "SelecteurModeles",
    "SortieInexploitable",
    "TourSimule",
    "TypeFragment",
    "agreger",
]
