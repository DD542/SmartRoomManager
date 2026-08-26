"""Dépendances communes aux routes : session, identité, permissions.

L'identité se lit dans le jeton, jamais dans la charge utile : un client qui
enverrait `owner_id` ne réserverait pas pour autrui. Les routes qui agissent au
nom d'un tiers passent explicitement par l'espace d'administration, derrière une
permission nommée.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.context import bind_principal
from app.core.errors import AuthenticationError, NotFoundError, PermissionError_
from app.core.pagination import PageParams, page_params
from app.core.security import TokenError, decode_access_token
from app.db.enums import UserStatus
from app.db.session import get_session
from app.models import AdminAccount, Permission, User

SessionDep = Annotated[Session, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]

#: Les sept permissions structurelles, telles qu'insérées par la migration.
ROOMS_MANAGE = "rooms.manage"
RULES_CONFIGURE = "rules.configure"
USERS_MANAGE = "users.manage"
SUPPORT_HANDLE = "support.handle"
CONFLICTS_ARBITRATE = "conflicts.arbitrate"
DATA_EXPORT = "data.export"
SYSTEM_CONFIGURE = "system.configure"

PERMISSIONS = (
    ROOMS_MANAGE,
    RULES_CONFIGURE,
    USERS_MANAGE,
    SUPPORT_HANDLE,
    CONFLICTS_ARBITRATE,
    DATA_EXPORT,
    SYSTEM_CONFIGURE,
)


@dataclass(frozen=True, slots=True)
class Principal:
    """Qui agit, et avec quelle étendue."""

    user: User
    scope: str
    admin: AdminAccount | None = None
    permissions: frozenset[str] = frozenset()
    #: Session dont ce jeton est issu, quand il la porte. Sert à l'écran des
    #: sessions ouvertes, qui doit distinguer celle qui l'interroge.
    family_id: uuid.UUID | None = None

    @property
    def is_admin(self) -> bool:
        return self.scope == "admin" and self.admin is not None

    def can(self, code: str) -> bool:
        return self.is_admin and code in self.permissions


def _jeton(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthenticationError("Authentification requise.")
    return authorization.split(" ", 1)[1].strip()


def get_principal(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    """Décode le jeton et recharge le compte.

    Les permissions sont relues en base à chaque requête, jamais reprises du
    jeton : une révocation prend ainsi effet immédiatement plutôt qu'au
    renouvellement suivant. Le coût est d'une requête indexée par appel.
    """
    try:
        charge = decode_access_token(_jeton(authorization))
    except TokenError as erreur:
        message = str(erreur).lower()
        code = "session_expiree" if "expire" in message else "jeton_invalide"
        raise AuthenticationError(
            "Session expirée." if code == "session_expiree" else "Jeton invalide.",
            code=code,
        ) from erreur

    try:
        identifiant = uuid.UUID(charge["sub"])
    except (KeyError, ValueError) as erreur:
        raise AuthenticationError("Jeton invalide.", code="jeton_invalide") from erreur

    compte = session.scalars(
        select(User)
        .options(
            selectinload(User.admin_account).selectinload(AdminAccount.permissions),
            selectinload(User.preferences),
        )
        .where(User.id == identifiant, User.deleted_at.is_(None))
    ).one_or_none()

    if compte is None:
        raise AuthenticationError("Compte introuvable.", code="jeton_invalide")
    if compte.status is UserStatus.SUSPENDU:
        raise PermissionError_("Compte suspendu.", code="compte_suspendu")

    scope = charge.get("scope", "user")
    admin = compte.admin_account

    droits: frozenset[str] = frozenset()
    if admin is not None:
        # Le propriétaire détient tout, sans dépendre de la matrice : la lui
        # retirer fermerait la configuration du système pour tout le monde.
        droits = (
            frozenset(PERMISSIONS)
            if admin.is_owner
            else frozenset(item.code for item in admin.permissions)
        )

    famille = charge.get("fam")
    try:
        famille = uuid.UUID(famille) if famille else None
    except ValueError:
        # Une revendication illisible n'invalide pas le jeton : elle ne sert
        # qu'au confort d'un écran, et le refuser fermerait la session entière.
        famille = None

    principal = Principal(
        user=compte, scope=scope, admin=admin, permissions=droits, family_id=famille
    )
    bind_principal(
        user_id=compte.id,
        user_label=f"{compte.first_name} {compte.last_name}",
        is_admin=principal.is_admin,
    )
    return principal


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
    """Fabrique une garde pour une permission donnée."""

    def garde(principal: CurrentPrincipal) -> AdminAccount:
        admin = get_current_admin(principal)
        if code not in principal.permissions:
            raise PermissionError_(
                f"Permission « {code} » requise.", code="permission_manquante"
            )
        return admin

    return garde


def require_any(*codes: str):
    """Garde satisfaite par l'une quelconque des permissions listées."""

    def garde(principal: CurrentPrincipal) -> AdminAccount:
        admin = get_current_admin(principal)
        if not any(code in principal.permissions for code in codes):
            listees = " ou ".join(f"« {code} »" for code in codes)
            raise PermissionError_(
                f"Permission {listees} requise.", code="permission_manquante"
            )
        return admin

    return garde


def assert_owner_or_admin(principal: Principal, owner_id: uuid.UUID | None) -> None:
    """Une réservation ne se lit et ne se modifie que par son organisateur.

    Cette garde double le filtre appliqué en SQL : elle couvre les chemins où
    l'objet est chargé par identifiant, sans clause de propriété.
    """
    if owner_id is not None and owner_id == principal.user.id:
        return
    if principal.can(CONFLICTS_ARBITRATE):
        return
    # 404 et non 403 : répondre « interdit » confirmerait l'existence de la
    # réservation d'un tiers à qui essaie des identifiants au hasard.
    raise NotFoundError("Réservation introuvable.")


def known_permissions(session: Session) -> list[Permission]:
    """Référentiel des permissions, pour l'écran de la matrice."""
    return list(
        session.scalars(
            select(Permission).order_by(Permission.group_id, Permission.sort_order)
        )
    )
