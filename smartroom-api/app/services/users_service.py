"""Comptes utilisateurs, comptes d'administration et invitations.

Un utilisateur modifie son propre profil ; l'administration gère les autres.
Les deux chemins passent par ce module, mais jamais par la même route : c'est
la garde de permission qui les sépare, pas un paramètre.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core.errors import NotFoundError, RuleViolationError
from app.core.pagination import PageParams, paginate
from app.core.security import new_opaque_token
from app.db.enums import AuditAction, BookingStatus, UserStatus
from app.models import (
    AdminAccount,
    AdminInvitation,
    AdminPermission,
    Booking,
    Permission,
    PermissionGroup,
    User,
    UserPreference,
)
from app.services import audit_service, auth_service

CHAMPS_PROFIL = ("first_name", "last_name", "phone", "promotion", "department", "status")

#: Durée de validité d'une invitation d'administrateur.
INVITATION_JOURS = 7

TRI_UTILISATEURS: dict[str, Any] = {
    "last_name": User.last_name,
    "email": User.email,
    "promotion": User.promotion,
    "created_at": User.created_at,
}


def _charger(session: Session, user_id: uuid.UUID) -> User:
    compte = session.scalars(
        select(User)
        .options(selectinload(User.preferences), selectinload(User.admin_account))
        # `populate_existing` : sans lui, un compte déjà chargé garderait son
        # `admin_account` à None après une promotion, et le contrôle de doublon
        # laisserait passer la seconde promotion jusqu'à la contrainte de base.
        .execution_options(populate_existing=True)
        .where(User.id == user_id, User.deleted_at.is_(None))
    ).one_or_none()
    if compte is None:
        raise NotFoundError("Utilisateur introuvable.")
    return compte


# --------------------------------------------------------------------------- #
# Profil personnel
# --------------------------------------------------------------------------- #


def get_profile(session: Session, user_id: uuid.UUID) -> User:
    return _charger(session, user_id)


def update_profile(session: Session, user_id: uuid.UUID, payload: Any) -> User:
    """Modifie son propre profil.

    Ni le statut, ni l'adresse, ni le quota n'y figurent : ce sont des décisions
    de l'administration, pas des préférences personnelles.
    """
    compte = _charger(session, user_id)
    for champ, valeur in payload.model_dump(exclude_unset=True).items():
        setattr(compte, champ, valeur)
    session.flush()
    return compte


def get_preferences(session: Session, user_id: uuid.UUID) -> UserPreference:
    compte = _charger(session, user_id)
    if compte.preferences is None:
        # Créées à la première lecture : un compte sans préférence n'existe pas
        # du point de vue des écrans, qui attendent toujours un objet.
        compte.preferences = UserPreference(user_id=compte.id)
        session.add(compte.preferences)
        session.flush()
    return compte.preferences


def save_preferences(session: Session, user_id: uuid.UUID, payload: Any) -> UserPreference:
    preferences = get_preferences(session, user_id)
    for champ, valeur in payload.model_dump(exclude_unset=True).items():
        setattr(preferences, champ, valeur)
    session.flush()
    return preferences


# --------------------------------------------------------------------------- #
# Administration des comptes
# --------------------------------------------------------------------------- #


def list_users(
    session: Session,
    params: PageParams,
    *,
    promotion: str | None = None,
    department: str | None = None,
    status: UserStatus | None = None,
    role: str | None = None,
    query: str | None = None,
) -> tuple[list[User], int]:
    requete = (
        select(User)
        .options(selectinload(User.admin_account), selectinload(User.preferences))
        .where(User.deleted_at.is_(None))
        .order_by(User.last_name, User.first_name)
    )

    if promotion:
        requete = requete.where(User.promotion == promotion)
    if department:
        requete = requete.where(User.department == department)
    if status is not None:
        requete = requete.where(User.status == status)
    if role == "admin":
        requete = requete.where(
            select(AdminAccount.user_id).where(AdminAccount.user_id == User.id).exists()
        )
    elif role == "utilisateur":
        requete = requete.where(
            ~select(AdminAccount.user_id).where(AdminAccount.user_id == User.id).exists()
        )
    if query:
        motif = f"%{query}%"
        requete = requete.where(
            or_(
                User.email.ilike(motif),
                User.first_name.ilike(motif),
                User.last_name.ilike(motif),
            )
        )

    return paginate(session, requete, params, colonnes=TRI_UTILISATEURS)


def user_metrics(session: Session, user_id: uuid.UUID) -> dict[str, Any]:
    """Métriques d'un compte, agrégées en SQL.

    Les crédits restants se mesurent sur la semaine en cours et sur le quota du
    compte : afficher un quota fixe mentirait dès qu'un administrateur l'ajuste.
    """
    compte = _charger(session, user_id)
    maintenant = datetime.now(UTC)
    lundi = maintenant - timedelta(days=maintenant.weekday())
    debut_semaine = lundi.replace(hour=0, minute=0, second=0, microsecond=0)

    ligne = session.execute(
        select(
            func.count().filter(Booking.status != BookingStatus.ANNULEE),
            func.count().filter(Booking.status == BookingStatus.ANNULEE),
            func.count().filter(
                (Booking.checked_in_at.is_(None))
                & (Booking.status != BookingStatus.ANNULEE)
                & (Booking.time_range.op("<<")(Range(maintenant, None, bounds="[)")))
            ),
            func.count().filter(
                (Booking.status != BookingStatus.ANNULEE)
                & (Booking.time_range.op("<<")(Range(maintenant, None, bounds="[)")))
            ),
        ).where(Booking.owner_id == user_id, Booking.deleted_at.is_(None))
    ).one()

    heures_semaine = session.scalar(
        select(
            func.coalesce(
                func.sum(
                    func.extract(
                        "epoch",
                        func.upper(Booking.time_range) - func.lower(Booking.time_range),
                    )
                    / 3600
                ),
                0,
            )
        ).where(
            Booking.owner_id == user_id,
            Booking.deleted_at.is_(None),
            Booking.status != BookingStatus.ANNULEE,
            Booking.time_range.op("&&")(Range(debut_semaine, None, bounds="[)")),
        )
    ) or 0

    quota = (
        compte.preferences.weekly_quota_hours
        if compte.preferences is not None
        else 12
    )
    ecoulees = ligne[3] or 0
    honorees = ecoulees - (ligne[2] or 0)

    return {
        "active_bookings": ligne[0] or 0,
        "cancellations": ligne[1] or 0,
        "no_shows": ligne[2] or 0,
        "attendance_rate": round(honorees / ecoulees, 4) if ecoulees else None,
        "booked_hours_this_week": round(float(heures_semaine), 2),
        "weekly_quota_hours": quota,
        "remaining_credits_h": max(0, round(quota - float(heures_semaine), 2)),
    }


def set_status(
    session: Session, user_id: uuid.UUID, *, status: UserStatus, reason: str
) -> User:
    """Suspend ou réactive un compte.

    Une suspension ferme les sessions ouvertes : laisser courir un jeton de
    quinze minutes après une suspension viderait la décision de son sens.
    """
    if not reason.strip():
        raise RuleViolationError("Un motif est requis.", code="motif_requis")

    compte = _charger(session, user_id)
    avant = compte.status
    compte.status = status

    if status is UserStatus.SUSPENDU:
        auth_service.revoke_all(session, user_id)

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="user",
        target_label=compte.email,
        target_id=compte.id,
        before={"status": avant.value},
        after={"status": status.value, "reason": reason.strip()},
    )
    session.flush()
    return compte


def set_quota(session: Session, user_id: uuid.UUID, *, hours: int) -> UserPreference:
    preferences = get_preferences(session, user_id)
    avant = preferences.weekly_quota_hours
    preferences.weekly_quota_hours = hours

    audit_service.record(
        session,
        action=AuditAction.MODIFICATION,
        target_type="user_preference",
        target_label=preferences.user.email,
        target_id=user_id,
        before={"weekly_quota_hours": avant},
        after={"weekly_quota_hours": hours},
    )
    session.flush()
    return preferences


# --------------------------------------------------------------------------- #
# Comptes d'administration
# --------------------------------------------------------------------------- #


def permission_groups(session: Session) -> list[PermissionGroup]:
    return list(
        session.scalars(
            select(PermissionGroup)
            .options(selectinload(PermissionGroup.permissions))
            .order_by(PermissionGroup.sort_order)
        )
    )


def list_admins(session: Session, params: PageParams) -> tuple[list[AdminAccount], int]:
    requete = (
        select(AdminAccount)
        .options(
            selectinload(AdminAccount.user), selectinload(AdminAccount.permissions)
        )
        .join(User, User.id == AdminAccount.user_id)
        .where(User.deleted_at.is_(None))
        .order_by(User.last_name)
    )
    return paginate(session, requete, params)


def _appliquer_permissions(
    session: Session, admin: AdminAccount, codes: list[str], *, granted_by: uuid.UUID
) -> None:
    """Remplace la matrice d'un administrateur par la liste fournie."""
    connues = {
        item.code: item.id
        for item in session.scalars(select(Permission).where(Permission.code.in_(codes)))
    }
    inconnues = set(codes) - set(connues)
    if inconnues:
        raise RuleViolationError(
            f"Permission inconnue : {', '.join(sorted(inconnues))}.", code="permission_inconnue"
        )

    session.execute(
        AdminPermission.__table__.delete().where(
            AdminPermission.admin_user_id == admin.user_id
        )
    )
    for code in codes:
        session.add(
            AdminPermission(
                admin_user_id=admin.user_id,
                permission_id=connues[code],
                granted_by_admin_id=granted_by,
            )
        )
    session.flush()


def promote(session: Session, payload: Any, *, granted_by: uuid.UUID) -> AdminAccount:
    """Promeut un utilisateur existant en administrateur."""
    compte = _charger(session, payload.user_id)
    if compte.admin_account is not None:
        raise RuleViolationError(
            f"{compte.email} est déjà administrateur.", code="deja_administrateur"
        )

    admin = AdminAccount(user_id=compte.id, job_title=payload.job_title)
    session.add(admin)
    session.flush()

    _appliquer_permissions(session, admin, payload.permissions, granted_by=granted_by)
    audit_service.record(
        session,
        action=AuditAction.PERMISSION,
        target_type="admin_account",
        target_label=compte.email,
        target_id=compte.id,
        after={"job_title": payload.job_title, "permissions": payload.permissions},
    )
    session.flush()
    return admin


def update_permissions(
    session: Session, user_id: uuid.UUID, codes: list[str], *, granted_by: uuid.UUID
) -> AdminAccount:
    """Remplace la matrice d'un administrateur.

    Le propriétaire du système en est exclu : lui retirer ses droits fermerait
    la configuration pour tout le monde, sans moyen de revenir en arrière.
    """
    admin = session.get(AdminAccount, user_id)
    if admin is None:
        raise NotFoundError("Compte d'administration introuvable.")
    if admin.is_owner:
        raise RuleViolationError(
            "Les droits du propriétaire ne se modifient pas.", code="proprietaire"
        )

    avant = sorted(item.code for item in admin.permissions)
    _appliquer_permissions(session, admin, codes, granted_by=granted_by)

    audit_service.record(
        session,
        action=AuditAction.PERMISSION,
        target_type="admin_account",
        target_label=admin.user.email,
        target_id=user_id,
        before={"permissions": avant},
        after={"permissions": sorted(codes)},
    )
    session.flush()
    session.expire(admin, ["grants", "permissions"])
    return admin


def revoke_admin(session: Session, user_id: uuid.UUID) -> None:
    admin = session.get(AdminAccount, user_id)
    if admin is None:
        raise NotFoundError("Compte d'administration introuvable.")
    if admin.is_owner:
        raise RuleViolationError(
            "Le propriétaire ne se retire pas.", code="proprietaire"
        )

    audit_service.record(
        session,
        action=AuditAction.PERMISSION,
        target_type="admin_account",
        target_label=admin.user.email,
        target_id=user_id,
        before={"job_title": admin.job_title},
    )
    session.delete(admin)
    session.flush()


# --------------------------------------------------------------------------- #
# Invitations
# --------------------------------------------------------------------------- #


def list_invitations(session: Session) -> list[AdminInvitation]:
    return list(
        session.scalars(
            select(AdminInvitation).order_by(AdminInvitation.created_at.desc())
        )
    )


def invite_admin(session: Session, payload: Any, *, invited_by: uuid.UUID) -> tuple[AdminInvitation, str]:
    """Invite une adresse à devenir administrateur.

    Le jeton n'est pas stocké en clair : la base garde son empreinte, le clair
    part dans le courriel et n'existe nulle part ailleurs.
    """
    clair, empreinte = new_opaque_token()

    invitation = AdminInvitation(
        email=payload.email,
        token_hash=empreinte,
        invited_by_admin_id=invited_by,
        expires_at=datetime.now(UTC) + timedelta(days=INVITATION_JOURS),
    )
    session.add(invitation)
    session.flush()

    audit_service.record(
        session,
        action=AuditAction.PERMISSION,
        target_type="admin_invitation",
        target_label=payload.email,
        target_id=invitation.id,
        after={"permissions": payload.permissions},
    )
    session.flush()
    return invitation, clair


def revoke_invitation(session: Session, invitation_id: uuid.UUID) -> None:
    invitation = session.get(AdminInvitation, invitation_id)
    if invitation is None:
        raise NotFoundError("Invitation introuvable.")
    session.delete(invitation)
    session.flush()
