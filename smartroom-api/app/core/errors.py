"""Erreurs métier du domaine applicatif.

Séparées des exceptions HTTP : un service ne connaît pas FastAPI. La couche API
traduit chaque type en statut, ce qui laisse les services testables sans client
HTTP.

Chaque erreur porte un `code` stable — machinable par le front — et un `message`
en français que l'écran affiche tel quel.
"""

from __future__ import annotations

from typing import Any


class DomainError(Exception):
    """Base des erreurs métier. `code` est repris tel quel par l'API."""

    code: str = "erreur"
    http_status: int = 400

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        fields: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.fields = fields or []
        if code is not None:
            self.code = code

    def payload(self) -> dict[str, Any]:
        """Corps de la réponse, sans le statut : la couche API l'ajoute."""
        corps: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            corps["fields"] = self.fields
        return corps


class ValidationError(DomainError):
    """Charge utile refusée. `fields` désigne les champs en faute."""

    code = "validation"
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


class ClosureError(DomainError):
    """La salle est fermée : jour non ouvré ou fermeture exceptionnelle."""

    code = "fermeture"
    http_status = 422


class SlotConflictError(DomainError):
    """Chevauchement de créneau.

    Ne se force jamais : la contrainte `ex_bookings_no_overlap` l'interdit au
    niveau base, quelle que soit l'intention de l'appelant.

    Le conflit qualifié et les alternatives voyagent dans la réponse : l'écran
    de conflit les affiche sans second aller-retour réseau.
    """

    code = "conflit"
    http_status = 409

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        conflict: dict[str, Any] | None = None,
        alternatives: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(message, code=code)
        self.conflict = conflict
        self.alternatives = alternatives or []

    def payload(self) -> dict[str, Any]:
        corps = super().payload()
        if self.conflict is not None:
            corps["conflict"] = self.conflict
        if self.alternatives:
            corps["alternatives"] = self.alternatives
        return corps


class RateLimitError(DomainError):
    code = "trop_de_requetes"
    http_status = 429
