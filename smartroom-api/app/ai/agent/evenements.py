"""Ce que la boucle émet, et que l'écran U-23 consomme.

Un seul type d'événement traverse toute la chaîne : la boucle le produit, le
service le sérialise, l'endpoint SSE l'envoie, l'écran le rend. Ajouter une
forme d'affichage revient donc à ajouter un membre ici, et rien d'autre.

Les événements sont volontairement plats et sérialisables : ils passent par du
JSON dans un flux SSE, où un objet imbriqué complexe se paierait en octets sur
chaque jeton diffusé.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any


class TypeEvenement(str, enum.Enum):
    #: Le tour commence. Porte le mode retenu — modèle ou repli.
    DEBUT = "debut"
    #: Un morceau de texte, à concaténer à l'affichage.
    TEXTE = "texte"
    #: Un outil démarre ou s'achève. Alimente « Recherche des salles… ».
    OUTIL = "outil"
    #: Une carte riche : salles, réservation, plan, article…
    CARTE = "carte"
    #: Une écriture attend la validation de l'utilisateur.
    CONFIRMATION = "confirmation"
    #: Les sources citées par la réponse.
    SOURCES = "sources"
    #: Réserve d'étayage : la réponse n'est pas entièrement adossée aux données.
    RESERVE = "reserve"
    #: Puces de suggestions.
    SUGGESTIONS = "suggestions"
    #: Fin du tour, avec ses mesures.
    FIN = "fin"
    #: Refus explicite — débit dépassé, message trop long, injection refusée.
    ERREUR = "erreur"


@dataclass(frozen=True, slots=True)
class Evenement:
    type: TypeEvenement
    donnees: dict[str, Any] = field(default_factory=dict)

    def pour_flux(self) -> dict[str, Any]:
        return {"type": self.type.value, **self.donnees}


def texte(morceau: str) -> Evenement:
    return Evenement(type=TypeEvenement.TEXTE, donnees={"texte": morceau})


def outil(nom: str, *, etat: str, libelle: str = "", duree_ms: int | None = None) -> Evenement:
    charge: dict[str, Any] = {"outil": nom, "etat": etat}
    if libelle:
        charge["libelle"] = libelle
    if duree_ms is not None:
        charge["duree_ms"] = duree_ms
    return Evenement(type=TypeEvenement.OUTIL, donnees=charge)


def carte(sorte: str, donnees: Any) -> Evenement:
    return Evenement(type=TypeEvenement.CARTE, donnees={"carte": sorte, "donnees": donnees})


def confirmation(*, jeton: str, message: str, apercu: Any, outil_nom: str) -> Evenement:
    return Evenement(
        type=TypeEvenement.CONFIRMATION,
        donnees={"jeton": jeton, "message": message, "apercu": apercu, "outil": outil_nom},
    )


def erreur(code: str, message: str) -> Evenement:
    return Evenement(type=TypeEvenement.ERREUR, donnees={"code": code, "message": message})


#: Libellés d'activité affichés pendant l'exécution d'un outil. Écrits ici et
#: non déduits du nom : « Recherche des salles disponibles » se lit, pas
#: « rechercher_salles ».
LIBELLES = {
    "rechercher_salles": "Recherche des salles",
    "consulter_disponibilite": "Vérification de la disponibilité",
    "recommander_salle": "Classement des salles éligibles",
    "creer_reservation": "Préparation de la réservation",
    "modifier_reservation": "Préparation de la modification",
    "annuler_reservation": "Préparation de l'annulation",
    "lister_mes_reservations": "Lecture de vos réservations",
    "obtenir_code_acces": "Recherche du code d'accès",
    "localiser_salle": "Localisation de la salle",
    "consulter_regles": "Lecture des règles de réservation",
    "rechercher_faq": "Consultation de la base de connaissances",
    "creer_ticket": "Préparation du ticket",
    "transferer_humain": "Transfert au support",
}
