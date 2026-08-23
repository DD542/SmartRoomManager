"""Erreurs métier du domaine.

Séparées des exceptions HTTP : un service ne connaît pas FastAPI. La couche
route traduit chaque type en statut, ce qui laisse les services testables sans
client HTTP.
"""

from __future__ import annotations


class DomainError(Exception):
    """Base des erreurs métier. `code` est repris tel quel par l'API."""

    code: str = "erreur"
    http_status: int = 400

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code


class NotFoundError(DomainError):
    code = "introuvable"
    http_status = 404


class RuleViolationError(DomainError):
    """Règle de réservation enfreinte : durée, quota, horaires, capacité.

    Contournable par un administrateur disposant du drapeau « ignorer les
    règles » — contrairement à un conflit.
    """

    code = "regles"
    http_status = 422


class SlotConflictError(DomainError):
    """Chevauchement de créneau.

    Ne se force jamais : la contrainte `ex_bookings_no_overlap` l'interdit au
    niveau base, quelle que soit l'intention de l'appelant.
    """

    code = "conflit"
    http_status = 409


class ClosureError(DomainError):
    """La salle est fermée : jour non ouvré ou fermeture exceptionnelle."""

    code = "fermeture"
    http_status = 422


class AuthenticationError(DomainError):
    """Identité non établie : identifiants faux, jeton absent, expiré ou altéré.

    Distinct de `PermissionError_` : un 401 dit au front de renvoyer vers la
    connexion, un 403 dit que la session est valide mais le droit manquant.
    """

    code = "non_authentifie"
    http_status = 401


class PermissionError_(DomainError):
    code = "interdit"
    http_status = 403
