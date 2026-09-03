"""Profil personnel, comptes utilisateurs, administrateurs et invitations."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status


from app.api.deps import (
    USERS_MANAGE,
    CurrentPrincipal,
    PageDep,
    SessionDep,
    require_permission,
)
from app.api.v1.schemas.comptes import (
    AdminAccountOut,
    AdminInvitationOut,
    AdminPromoteIn,
    AvatarIn,
    InvitationIn,
    PermissionGroupOut,
    PermissionsIn,
    PreferencesIn,
    PreferencesOut,
    ProfileIn,
    QuotaIn,
    SessionOut,
    UserDetailOut,
    UserMetricsOut,
    UserOut,
    UserStatusIn,
)
from app.core.pagination import Page
from app.db.enums import UserStatus
from app.models import AdminAccount, AdminInvitation, User, UserPreference
from app.services import users_service as service
from app.services import mail_service

router = APIRouter(tags=["comptes"])

Gestion = Depends(require_permission(USERS_MANAGE))


def _preferences(preferences: UserPreference | None) -> PreferencesOut | None:
    return PreferencesOut.model_validate(preferences) if preferences else None


def _utilisateur(compte: User) -> UserOut:
    return UserOut(
        id=compte.id,
        email=compte.email,
        first_name=compte.first_name,
        last_name=compte.last_name,
        phone=compte.phone,
        promotion=compte.promotion,
        department=compte.department,
        badge_number=compte.badge_number,
        avatar_url=compte.avatar_url,
        status=compte.status,
        is_admin=compte.admin_account is not None,
        last_login_at=compte.last_login_at,
        preferences=_preferences(compte.preferences),
    )


def _compte_admin(admin: AdminAccount) -> AdminAccountOut:
    """Sérialise un compte d'administration.

    Nommée `_compte_admin` et non `_admin` : les routes de ce module reçoivent
    leur garde de permission dans un paramètre nommé `_admin`, qui masquait la
    fonction dans leur portée locale. `list_admins` appelait donc l'instance
    injectée au lieu du sérialiseur, et rendait un 500 sur chaque lecture de la
    liste des administrateurs.
    """
    return AdminAccountOut(
        user_id=admin.user_id,
        email=admin.user.email,
        first_name=admin.user.first_name,
        last_name=admin.user.last_name,
        job_title=admin.job_title,
        is_owner=admin.is_owner,
        last_admin_login_at=admin.last_admin_login_at,
        permissions=sorted(item.code for item in admin.permissions),
    )


def _invitation(invitation: AdminInvitation) -> AdminInvitationOut:
    return AdminInvitationOut(
        id=invitation.id,
        email=invitation.email,
        sent_at=invitation.sent_at,
        expires_at=invitation.expires_at,
        accepted_at=invitation.accepted_at,
        revoked_at=invitation.revoked_at,
        permissions=sorted(item.code for item in invitation.permissions),
    )


# --------------------------------------------------------------------------- #
# Profil personnel
# --------------------------------------------------------------------------- #


@router.get("/users/me", response_model=UserOut, summary="Mon profil")
def my_profile(session: SessionDep, principal: CurrentPrincipal) -> UserOut:
    return _utilisateur(service.get_profile(session, principal.user.id))


@router.patch(
    "/users/me",
    response_model=UserOut,
    summary="Modifier mon profil",
    description=(
        "Ni le statut, ni l'adresse, ni le quota n'y figurent : ce sont des "
        "décisions de l'administration, pas des préférences personnelles."
    ),
)
def update_my_profile(
    payload: ProfileIn, session: SessionDep, principal: CurrentPrincipal
) -> UserOut:
    compte = service.update_profile(session, principal.user.id, payload)
    session.commit()
    return _utilisateur(compte)


@router.put(
    "/users/me/avatar",
    response_model=UserOut,
    summary="Déposer ma photo de profil",
    description=(
        "PNG, JPEG ou WebP, 5 Mo au maximum. Le SVG est refusé bien que le "
        "magasin de médias l'accepte pour les plans : il porte du script, et "
        "servi depuis le domaine de l'application il s'exécuterait avec ses "
        "droits. La photo précédente est effacée du disque. Le contenu voyage "
        "encodé en base64 dans le corps JSON, le multipart demandant une "
        "dépendance de plus."
    ),
    responses={422: {"description": "Format refusé, fichier vide ou trop lourd."}},
)
def upload_my_avatar(
    payload: AvatarIn, session: SessionDep, principal: CurrentPrincipal
) -> UserOut:
    compte = service.set_avatar(
        session,
        principal.user.id,
        contenu=payload.content,
        content_type=payload.content_type,
    )
    session.commit()
    return _utilisateur(compte)


@router.delete(
    "/users/me/avatar",
    response_model=UserOut,
    summary="Retirer ma photo de profil",
    description="L'écran retombe sur les initiales, qui sont son état par défaut.",
)
def delete_my_avatar(session: SessionDep, principal: CurrentPrincipal) -> UserOut:
    compte = service.remove_avatar(session, principal.user.id)
    session.commit()
    return _utilisateur(compte)


@router.get(
    "/users/me/sessions",
    response_model=list[SessionOut],
    summary="Mes sessions ouvertes",
    description=(
        "Une entrée par *session*, c'est-à-dire par famille de jetons — et non "
        "par jeton : chaque rafraîchissement en émet un nouveau, si bien qu'un "
        "seul navigateur en produit des dizaines par jour. La session qui "
        "appelle est signalée par `current`."
    ),
)
def my_sessions(session: SessionDep, principal: CurrentPrincipal) -> list[SessionOut]:
    courante = principal.family_id
    return [
        SessionOut(
            id=ligne.family_id,
            scope=ligne.scope,
            ip_address=ligne.ip_address,
            user_agent=ligne.user_agent,
            started_at=ligne.created_at,
            expires_at=ligne.expires_at,
            current=ligne.family_id == courante,
        )
        for ligne in service.active_sessions(session, principal.user.id)
    ]


@router.delete(
    "/users/me/sessions",
    summary="Fermer mes autres sessions",
    description=(
        "Révoque toutes les familles de jetons sauf celle qui appelle. Garder "
        "la sienne est délibéré : se déconnecter soi-même obligerait à se "
        "reconnecter pour vérifier que l'ordre a été suivi."
    ),
)
def revoke_my_other_sessions(
    session: SessionDep, principal: CurrentPrincipal
) -> dict[str, int]:
    fermees = service.revoke_other_sessions(
        session, principal.user.id, keep_family=principal.family_id
    )
    session.commit()
    return {"closed": fermees}


@router.get(
    "/users/me/preferences", response_model=PreferencesOut, summary="Mes préférences"
)
def my_preferences(session: SessionDep, principal: CurrentPrincipal) -> PreferencesOut:
    preferences = service.get_preferences(session, principal.user.id)
    session.commit()
    return PreferencesOut.model_validate(preferences)


@router.put(
    "/users/me/preferences",
    response_model=UserOut,
    summary="Enregistrer mes préférences",
    description=(
        "Renvoie le profil complet : l'écran d'accueil met à jour sa session "
        "d'un seul appel, sans relire le profil après coup."
    ),
)
def save_my_preferences(
    payload: PreferencesIn, session: SessionDep, principal: CurrentPrincipal
) -> UserOut:
    service.save_preferences(session, principal.user.id, payload)
    session.commit()
    return _utilisateur(service.get_profile(session, principal.user.id))


@router.get("/users/me/metrics", response_model=UserMetricsOut, summary="Mes crédits")
def my_metrics(session: SessionDep, principal: CurrentPrincipal) -> UserMetricsOut:
    return UserMetricsOut(**service.user_metrics(session, principal.user.id))


# --------------------------------------------------------------------------- #
# Administration des comptes
# --------------------------------------------------------------------------- #


@router.get(
    "/admin/users",
    response_model=Page[UserDetailOut],
    summary="Annuaire des comptes",
    description=(
        "Tri autorisé sur `last_name`, `email`, `promotion`, `created_at`. "
        "Chaque ligne porte ses métriques — réservations actives, absences, "
        "crédits restants — agrégées pour toute la page en deux requêtes. Les "
        "rendre par un appel de détail obligerait l'écran à une requête par "
        "ligne affichée."
    ),
)
def list_users(
    session: SessionDep,
    params: PageDep,
    _admin=Gestion,
    promotion: Annotated[str | None, Query(max_length=60)] = None,
    department: Annotated[str | None, Query(max_length=60)] = None,
    user_status: Annotated[UserStatus | None, Query(alias="status")] = None,
    role: Annotated[str | None, Query(pattern=r"^(admin|utilisateur)$")] = None,
    q: Annotated[str | None, Query(max_length=120)] = None,
) -> Page[UserOut]:
    comptes, total = service.list_users(
        session,
        params,
        promotion=promotion,
        department=department,
        status=user_status,
        role=role,
        query=q,
    )
    mesures = service.metrics_for(session, [item.id for item in comptes])
    return Page.build(
        [
            UserDetailOut(
                **_utilisateur(item).model_dump(),
                metrics=UserMetricsOut(**mesures[item.id]),
            )
            for item in comptes
        ],
        total,
        params,
    )


@router.get(
    "/admin/users/{user_id}",
    response_model=UserDetailOut,
    summary="Fiche d'un compte",
    description="Les métriques sont agrégées en SQL, jamais stockées.",
)
def get_user(user_id: uuid.UUID, session: SessionDep, _admin=Gestion) -> UserDetailOut:
    compte = service.get_profile(session, user_id)
    return UserDetailOut(
        **_utilisateur(compte).model_dump(),
        metrics=UserMetricsOut(**service.user_metrics(session, user_id)),
    )


@router.patch(
    "/admin/users/{user_id}/status",
    response_model=UserOut,
    summary="Suspendre ou réactiver un compte",
    description=(
        "Une suspension ferme les sessions ouvertes : laisser courir un jeton "
        "de quinze minutes après une suspension viderait la décision de son sens."
    ),
    responses={422: {"description": "Motif manquant."}},
)
def set_user_status(
    user_id: uuid.UUID,
    payload: UserStatusIn,
    session: SessionDep,
    #: L'expedition a lieu apres la reponse, comme partout ailleurs : un relais
    #: SMTP lent ne doit pas faire attendre l'administrateur, et un relais
    #: injoignable ne doit pas transformer une suspension ecrite en erreur.
    #:
    #: Sans cette tache, le message reste dans la file du processus et personne
    #: ne la vide : il part au prochain appel d'une *autre* route qui expedie,
    #: des heures plus tard, ou jamais.
    background: BackgroundTasks,
    _admin=Gestion,
) -> UserOut:
    compte = service.set_status(
        session, user_id, status=payload.status, reason=payload.reason
    )
    session.commit()
    background.add_task(mail_service.expedier)

    return _utilisateur(compte)


@router.patch(
    "/admin/users/{user_id}/quota",
    response_model=UserMetricsOut,
    summary="Ajuster le quota hebdomadaire",
)
def set_user_quota(
    user_id: uuid.UUID, payload: QuotaIn, session: SessionDep, _admin=Gestion
) -> UserMetricsOut:
    service.set_quota(session, user_id, hours=payload.weekly_quota_hours)
    session.commit()
    return UserMetricsOut(**service.user_metrics(session, user_id))


# --------------------------------------------------------------------------- #
# Comptes d'administration
# --------------------------------------------------------------------------- #


@router.get(
    "/admin/permissions",
    response_model=list[PermissionGroupOut],
    summary="Référentiel des permissions",
    description="Les sept droits applicatifs, groupés comme à l'écran A-13.",
)
def list_permissions(
    session: SessionDep, principal: CurrentPrincipal
) -> list[PermissionGroupOut]:
    return [
        PermissionGroupOut(
            id=groupe.id,
            code=groupe.code,
            label=groupe.label,
            permissions=[
                {"id": item.id, "code": item.code, "label": item.label}
                for item in sorted(groupe.permissions, key=lambda x: x.sort_order)
            ],
        )
        for groupe in service.permission_groups(session)
    ]


@router.get(
    "/admin/accounts",
    response_model=Page[AdminAccountOut],
    summary="Comptes d'administration",
)
def list_admins(
    session: SessionDep, params: PageDep, _admin=Gestion
) -> Page[AdminAccountOut]:
    admins, total = service.list_admins(session, params)
    return Page.build([_compte_admin(item) for item in admins], total, params)


@router.post(
    "/admin/accounts",
    response_model=AdminAccountOut,
    status_code=status.HTTP_201_CREATED,
    summary="Promouvoir un utilisateur",
    responses={422: {"description": "Déjà administrateur, ou permission inconnue."}},
)
def promote(
    payload: AdminPromoteIn,
    session: SessionDep,
    admin: AdminAccount = Gestion,
) -> AdminAccountOut:
    promu = service.promote(session, payload, granted_by=admin.user_id)
    session.commit()
    return _compte_admin(promu)


@router.patch(
    "/admin/accounts/{user_id}/permissions",
    response_model=AdminAccountOut,
    summary="Remplacer la matrice d'un administrateur",
    description=(
        "Liste complète : elle remplace la matrice, elle ne s'y ajoute pas. Le "
        "propriétaire du système en est exclu — lui retirer ses droits fermerait "
        "la configuration pour tout le monde, sans retour possible."
    ),
    responses={422: {"description": "Propriétaire, ou permission inconnue."}},
)
def update_permissions(
    user_id: uuid.UUID,
    payload: PermissionsIn,
    session: SessionDep,
    admin: AdminAccount = Gestion,
) -> AdminAccountOut:
    modifie = service.update_permissions(
        session, user_id, payload.permissions, granted_by=admin.user_id
    )
    session.commit()
    return _compte_admin(modifie)


@router.delete(
    "/admin/accounts/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Retirer les droits d'administration",
)
def revoke_admin(user_id: uuid.UUID, session: SessionDep, _admin=Gestion) -> None:
    service.revoke_admin(session, user_id)
    session.commit()


@router.get(
    "/admin/invitations",
    response_model=list[AdminInvitationOut],
    summary="Invitations envoyées",
)
def list_invitations(session: SessionDep, _admin=Gestion) -> list[AdminInvitationOut]:
    return [_invitation(item) for item in service.list_invitations(session)]


@router.post(
    "/admin/invitations",
    response_model=AdminInvitationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Inviter un administrateur",
    description=(
        "Le jeton n'est pas stocké en clair : la base garde son empreinte, le "
        "clair part dans le courriel et n'existe nulle part ailleurs."
    ),
)
def invite(
    payload: InvitationIn, session: SessionDep, admin: AdminAccount = Gestion
) -> AdminInvitationOut:
    invitation, _clair = service.invite_admin(
        session, payload, invited_by=admin.user_id
    )
    session.commit()
    return _invitation(invitation)


@router.delete(
    "/admin/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Révoquer une invitation",
)
def revoke_invitation(
    invitation_id: uuid.UUID, session: SessionDep, _admin=Gestion
) -> None:
    service.revoke_invitation(session, invitation_id)
    session.commit()
