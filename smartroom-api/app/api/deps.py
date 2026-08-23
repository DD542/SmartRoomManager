"""Dépendances communes aux routes : session, identité, permissions.

L'identité se lit dans le jeton, jamais dans la charge utile : un client qui
enverrait `owner_id` ne réserverait pas pour autrui. Les routes qui agissent au
nom d'un tiers passent explicitement par l'espace d'administration, derrière une
permission.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import AuthenticationError, NotFoundError, PermissionError_
from app.core.security import decode_access_token
from app.db.enums import UserStatus
from app.db.session import get_session
from app.models import AdminAccount, User

SessionDep = Annotated[Session, Depends(get_session)]

#: Les sept permissions structurelles, telles qu'insérées par la migration.
ROOMS_MANAGE = "rooms.manage"
RULES_CONFIGURE = "rules.configure"
USERS_MANAGE = "users.manage"
SUPPORT_HANDLE = "support.handle"
CONFLICTS_ARBITRATE = "conflicts.arbitrate"
DATA_EXPORT = "data.export"
SYSTEM_CONFIGURE = "system.configure"


@dataclass(frozen=True, slots=True)
class Principal:
    """Qui agit, et avec quelle étendue."""

    user: User
    scope: str
    admin: AdminAccount | None = None

    @property
    def is_admin(self) -> bool:
        return self.scope == "admin" and self.admin is not None

    def can(self, code: str) -> bool:
        return self.is_admin and self.admin is not None and self.admin.has_permission(code)


def _jeton(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthenticationError("Authentification requise.")
    return authorization.split(" ", 1)[1].strip()


def get_principal(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """Décode le jeton et recharge le compte : un compte suspendu perd la main
    immédiatement, sans attendre l'expiration de sa session."""
    try:
        charge = decode_access_token(_jeton(authorization))
    except jwt.ExpiredSignatureError as erreur:
        raise AuthenticationError("Session expirée.", code="session_expiree") from erreur
    except jwt.PyJWTError as erreur:
        raise AuthenticationError("Jeton invalide.", code="jeton_invalide") from erreur

    try:
        identifiant = uuid.UUID(charge["sub"])
    except (KeyError, ValueError) as erreur:
        raise AuthenticationError("Jeton invalide.", code="jeton_invalide") from erreur

    compte = session.scalars(
        select(User)
        .options(selectinload(User.admin_account).selectinload(AdminAccount.grants))
        .where(User.id == identifiant, User.deleted_at.is_(None))
    ).one_or_none()

    if compte is None:
        raise AuthenticationError("Compte introuvable.", code="jeton_invalide")
    if compte.status is UserStatus.SUSPENDU:
        raise PermissionError_("Compte suspendu.", code="compte_suspendu")

    scope = charge.get("scope", "user")
    return Principal(user=compte, scope=scope, admin=compte.admin_account)


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


def get_current_user(principal: CurrentPrincipal) -> User:
    return principal.user


def get_current_admin(principal: CurrentPrincipal) -> AdminAccount:
    """Exige une session ouverte *sur l'espace d'administration*.

    Un administrateur connecté côté utilisateur reste un utilisateur : c'est ce
    qui rend une session volée sur l'espace public inexploitable côté back-office.
    """
    if principal.scope != "admin":
        raise PermissionError_(
            "Cette action requiert une session d'administration.", code="scope_invalide"
        )
    if principal.admin is None:
        raise PermissionError_("Compte non administrateur.", code="non_administrateur")
    return principal.admin


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentAdmin = Annotated[AdminAccount, Depends(get_current_admin)]


def require_permission(code: str):
    """Fabrique une garde pour une permission donnée.

    Le propriétaire du système traverse toutes les gardes : `has_permission`
    le reconnaît sans lire la matrice, qu'aucune opération ne peut lui retirer.
    """

    def garde(admin: CurrentAdmin) -> AdminAccount:
        if not admin.has_permission(code):
            raise PermissionError_(
                f"Permission « {code} » requise.", code="permission_manquante"
            )
        return admin

    return garde


def assert_owner_or_admin(principal: Principal, owner_id: uuid.UUID | None) -> None:
    """Une réservation ne se lit et ne se modifie que par son organisateur.

    L'administration passe outre, mais seulement avec la permission d'arbitrage :
    consulter la réservation d'un tiers est déjà un acte de back-office.
    """
    if owner_id is not None and owner_id == principal.user.id:
        return
    if principal.can(CONFLICTS_ARBITRATE):
        return
    # 404 et non 403 : répondre « interdit » confirmerait l'existence de la
    # réservation d'un tiers à qui essaie des identifiants au hasard.
    raise NotFoundError("Réservation introuvable.")
