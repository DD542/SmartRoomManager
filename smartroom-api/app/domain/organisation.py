"""Appartenance d'une adresse à l'établissement.

Une seule fonction, et une seule raison d'exister : deux schémas exposent les
comptes — `UserRead` pour l'authentification, `UserOut` pour l'annuaire — et la
règle a d'abord été écrite dans un seul des deux. L'écran de connexion
recevait donc la réponse, l'écran d'administration ne la recevait pas, et
l'étiquette « Hors organisation » ne s'affichait nulle part.

Le défaut n'a produit aucune erreur : un champ absent d'une réponse JSON est
simplement absent, et le front lisait `undefined`. Rien ne signale ce genre de
divergence, sinon un écran vide qu'on finit par remarquer.

La règle vit donc ici, et les deux schémas l'appellent.
"""

from __future__ import annotations

from app.core.config import get_settings


def domaines_de_l_organisation() -> set[str]:
    """Domaines de l'établissement, en minuscules."""
    return {
        part.strip().lower()
        for part in get_settings().organisation_domains.split(",")
        if part.strip()
    }


def est_externe(email: str | None) -> bool:
    """L'adresse relève-t-elle d'un domaine hors de l'établissement ?

    Sans liste configurée, personne n'est externe : mieux vaut ne rien
    signaler que signaler tout le monde. Une étiquette portée par chaque ligne
    ne distingue plus rien.
    """
    domaines = domaines_de_l_organisation()
    if not domaines or not email:
        return False
    return email.split("@")[-1].lower() not in domaines
