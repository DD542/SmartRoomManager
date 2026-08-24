"""Journalisation d'audit.

Toute écriture sensible y passe : qui, quoi, sur quoi, et l'état avant et après.
L'acteur vient du contexte de requête plutôt que des paramètres — le faire
descendre à travers chaque signature de service polluerait l'ensemble du code
pour un besoin transversal.

La table est en ajout seul, garanti par un déclencheur PostgreSQL : une trace
d'audit modifiable ne vaudrait rien.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.api.context import current_context
from app.db.enums import AuditAction
from app.models import AuditLog

#: Champs jamais recopiés dans la trace : les journaliser reviendrait à stocker
#: un secret en clair à côté de celui qu'on protège.
CHAMPS_SENSIBLES = frozenset(
    {"password", "password_hash", "token", "token_hash", "code_hash", "secret"}
)


def _nettoyer(valeurs: dict[str, Any] | None) -> dict[str, Any] | None:
    if valeurs is None:
        return None
    return {
        cle: ("***" if cle in CHAMPS_SENSIBLES else valeur)
        for cle, valeur in valeurs.items()
    }


def snapshot(instance: object, champs: tuple[str, ...]) -> dict[str, Any]:
    """Photographie d'un objet, limitée aux champs qui comptent.

    Sérialise les valeurs non JSON — UUID, dates, énumérations — pour que la
    colonne JSONB les accepte sans conversion à l'écriture.
    """
    photo: dict[str, Any] = {}
    for champ in champs:
        valeur = getattr(instance, champ, None)
        if isinstance(valeur, uuid.UUID | datetime):
            photo[champ] = str(valeur)
        elif hasattr(valeur, "value"):
            photo[champ] = valeur.value
        else:
            photo[champ] = valeur
    return photo


def record(
    session: Session,
    *,
    action: AuditAction,
    target_type: str,
    target_label: str,
    target_id: uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditLog:
    """Consigne une écriture sensible dans la même transaction que l'écriture.

    Le partage de transaction est délibéré : une action annulée ne doit pas
    laisser de trace, et une action validée doit en laisser une, sans exception.
    """
    contexte = current_context()

    entree = AuditLog(
        actor_label=contexte.user_label,
        # Seul un compte d'administration porte un identifiant d'acteur : une
        # action d'utilisateur reste attribuée par son libellé.
        actor_admin_id=contexte.user_id if contexte.is_admin else None,
        action=action,
        target_type=target_type,
        target_label=target_label,
        target_id=target_id,
        diff_before=_nettoyer(before),
        diff_after=_nettoyer(after),
        ip_address=contexte.ip_address,
        user_agent=contexte.user_agent,
        session_id=contexte.request_id,
        occurred_at=datetime.now(UTC),
    )
    session.add(entree)
    return entree


def record_login(session: Session, *, label: str, scope: str, success: bool) -> AuditLog:
    """Trace une tentative de connexion, réussie ou non.

    Les échecs comptent autant que les réussites : une série de refus sur un
    même compte est le premier signe d'une attaque par bourrage.
    """
    return record(
        session,
        action=AuditAction.CONNEXION,
        target_type="session",
        target_label=label,
        after={"scope": scope, "success": success},
    )
