"""Ouverture de session, sur l'espace utilisateur ou sur l'administration."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentPrincipal, SessionDep
from app.core.config import get_settings
from app.core.errors import AuthenticationError, PermissionError_
from app.core.security import create_access_token, verify_password
from app.db.enums import UserStatus
from app.models import AdminAccount, User
from app.schemas.comptes import (
    AdminAccountRead,
    LoginRequest,
    SessionRead,
    TokenResponse,
    UserRead,
)

router = APIRouter(prefix="/auth", tags=["authentification"])

FUSEAU = ZoneInfo(get_settings().timezone)

#: Message unique quel que soit le motif : distinguer « compte inconnu » de
#: « mot de passe faux » transformerait la connexion en énumérateur d'adresses.
REFUS = "Adresse e-mail ou mot de passe incorrect."


def _charger(session, email: str) -> User | None:
    return session.scalars(
        select(User)
        .options(
            selectinload(User.preferences),
            selectinload(User.admin_account).selectinload(AdminAccount.grants),
        )
        .where(User.email == email, User.deleted_at.is_(None))
    ).one_or_none()


@router.post("/login", response_model=TokenResponse, summary="Session utilisateur")
def login(payload: LoginRequest, session: SessionDep) -> TokenResponse:
    compte = _charger(session, payload.email)

    if compte is None or not verify_password(payload.password.get_secret_value(), compte.password_hash):
        raise AuthenticationError(REFUS, code="identifiants_invalides")
    if compte.status is UserStatus.SUSPENDU:
        raise PermissionError_(
            "Compte suspendu. Contactez l'administration.", code="compte_suspendu"
        )

    compte.last_login_at = datetime.now(FUSEAU)
    session.commit()

    jeton, duree = create_access_token(subject=compte.id, scope="user")
    return TokenResponse(
        access_token=jeton,
        expires_in=duree,
        user=UserRead.model_validate(compte),
    )


@router.post("/admin/login", response_model=TokenResponse, summary="Session d'administration")
def admin_login(payload: LoginRequest, session: SessionDep) -> TokenResponse:
    """Même identifiants, autre espace : le jeton émis porte `scope=admin`."""
    compte = _charger(session, payload.email)

    if compte is None or not verify_password(payload.password.get_secret_value(), compte.password_hash):
        raise AuthenticationError(REFUS, code="identifiants_invalides")
    if compte.status is UserStatus.SUSPENDU:
        raise PermissionError_("Compte suspendu.", code="compte_suspendu")
    if compte.admin_account is None:
        # Même message que ci-dessus : un utilisateur qui tâtonne sur la page
        # d'administration n'apprend pas quels comptes en sont.
        raise AuthenticationError(REFUS, code="identifiants_invalides")

    admin = compte.admin_account
    admin.last_admin_login_at = datetime.now(FUSEAU)
    session.commit()

    permissions = sorted(grant.permission.code for grant in admin.grants)
    jeton, duree = create_access_token(
        subject=compte.id, scope="admin", permissions=permissions
    )
    return TokenResponse(
        access_token=jeton,
        expires_in=duree,
        user=UserRead.model_validate(compte),
        admin=AdminAccountRead.model_validate(admin),
    )


@router.get("/me", response_model=SessionRead, summary="Session courante")
def me(principal: CurrentPrincipal) -> SessionRead:
    """Rejoue la session à partir du jeton porté, sans en émettre un nouveau.

    Les permissions sont relues en base plutôt que reprises du jeton : c'est le
    seul endroit où le front peut constater une révocation avant la reconnexion.
    """
    admin = principal.admin if principal.is_admin else None
    return SessionRead(
        user=UserRead.model_validate(principal.user),
        admin=AdminAccountRead.model_validate(admin) if admin else None,
        permissions=(
            sorted(permission.code for permission in admin.permissions) if admin else []
        ),
    )
