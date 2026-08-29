"""Ouverture, renouvellement et fermeture de session, et mot de passe.

Le jeton d'accès est renvoyé dans le corps — le front le garde en mémoire — et
le rafraîchissement part en cookie `httpOnly`, hors de portée du JavaScript.
C'est ce qui permet de se passer de `localStorage` sans sacrifier la persistance
de la session.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.api.deps import CurrentPrincipal, SessionDep
from app.core.config import get_settings
from app.core.limiter import limiter
from app.schemas.comptes import AdminAccountRead, UserRead
from app.services import auth_service

settings = get_settings()
router = APIRouter(prefix="/auth", tags=["authentification"])

COOKIE = settings.refresh_cookie_name


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: Annotated[str, Field(max_length=255, examples=["camille.durand@ece.fr"])]
    password: SecretStr


class ForgotPasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    email: Annotated[str, Field(max_length=255)]


class ResetPasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Annotated[str, Field(min_length=16, max_length=128)]
    password: Annotated[SecretStr, Field(min_length=8)]


class ChangePasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: SecretStr
    new_password: Annotated[SecretStr, Field(min_length=8)]


class TokenOut(BaseModel):
    """Le rafraîchissement n'y figure pas : il part en cookie."""

    model_config = ConfigDict(from_attributes=True)

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    scope: str
    user: UserRead
    admin: AdminAccountRead | None = None


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserRead
    admin: AdminAccountRead | None = None
    scope: str
    permissions: list[str] = Field(default_factory=list)


def _poser_cookie(response: Response, jeton: str) -> None:
    response.set_cookie(
        key=COOKIE,
        value=jeton,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        path=settings.refresh_cookie_path,
        max_age=settings.refresh_ttl_days * 86_400,
    )


def _retirer_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE, path=settings.refresh_cookie_path)


def _sortie(resultat: auth_service.Session_) -> TokenOut:
    return TokenOut(
        access_token=resultat.access_token,
        expires_in=resultat.expires_in,
        scope=resultat.scope,
        user=UserRead.model_validate(resultat.user),
        admin=(
            AdminAccountRead.model_validate(resultat.admin)
            if resultat.admin is not None
            else None
        ),
    )


@router.post(
    "/login",
    response_model=TokenOut,
    summary="Ouvrir une session utilisateur",
    description=(
        "Émet un jeton d'accès de courte durée et pose le jeton de "
        "rafraîchissement en cookie `httpOnly`. La réponse est identique pour "
        "une adresse inconnue et un mot de passe faux."
    ),
    responses={
        401: {"description": "Identifiants incorrects."},
        403: {"description": "Compte suspendu."},
        429: {"description": "Trop de tentatives."},
    },
)
@limiter.limit(settings.rate_limit_login)
def login(
    request: Request, response: Response, payload: LoginIn, session: SessionDep
) -> TokenOut:
    resultat = auth_service.login(
        session, email=payload.email, password=payload.password.get_secret_value()
    )
    session.commit()
    _poser_cookie(response, resultat.refresh_token)
    return _sortie(resultat)


@router.post(
    "/admin/login",
    response_model=TokenOut,
    summary="Ouvrir une session d'administration",
    description=(
        "Mêmes identifiants, autre espace : le jeton émis porte `scope=admin`. "
        "Un compte sans droits d'administration reçoit le même refus qu'un mot "
        "de passe incorrect."
    ),
    responses={401: {"description": "Identifiants incorrects."}, 429: {"description": "Trop de tentatives."}},
)
@limiter.limit(settings.rate_limit_login)
def admin_login(
    request: Request, response: Response, payload: LoginIn, session: SessionDep
) -> TokenOut:
    resultat = auth_service.login(
        session,
        email=payload.email,
        password=payload.password.get_secret_value(),
        admin=True,
    )
    session.commit()
    _poser_cookie(response, resultat.refresh_token)
    return _sortie(resultat)


@router.post(
    "/refresh",
    response_model=TokenOut,
    summary="Renouveler le jeton d'accès",
    description=(
        "Consomme le cookie de rafraîchissement et en pose un nouveau. Un jeton "
        "déjà consommé qui reparaît révoque toute la famille : il signale une "
        "copie en circulation."
    ),
    responses={401: {"description": "Session inconnue, expirée ou rejouée."}},
)
def refresh(
    response: Response,
    session: SessionDep,
    smartroom_refresh: Annotated[str | None, Cookie(alias=COOKIE)] = None,
) -> TokenOut:
    if not smartroom_refresh:
        from app.core.errors import AuthenticationError

        raise AuthenticationError("Aucune session à renouveler.", code="jeton_absent")

    try:
        resultat = auth_service.refresh(session, token=smartroom_refresh)
    except Exception:
        # La révocation d'une famille compromise doit survivre au refus.
        session.commit()
        _retirer_cookie(response)
        raise

    session.commit()
    _poser_cookie(response, resultat.refresh_token)
    return _sortie(resultat)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Fermer la session",
    description="Révoque la famille de jetons et efface le cookie.",
)
def logout(
    response: Response,
    session: SessionDep,
    smartroom_refresh: Annotated[str | None, Cookie(alias=COOKIE)] = None,
) -> Response:
    auth_service.logout(session, token=smartroom_refresh)
    session.commit()
    _retirer_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/me",
    response_model=SessionOut,
    summary="Session courante",
    description=(
        "Rejoue la session à partir du jeton porté. Les permissions sont relues "
        "en base : c'est le seul endroit où le front constate une révocation "
        "avant la reconnexion."
    ),
)
def me(principal: CurrentPrincipal) -> SessionOut:
    return SessionOut(
        user=UserRead.model_validate(principal.user),
        admin=(
            AdminAccountRead.model_validate(principal.admin)
            if principal.is_admin
            else None
        ),
        scope=principal.scope,
        permissions=sorted(principal.permissions) if principal.is_admin else [],
    )


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Demander une réinitialisation",
    description=(
        "Répond 202 même pour une adresse inconnue : un 404 transformerait "
        "cette route en énumérateur de comptes."
    ),
    responses={429: {"description": "Trop de demandes."}},
)
@limiter.limit(settings.rate_limit_reset)
def forgot_password(
    request: Request,
    payload: ForgotPasswordIn,
    session: SessionDep,
    background: BackgroundTasks,
) -> dict[str, str]:
    resultat = auth_service.request_password_reset(session, email=payload.email)
    session.commit()

    if resultat is not None:
        compte, jeton = resultat
        from app.services import mail_service

        mail_service.queue_password_reset(session, compte, jeton)
        session.commit()
        # Un lien de réinitialisation qui attend le prochain passage de
        # maintenance expire pour partie avant d'arriver.
        background.add_task(mail_service.expedier)

    return {"status": "accepted"}


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Réinitialiser le mot de passe",
    description="Le lien est à usage unique. Toutes les sessions du compte tombent.",
    responses={
        401: {"description": "Lien expiré ou déjà utilisé."},
        404: {"description": "Lien inconnu."},
    },
)
def reset_password(payload: ResetPasswordIn, session: SessionDep) -> Response:
    auth_service.reset_password(
        session, token=payload.token, password=payload.password.get_secret_value()
    )
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Changer son mot de passe",
    description="Exige l'ancien mot de passe et referme toutes les sessions.",
    responses={401: {"description": "Mot de passe actuel incorrect."}},
)
def change_password(
    payload: ChangePasswordIn,
    response: Response,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> Response:
    auth_service.change_password(
        session,
        principal.user,
        current=payload.current_password.get_secret_value(),
        next_=payload.new_password.get_secret_value(),
    )
    session.commit()
    _retirer_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
