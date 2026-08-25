"""Traduction des erreurs de validation en messages affichables.

Pydantic rend des messages techniques et anglais — « String should match
pattern '^(day|week|month)$' ». Le front les affiche tels quels dans son
encart d'erreur : un utilisateur y lit une expression régulière.

Ce module les remplace par des phrases françaises nommant le champ. Il ne
masque rien : le code d'erreur d'origine reste dans l'enveloppe, et la contrainte
violée reste citée quand elle éclaire — un intervalle, une longueur, une liste
de valeurs admises.

Le nom du champ est lui aussi traduit : `granularity` devient « la granularité ».
Un formulaire qui renvoie le nom d'une colonne à l'utilisateur lui demande de
connaître le modèle de données.
"""

from __future__ import annotations

from typing import Any

#: Noms de champs vus par l'utilisateur. Ceux qui n'y figurent pas gardent leur
#: nom technique : mieux vaut un mot anglais qu'une traduction inventée qui
#: désignerait un autre champ.
CHAMPS: dict[str, str] = {
    "granularity": "la granularité",
    "first_day": "le premier jour",
    "last_day": "le dernier jour",
    "from_date": "la date de début",
    "to_date": "la date de fin",
    "since": "la date de début",
    "until": "la date de fin",
    "page": "le numéro de page",
    "size": "la taille de page",
    "sort": "le tri",
    "limit": "la limite",
    "days": "le nombre de jours",
    "email": "l'adresse e-mail",
    "password": "le mot de passe",
    "status": "le statut",
    "action": "l'action",
    "role": "le rôle",
    "reason": "le motif",
    "title": "le titre",
    "capacity": "la capacité",
    "attendees": "le nombre de participants",
    "room_id": "la salle",
    "building_id": "le bâtiment",
    "floor_id": "l'étage",
    "owner_id": "l'organisateur",
    "user_id": "l'utilisateur",
    "slot": "le créneau",
    "starts_at": "l'heure de début",
    "ends_at": "l'heure de fin",
    "permissions": "les permissions",
    "body": "le contenu",
    "subject": "l'objet",
    "code": "le code",
    "label": "le libellé",
    "name": "le nom",
}


def nommer(chemin: str) -> str:
    """Rend le champ sous une forme lisible, sans inventer de traduction."""
    if not chemin:
        return "la requête"
    dernier = chemin.split(".")[-1]
    return CHAMPS.get(dernier, f"« {chemin} »")


def _valeurs_admises(erreur: dict[str, Any]) -> str | None:
    """Extrait la liste des valeurs acceptées, quand elle existe.

    Un motif comme `^(day|week|month)$` décrit une énumération : la rendre en
    clair est plus utile que de recopier l'expression.
    """
    contexte = erreur.get("ctx") or {}
    attendues = contexte.get("expected")
    if attendues:
        return str(attendues)

    motif = contexte.get("pattern")
    if isinstance(motif, str) and motif.startswith("^(") and motif.endswith(")$"):
        options = motif[2:-2].split("|")
        if all(option.isidentifier() or option.isalnum() for option in options):
            return ", ".join(options)
    return None


def traduire(erreur: dict[str, Any]) -> str:
    """Message français pour une erreur de validation Pydantic.

    Le message d'origine est conservé en dernier recours : une traduction
    absente vaut mieux qu'un message inventé qui décrirait la mauvaise
    contrainte.
    """
    chemin = ".".join(str(part) for part in erreur.get("loc", [])[1:])
    champ = nommer(chemin)
    type_erreur = str(erreur.get("type", ""))
    contexte = erreur.get("ctx") or {}

    if type_erreur == "missing":
        return f"{champ.capitalize()} est obligatoire."

    if type_erreur in {"string_pattern_mismatch", "enum", "literal_error"}:
        admises = _valeurs_admises(erreur)
        if admises:
            return f"{champ.capitalize()} doit valoir l'une de ces valeurs : {admises}."
        return f"{champ.capitalize()} n'a pas le format attendu."

    if type_erreur in {"int_parsing", "int_type", "float_parsing", "decimal_parsing"}:
        return f"{champ.capitalize()} doit être un nombre."

    if type_erreur in {"datetime_parsing", "datetime_type", "datetime_from_date_parsing"}:
        return (
            f"{champ.capitalize()} doit être une date et une heure au format "
            "ISO 8601, par exemple 2026-08-25T14:30:00Z."
        )

    if type_erreur in {"date_parsing", "date_type", "date_from_datetime_parsing"}:
        return f"{champ.capitalize()} doit être une date au format AAAA-MM-JJ."

    if type_erreur in {"time_parsing", "time_type"}:
        return f"{champ.capitalize()} doit être une heure au format HH:MM:SS."

    if type_erreur in {"uuid_parsing", "uuid_type"}:
        return f"{champ.capitalize()} doit être un identifiant valide."

    if type_erreur in {"bool_parsing", "bool_type"}:
        return f"{champ.capitalize()} doit valoir vrai ou faux."

    if type_erreur == "greater_than_equal":
        return f"{champ.capitalize()} doit valoir au moins {contexte.get('ge')}."
    if type_erreur == "greater_than":
        return f"{champ.capitalize()} doit dépasser {contexte.get('gt')}."
    if type_erreur == "less_than_equal":
        return f"{champ.capitalize()} ne peut pas dépasser {contexte.get('le')}."
    if type_erreur == "less_than":
        return f"{champ.capitalize()} doit rester sous {contexte.get('lt')}."

    if type_erreur in {"string_too_short", "too_short"}:
        minimum = contexte.get("min_length")
        return f"{champ.capitalize()} doit compter au moins {minimum} caractères."
    if type_erreur in {"string_too_long", "too_long"}:
        maximum = contexte.get("max_length")
        return f"{champ.capitalize()} ne peut pas dépasser {maximum} caractères."

    if type_erreur in {"string_type", "list_type", "dict_type", "model_attributes_type"}:
        return f"{champ.capitalize()} n'a pas le type attendu."

    if type_erreur == "extra_forbidden":
        return f"{champ.capitalize()} n'est pas un champ accepté."

    if type_erreur == "value_error":
        # Les validateurs métier lèvent déjà un message français rédigé pour
        # l'affichage : le recopier vaut mieux que de le paraphraser.
        message = str(erreur.get("msg", ""))
        return message.removeprefix("Value error, ") or "Valeur refusée."

    return str(erreur.get("msg", "Requête invalide."))
