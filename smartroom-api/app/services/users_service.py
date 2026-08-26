"""Comptes utilisateurs, comptes d'administration et invitations.

Un utilisateur modifie son propre profil ; l'administration gère les autres.
Les deux chemins passent par ce module, mais jamais par la même route : c'est
la garde de permission qui les sépare, pas un paramètre.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session, selectinload

from app.core import storage
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
    RefreshToken,
    User,
    UserPreference,
)
from app.services import audit_service, auth_service

#: Champs de tri acceptés des comptes d'administration.
TRI_ADMINS: dict[str, Any] = {
    "last_name": User.last_name,
    "email": User.email,
    "job_title": AdminAccount.job_title,
}


#: Quota appliqué à un compte sans ligne de préférences. Aligné sur le défaut
#: du modèle : deux valeurs divergentes feraient afficher des crédits restants
#: différents selon l'écran consulté.
QUOTA_PAR_DEFAUT = 12

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


#: Types d'image acceptés pour une photo de profil.
#:
#: Sous-ensemble strict de ceux du magasin de médias : un PDF fait un plan
#: d'étage valable, jamais un portrait, et le SVG est écarté parce qu'il porte
#: du script — servi depuis le domaine de l'application, il s'exécuterait avec
#: ses droits.
TYPES_AVATAR = frozenset({"image/png", "image/jpeg", "image/webp"})


def set_avatar(
    session: Session, user_id: uuid.UUID, *, contenu: bytes, content_type: str
) -> User:
    """Remplace la photo de profil, et efface la précédente.

    L'ancienne est retirée du disque : la conserver accumulerait un fichier par
    changement, sans que rien ne les référence plus jamais.
    """
    if content_type not in TYPES_AVATAR:
        raise RuleViolationError(
            "Format refusé : déposez une image PNG, JPEG ou WebP.",
            code="format_invalide",
        )

    compte = _charger(session, user_id)
    extension = storage.verifier(content_type, len(contenu))
    ancienne = compte.avatar_url
    compte.avatar_url = storage.enregistrer("avatars", contenu, extension)
    if ancienne:
        storage.supprimer(ancienne)
    session.flush()
    return compte


def remove_avatar(session: Session, user_id: uuid.UUID) -> User:
    """Retire la photo. L'écran retombe sur les initiales, son état par défaut."""
    compte = _charger(session, user_id)
    if compte.avatar_url:
        storage.supprimer(compte.avatar_url)
        compte.avatar_url = None
        session.flush()
    return compte


def active_sessions(session: Session, user_id: uuid.UUID) -> list[RefreshToken]:
    """Sessions ouvertes du compte, la plus récente en tête.

    Une session est une *famille* de jetons, pas un jeton : chaque
    rafraîchissement en émet un nouveau et consomme le précédent, si bien qu'un
    même navigateur en produit des dizaines. Les compter un par un afficherait
    « 47 appareils connectés » à qui n'en a qu'un.
    """
    lignes = session.scalars(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(UTC),
        )
        .order_by(RefreshToken.created_at.desc())
    ).all()

    familles: dict[uuid.UUID, RefreshToken] = {}
    for ligne in lignes:
        familles.setdefault(ligne.family_id, ligne)
    return list(familles.values())


def revoke_other_sessions(
    session: Session, user_id: uuid.UUID, *, keep_family: uuid.UUID | None
) -> int:
    """Ferme toutes les sessions sauf celle qui appelle.

    Garder la sienne est délibéré : se déconnecter soi-même en fermant les
    autres oblige à se reconnecter pour vérifier que l'ordre a été suivi, et
    fait douter de son effet.
    """
    ouvertes = session.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
    ).all()

    maintenant = datetime.now(UTC)
    fermees = {
        ligne.family_id
        for ligne in ouvertes
        if keep_family is None or ligne.family_id != keep_family
    }
    for ligne in ouvertes:
        if ligne.family_id in fermees:
            ligne.revoked_at = maintenant

    session.flush()
    return len(fermees)


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
        else QUOTA_PAR_DEFAUT
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


def metrics_for(
    session: Session, user_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[str, Any]]:
    """Métriques de plusieurs comptes, en deux requêtes quel que soit le nombre.

    L'annuaire d'administration affiche une colonne « réservations » par ligne.
    Appeler `user_metrics` par ligne ferait une requête par utilisateur affiché,
    et cent lignes coûteraient deux cents allers-retours.

    Les comptes sans aucune réservation ne sortent pas des agrégats : ils sont
    complétés à zéro, faute de quoi l'écran afficherait un vide là où la réponse
    est « aucune ».
    """
    if not user_ids:
        return {}

    maintenant = datetime.now(UTC)
    lundi = maintenant - timedelta(days=maintenant.weekday())
    debut_semaine = lundi.replace(hour=0, minute=0, second=0, microsecond=0)
    ecoule = Booking.time_range.op("<<")(Range(maintenant, None, bounds="[)"))

    lignes = session.execute(
        select(
            Booking.owner_id,
            func.count().filter(Booking.status != BookingStatus.ANNULEE),
            func.count().filter(Booking.status == BookingStatus.ANNULEE),
            func.count().filter(
                Booking.checked_in_at.is_(None)
                & (Booking.status != BookingStatus.ANNULEE)
                & ecoule
            ),
            func.count().filter((Booking.status != BookingStatus.ANNULEE) & ecoule),
            # `filter` porte sur l'agrégat et non sur l'expression sommée :
            # SQLAlchemy ne l'expose que sur les fonctions d'agrégation, et
            # l'appliquer plus bas lève au moment de compiler la requête.
            func.coalesce(
                func.sum(
                    func.extract(
                        "epoch",
                        func.upper(Booking.time_range) - func.lower(Booking.time_range),
                    )
                    / 3600
                ).filter(
                    (Booking.status != BookingStatus.ANNULEE)
                    & Booking.time_range.op("&&")(Range(debut_semaine, None, bounds="[)"))
                ),
                0,
            ),
        )
        .where(Booking.owner_id.in_(user_ids), Booking.deleted_at.is_(None))
        .group_by(Booking.owner_id)
    ).all()

    quotas = dict(
        session.execute(
            select(UserPreference.user_id, UserPreference.weekly_quota_hours).where(
                UserPreference.user_id.in_(user_ids)
            )
        ).all()
    )

    mesures: dict[uuid.UUID, dict[str, Any]] = {}
    for ligne in lignes:
        quota = quotas.get(ligne[0], QUOTA_PAR_DEFAUT)
        ecoulees = ligne[4] or 0
        honorees = ecoulees - (ligne[3] or 0)
        heures = float(ligne[5] or 0)
        mesures[ligne[0]] = {
            "active_bookings": ligne[1] or 0,
            "cancellations": ligne[2] or 0,
            "no_shows": ligne[3] or 0,
            "attendance_rate": round(honorees / ecoulees, 4) if ecoulees else None,
            "booked_hours_this_week": round(heures, 2),
            "weekly_quota_hours": quota,
            "remaining_credits_h": max(0, round(quota - heures, 2)),
        }

    for identifiant in user_ids:
        if identifiant not in mesures:
            quota = quotas.get(identifiant, QUOTA_PAR_DEFAUT)
            mesures[identifiant] = {
                "active_bookings": 0,
                "cancellations": 0,
                "no_shows": 0,
                "attendance_rate": None,
                "booked_hours_this_week": 0.0,
                "weekly_quota_hours": quota,
                "remaining_credits_h": float(quota),
            }
    return mesures


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
    return paginate(session, requete, params, colonnes=TRI_ADMINS)


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
