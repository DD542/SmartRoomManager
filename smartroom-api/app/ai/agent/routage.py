"""Routage : quel domaine d'outils exposer pour ce message.

Treize schémas coûtent environ 1 400 jetons d'invite à chaque tour, payés avant
le premier jeton produit. Surtout, un catalogue large donne au modèle treize
occasions de choisir l'outil qui n'était pas le bon.

Le routage est fait par le petit modèle, en un appel de quelques dizaines de
jetons — plus rapide que ce qu'il fait gagner. Il échoue vers le large : en cas
de doute, tous les domaines sont exposés. Un routage trop sûr de lui priverait
l'agent de l'outil dont il a besoin, ce qui est bien pire qu'un contexte un peu
plus long.

Un premier passage lexical évite l'appel dans les cas évidents — « annuler ma
réservation » n'a pas besoin d'un modèle pour être classé.
"""

from __future__ import annotations

import logging

from app.ai.providers.base import (
    ErreurFournisseur,
    Message,
    RoleMessage,
    RoleModele,
    agreger,
)
from app.ai.providers.selection import SelecteurModeles
from app.ai.reglages import get_reglages_ia
from app.ai.tools.base import Domaine

logger = logging.getLogger("app.ai.routage")

_INDICES = {
    Domaine.RESERVATION: (
        "reserv",
        "annul",
        "modifi",
        "decal",
        "creneau",
        "libre",
        "disponib",
        "code d'acc",
        "code acc",
        "mes reunions",
        "planning",
        "quota",
        "regle",
    ),
    Domaine.PARC: (
        "salle",
        "batiment",
        "eiffel",
        "etage",
        "plan",
        "ou est",
        "equipement",
        "capacit",
    ),
    Domaine.ASSISTANCE: (
        "comment",
        "aide",
        "probleme",
        "panne",
        "ticket",
        "support",
        "humain",
        "ne marche pas",
        "ne fonctionne pas",
        "cass",
    ),
}

_INVITE = (
    "Classe la demande de l'utilisateur dans un ou plusieurs domaines.\n"
    "Domaines : reservation (réserver, modifier, annuler, disponibilité, règles), "
    "parc (salles, bâtiments, étages, plans, équipements), "
    "assistance (procédures, pannes, support).\n"
    "Réponds uniquement par les noms séparés d'une virgule, sans phrase."
)


def sans_accent(valeur: str) -> str:
    """Les indices sont écrits sans accent ; le message, lui, en porte.

    Constaté par un test : « quelles sont les règles » ne rapprochait rien du
    domaine « reservation », dont l'indice est « regle ». Le routage exposait
    alors un catalogue amputé, et le modèle n'avait plus l'outil qu'il lui
    fallait — sans que rien ne le signale.
    """
    try:
        from unidecode import unidecode

        return unidecode(valeur).lower()
    except ImportError:  # pragma: no cover - dépend de l'installation
        table = str.maketrans("àâäéèêëîïôöùûüç", "aaaeeeeiioouuuc")
        return valeur.lower().translate(table)


def _lexical(message: str) -> set[Domaine]:
    texte = sans_accent(message)
    return {
        domaine
        for domaine, indices in _INDICES.items()
        if any(indice in texte for indice in indices)
    }


async def router_domaines(
    message: str, selecteur: SelecteurModeles
) -> list[Domaine] | None:
    """Rend les domaines à exposer, ou `None` pour le catalogue entier."""
    trouves = _lexical(message)
    if len(trouves) == 1:
        return list(trouves)

    reglages = get_reglages_ia()
    try:
        fournisseur, modele = await selecteur.pour(RoleModele.RAPIDE)
        reponse = await agreger(
            fournisseur.discuter(
                [
                    Message(role=RoleMessage.SYSTEME, contenu=_INVITE),
                    Message(role=RoleMessage.UTILISATEUR, contenu=message[:400]),
                ],
                modele=modele,
                temperature=reglages.temperature_routage,
                max_jetons=reglages.max_jetons_routage,
            )
        )
    except ErreurFournisseur as souci:
        # Le routage n'est qu'une optimisation : son échec ne doit pas coûter
        # le tour. Tout est exposé, et l'agent continue.
        logger.info("Routage indisponible", extra={"detail": souci.code})
        return list(trouves) or None

    dits = {domaine for domaine in Domaine if domaine.value in reponse.texte.lower()}
    domaines = dits or trouves
    return list(domaines) or None
