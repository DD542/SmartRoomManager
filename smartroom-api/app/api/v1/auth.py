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


class GoogleLoginIn(BaseModel):
    """Jeton d'identité rendu par Google au navigateur.

    Le serveur ne le croit pas sur parole : il en vérifie la signature, son
    émetteur et son destinataire avant d'ouvrir quoi que ce soit.
    """

    model_config = ConfigDict(extra="forbid")

    credential: Annotated[str, Field(min_length=32, max_length=4096)]


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
    #: Vrai quand la connexion vient de créer le compte. L'écran d'accueil
    #: n'accueille pas un nouveau venu comme il retrouve un habitué.
    created: bool = False


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


class GoogleConfigOut(BaseModel):
    """De quoi le navigateur a besoin pour proposer la connexion Google.

    L'identifiant de client est public par construction : il figure dans la
    page de tout site qui propose cette connexion. Le servir depuis l'API évite
    de le configurer deux fois — une divergence entre le front et le serveur ne
    se verrait qu'au moment du refus, sur un message d'audience incorrecte.
    """

    model_config = ConfigDict(from_attributes=True)

    enabled: bool
    client_id: str


@router.get(
    "/google/config",
    response_model=GoogleConfigOut,
    summary="Configuration publique de la connexion Google",
    description=(
        "Dit si la connexion Google est active sur ce serveur, et sous quel "
        "identifiant de client. Sans secret : cet identifiant est public."
    ),
)
def google_config() -> GoogleConfigOut:
    identifiant = settings.google_client_id
    return GoogleConfigOut(enabled=bool(identifiant), client_id=identifiant)


@router.post(
    "/google",
    response_model=TokenOut,
    summary="Ouvrir une session avec un compte Google",
    description=(
        "Reçoit le jeton d'identité rendu par Google au navigateur, en vérifie "
        "la signature, l'émetteur et le destinataire, puis ouvre une session. "
        "Le compte est créé s'il n'existe pas : c'est le propre d'une connexion "
        "déléguée. Le mot de passe reste inconnu de tous — l'utilisateur en "
        "choisira un par « mot de passe oublié » s'il veut aussi cette voie."
    ),
    responses={
        401: {"description": "Jeton Google invalide, expiré, ou adresse non vérifiée."},
        403: {"description": "Compte suspendu."},
        422: {"description": "Connexion Google non configurée, ou domaine refusé."},
        429: {"description": "Trop de tentatives."},
    },
)
@limiter.limit(settings.rate_limit_login)
def login_google(
    request: Request, response: Response, payload: GoogleLoginIn, session: SessionDep
) -> TokenOut:
    resultat, creation = auth_service.login_google(session, jeton=payload.credential)
    session.commit()
    _poser_cookie(response, resultat.refresh_token)
    sortie = _sortie(resultat)
    sortie.created = creation
    return sortie


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
