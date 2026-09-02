"""Catalogue des outils : ce que le modèle voit, et comment on l'exécute.

Le registre est la seule porte d'entrée. La boucle d'agent ne construit jamais
un outil elle-même : elle demande un nom, et reçoit soit l'outil, soit rien.
Un nom inventé par le modèle ne peut donc pas devenir un appel.

Le catalogue exposé est **réduit par domaine**. Treize schémas coûtent environ
1 400 jetons d'invite à chaque tour ; n'en exposer que trois ou quatre allège
l'invite et, surtout, retire au modèle l'occasion de choisir un outil hors
sujet.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from app.ai.tools.assistance import CreerTicket, RechercherFaq, TransfererHumain
from app.ai.tools.base import Domaine, Outil
from app.ai.tools.parc import (
    ConsulterDisponibilite,
    ConsulterRegles,
    LocaliserSalle,
    RechercherSalles,
    RecommanderSalle,
)
from app.ai.tools.reservations import (
    AnnulerReservation,
    CreerReservation,
    ListerMesReservations,
    ModifierReservation,
    ObtenirCodeAcces,
)

#: Ordre stable : il détermine celui du catalogue envoyé au modèle, et un
#: catalogue qui change d'ordre d'un tour à l'autre change aussi ses réponses.
OUTILS: tuple[Outil, ...] = (
    RechercherSalles(),
    ConsulterDisponibilite(),
    RecommanderSalle(),
    CreerReservation(),
    ModifierReservation(),
    AnnulerReservation(),
    ListerMesReservations(),
    ObtenirCodeAcces(),
    LocaliserSalle(),
    ConsulterRegles(),
    RechercherFaq(),
    CreerTicket(),
    TransfererHumain(),
)

_PAR_NOM: dict[str, Outil] = {outil.nom: outil for outil in OUTILS}

#: Toujours exposés, quel que soit le domaine détecté.
#:
#: `transferer_humain` et `creer_ticket` parce qu'on peut demander un humain ou
#: signaler une panne à tout moment. `rechercher_faq` parce qu'une question de
#: procédure arrive souvent habillée en question de réservation : « jusqu'à
#: quand puis-je annuler ? » est classée « reservation » par le routage, et
#: sans cet outil le modèle répondait « je n'ai pas trouvé cette information »
#: alors que l'article existait. Constaté en éprouvant la boucle contre le
#: modèle réel.
UNIVERSELS = ("transferer_humain", "creer_ticket", "rechercher_faq")


def obtenir(nom: str) -> Outil | None:
    """Outil portant ce nom exact, ou `None`. Aucune approximation ici."""
    return _PAR_NOM.get(nom)


def noms() -> tuple[str, ...]:
    return tuple(_PAR_NOM)


def catalogue(domaines: Iterable[Domaine] | None = None) -> list[dict[str, Any]]:
    """Schémas nus, dans l'ordre du registre.

    Nus, c'est-à-dire sans l'enveloppe `{"type": "function", …}` : chaque
    fournisseur l'ajoute lui-même. Un schéma envoyé sans elle est ignoré par
    Ollama **sans erreur**, et la réponse revient en texte comme si aucun outil
    n'existait — défaut constaté au lot 1.
    """
    if domaines is None:
        return [outil.SCHEMA for outil in OUTILS]

    retenus = set(domaines)
    return [
        outil.SCHEMA
        for outil in OUTILS
        if outil.DOMAINE in retenus or outil.nom in UNIVERSELS
    ]


def ecritures() -> frozenset[str]:
    """Noms des outils qui modifient des données. Utilisé par les garde-fous."""
    return frozenset(outil.nom for outil in OUTILS if outil.ECRITURE)


def domaine_de(nom: str) -> Domaine | None:
    outil = obtenir(nom)
    return outil.DOMAINE if outil else None


def resume_catalogue() -> list[dict[str, Any]]:
    """Vue courte du catalogue, pour l'administration et la documentation."""
    return [
        {
            "nom": outil.nom,
            "domaine": outil.DOMAINE.value,
            "ecriture": outil.ECRITURE,
            "arguments_requis": outil.SCHEMA["parameters"].get("required", []),
        }
        for outil in OUTILS
    ]


def verifier_coherence() -> Sequence[str]:
    """Contrôles de forme du catalogue, appelés au démarrage et par les tests.

    Trois écarts se glissent facilement et ne se voient qu'à l'usage : un nom
    dupliqué qui masque un outil, un champ d'identité laissé dans un schéma —
    qui permettrait à une sortie de modèle d'agir au nom d'un tiers — et un
    schéma dont le nom ne correspond pas à celui de la classe qui l'exécute.
    """
    anomalies: list[str] = []
    vus: set[str] = set()

    interdits = {
        "utilisateur_id",
        "user_id",
        "owner_id",
        "email",
        "proprietaire",
        "principal",
    }

    for outil in OUTILS:
        nom = outil.SCHEMA.get("name", "")
        if not nom:
            anomalies.append(f"{type(outil).__name__} : schéma sans nom.")
        if nom in vus:
            anomalies.append(f"{nom} : nom dupliqué dans le registre.")
        vus.add(nom)

        proprietes = outil.SCHEMA.get("parameters", {}).get("properties", {})
        for champ in proprietes:
            if champ in interdits:
                anomalies.append(
                    f"{nom} : le champ « {champ} » ne doit pas être exposé au modèle."
                )

        for requis in outil.SCHEMA.get("parameters", {}).get("required", []):
            if requis not in proprietes:
                anomalies.append(
                    f"{nom} : « {requis} » est requis mais absent des propriétés."
                )

    return anomalies
