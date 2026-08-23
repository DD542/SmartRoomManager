"""Modèles du domaine comptes : utilisateurs, administrateurs, permissions.

Risques N+1 et stratégies de chargement
---------------------------------------
- Vérification de permission à chaque requête d'administration : sans
  `selectin`, chaque contrôle déclencherait une requête. `AdminAccount.grants`
  et `AdminPermission.permission` sont chargées en une passe à l'ouverture de
  la session, puis conservées dans le contexte de la requête.
- Matrice A-12 : trois administrateurs × sept permissions. `selectin` sur
  `AdminAccount.grants` produit deux requêtes au total, contre vingt-deux en
  chargement paresseux.
- `User.bookings` et `User.notifications` restent paresseuses : ces collections
  croissent sans limite et ne sont jamais affichées en entier.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UuidPk, pg_enum
from app.db.enums import UserStatus

if TYPE_CHECKING:
    from app.models.parc import Building, FloorPlan
    from app.models.reservations import (
        AccessRequest,
        Booking,
        BookingEvent,
        BookingParticipant,
        ClosurePeriod,
        RecurrenceRule,
    )
    from app.models.support import (
        AuditLog,
        EmailTemplate,
        Notification,
        Ticket,
        TicketMessage,
    )

EMAIL_PATTERN = "^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$"


class User(TimestampMixin, SoftDeleteMixin, Base):
    """Annuaire des personnes. Un administrateur est un utilisateur qui porte
    en plus une ligne `admin_accounts` : il n'existe pas de colonne `role`."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(f"email ~ '{EMAIL_PATTERN}'", name="email_format"),
        CheckConstraint("btrim(first_name) <> ''", name="first_name_not_blank"),
        CheckConstraint("btrim(last_name) <> ''", name="last_name_not_blank"),
        CheckConstraint(
            "phone IS NULL OR phone ~ '^[0-9 +.()-]{6,20}$'", name="phone_format"
        ),
        CheckConstraint(
            "deleted_at IS NULL OR status = 'suspendu'", name="deleted_is_suspended"
        ),
        # Unicités partielles : une adresse redevient disponible après suppression
        # logique, ce qu'une contrainte UNIQUE simple interdirait.
        Index("uq_users_email", "email", unique=True, postgresql_where=text("deleted_at IS NULL")),
        Index(
            "uq_users_badge_number",
            "badge_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND badge_number IS NOT NULL"),
        ),
        Index(
            "idx_users_directory",
            "status",
            "department",
            "promotion",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_users_name_trgm",
            text("(first_name || ' ' || last_name) gin_trgm_ops"),
            postgresql_using="gin",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    email: Mapped[str] = mapped_column(CITEXT)
    #: bcrypt via passlib. Jamais exposé par l'API, jamais journalisé.
    password_hash: Mapped[str] = mapped_column(Text)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(20), default=None)
    promotion: Mapped[str | None] = mapped_column(String(60), default=None)
    department: Mapped[str | None] = mapped_column(String(60), default=None)
    badge_number: Mapped[str | None] = mapped_column(String(20), default=None)
    status: Mapped[UserStatus] = mapped_column(
        pg_enum(UserStatus, "user_status"), server_default=text("'actif'"), default=UserStatus.ACTIF
    )
    last_login_at: Mapped[datetime | None] = mapped_column(default=None)

    preferences: Mapped["UserPreference | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )
    admin_account: Mapped["AdminAccount | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )
    bookings: Mapped[list["Booking"]] = relationship(back_populates="owner", lazy="select")
    participations: Mapped[list["BookingParticipant"]] = relationship(back_populates="user")
    booking_events: Mapped[list["BookingEvent"]] = relationship(back_populates="actor")
    recurrence_rules: Mapped[list["RecurrenceRule"]] = relationship(back_populates="owner")
    access_requests: Mapped[list["AccessRequest"]] = relationship(back_populates="requester")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="requester")
    ticket_messages: Mapped[list["TicketMessage"]] = relationship(back_populates="author")
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True, lazy="select"
    )

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"

    @property
    def is_admin(self) -> bool:
        """Être administrateur, c'est porter une ligne `admin_accounts`."""
        return self.admin_account is not None


class UserPreference(TimestampMixin, Base):
    """Extension 1–1 facultative : sortie de `users`, lue à chaque requête."""

    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(
            "(usual_capacity_min IS NULL AND usual_capacity_max IS NULL)"
            " OR (usual_capacity_min IS NOT NULL AND usual_capacity_max IS NOT NULL"
            "     AND usual_capacity_min >= 1 AND usual_capacity_min <= usual_capacity_max)",
            name="capacity",
        ),
        CheckConstraint(
            "reminder_delay_min BETWEEN 5 AND 1440", name="reminder"
        ),
        CheckConstraint("weekly_quota_hours BETWEEN 0 AND 168", name="quota"),
        Index(
            "idx_user_preferences_building",
            "preferred_building_id",
            postgresql_where=text("preferred_building_id IS NOT NULL"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_user_preferences_user"),
        primary_key=True,
    )
    #: Pondère le critère « bâtiment » du moteur de recommandation.
    preferred_building_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "buildings.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_user_preferences_building",
        ),
        default=None,
    )
    usual_capacity_min: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    usual_capacity_max: Mapped[int | None] = mapped_column(SmallInteger, default=None)
    email_notifications: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    in_app_notifications: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    reminder_delay_min: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("30"), default=30
    )
    #: Quota individuel : surcharge `booking_rules.weekly_quota_hours`.
    weekly_quota_hours: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("12"), default=12
    )

    user: Mapped["User"] = relationship(back_populates="preferences")
    preferred_building: Mapped["Building | None"] = relationship(back_populates="user_preferences")


class AdminAccount(TimestampMixin, Base):
    """Spécialisation 1–1 de `User`."""

    __tablename__ = "admin_accounts"
    __table_args__ = (
        CheckConstraint("btrim(job_title) <> ''", name="job_title"),
        # Un seul propriétaire : l'unicité porte sur la valeur `true`.
        Index(
            "uq_admin_accounts_single_owner",
            "is_owner",
            unique=True,
            postgresql_where=text("is_owner"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_admin_accounts_user"),
        primary_key=True,
    )
    job_title: Mapped[str] = mapped_column(String(80))
    #: Ses permissions ne sont pas révocables : les retirer fermerait la
    #: configuration du système pour tout le monde.
    is_owner: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    #: Session d'administration, distincte de `User.last_login_at`.
    last_admin_login_at: Mapped[datetime | None] = mapped_column(default=None)

    user: Mapped["User"] = relationship(back_populates="admin_account", lazy="joined")
    grants: Mapped[list["AdminPermission"]] = relationship(
        back_populates="admin",
        foreign_keys="AdminPermission.admin_user_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )
    permissions: Mapped[list["Permission"]] = relationship(
        secondary="admin_permissions",
        primaryjoin="AdminAccount.user_id == AdminPermission.admin_user_id",
        secondaryjoin="Permission.id == AdminPermission.permission_id",
        viewonly=True,
        lazy="selectin",
    )
    invitations_sent: Mapped[list["AdminInvitation"]] = relationship(back_populates="invited_by")
    uploaded_plans: Mapped[list["FloorPlan"]] = relationship(back_populates="uploaded_by")
    created_bookings: Mapped[list["Booking"]] = relationship(back_populates="created_by_admin")
    decided_requests: Mapped[list["AccessRequest"]] = relationship(back_populates="decided_by")
    created_closures: Mapped[list["ClosurePeriod"]] = relationship(back_populates="created_by")
    assigned_tickets: Mapped[list["Ticket"]] = relationship(back_populates="assigned_admin")
    edited_templates: Mapped[list["EmailTemplate"]] = relationship(back_populates="updated_by")
    audit_entries: Mapped[list["AuditLog"]] = relationship(back_populates="actor")

    def has_permission(self, code: str) -> bool:
        """Le propriétaire détient tout, sans dépendre de la matrice."""
        return self.is_owner or any(grant.permission.code == code for grant in self.grants)


class PermissionGroup(TimestampMixin, Base):
    __tablename__ = "permission_groups"
    __table_args__ = (
        UniqueConstraint("code", name="uq_permission_groups_code"),
        CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name="code_format"),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(80))
    sort_order: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"), default=0)

    permissions: Mapped[list["Permission"]] = relationship(
        back_populates="group", order_by="Permission.sort_order", lazy="selectin"
    )


class Permission(TimestampMixin, Base):
    """Référentiel fermé des sept droits applicatifs."""

    __tablename__ = "permissions"
    __table_args__ = (
        UniqueConstraint("code", name="uq_permissions_code"),
        CheckConstraint("code ~ '^[a-z]+\\.[a-z]+$'", name="code_format"),
        Index("idx_permissions_group", "group_id", "sort_order"),
    )

    id: Mapped[UuidPk]
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "permission_groups.id",
            ondelete="RESTRICT",
            onupdate="CASCADE",
            name="fk_permissions_group",
        )
    )
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"), default=0)

    group: Mapped["PermissionGroup"] = relationship(back_populates="permissions", lazy="joined")
    grants: Mapped[list["AdminPermission"]] = relationship(back_populates="permission")


class AdminPermission(TimestampMixin, Base):
    """Matrice permissions × administrateurs. Suppression physique."""

    __tablename__ = "admin_permissions"
    __table_args__ = (
        Index("idx_admin_permissions_permission", "permission_id", "admin_user_id"),
        Index(
            "idx_admin_permissions_granted_by",
            "granted_by_admin_id",
            postgresql_where=text("granted_by_admin_id IS NOT NULL"),
        ),
    )

    admin_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_admin_permissions_admin",
        ),
        primary_key=True,
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "permissions.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_admin_permissions_permission",
        ),
        primary_key=True,
    )
    #: L'octroi survit au départ de l'administrateur qui l'a accordé.
    granted_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_admin_permissions_granted_by",
        ),
        default=None,
    )
    granted_at: Mapped[datetime] = mapped_column(server_default=text("now()"), default=None)

    admin: Mapped["AdminAccount"] = relationship(
        back_populates="grants", foreign_keys=[admin_user_id]
    )
    granted_by: Mapped["AdminAccount | None"] = relationship(foreign_keys=[granted_by_admin_id])
    permission: Mapped["Permission"] = relationship(back_populates="grants", lazy="joined")


class AdminInvitation(TimestampMixin, Base):
    __tablename__ = "admin_invitations"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_admin_invitations_token"),
        CheckConstraint(f"email ~ '{EMAIL_PATTERN}'", name="email_format"),
        CheckConstraint("expires_at > sent_at", name="expiry"),
        CheckConstraint(
            "accepted_at IS NULL OR revoked_at IS NULL", name="final_state"
        ),
        # Une seule invitation en cours par adresse ; les closes s'empilent.
        Index(
            "uq_admin_invitations_pending",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL AND revoked_at IS NULL"),
        ),
        Index("idx_admin_invitations_invited_by", "invited_by_admin_id", text("sent_at DESC")),
    )

    id: Mapped[UuidPk]
    email: Mapped[str] = mapped_column(CITEXT)
    #: Le jeton en clair n'existe que dans l'e-mail envoyé.
    token_hash: Mapped[str] = mapped_column(Text)
    invited_by_admin_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="RESTRICT",
            onupdate="CASCADE",
            name="fk_admin_invitations_invited_by",
        )
    )
    sent_at: Mapped[datetime] = mapped_column(server_default=text("now()"), default=None)
    expires_at: Mapped[datetime]
    accepted_at: Mapped[datetime | None] = mapped_column(default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)

    invited_by: Mapped["AdminAccount"] = relationship(back_populates="invitations_sent")
    permissions: Mapped[list["Permission"]] = relationship(
        secondary="admin_invitation_permissions", viewonly=True, lazy="selectin"
    )
    permission_grants: Mapped[list["AdminInvitationPermission"]] = relationship(
        back_populates="invitation", cascade="all, delete-orphan", passive_deletes=True
    )


class AdminInvitationPermission(TimestampMixin, Base):
    """Périmètre choisi dès l'invitation : le compte arrive avec ses droits."""

    __tablename__ = "admin_invitation_permissions"
    __table_args__ = (Index("idx_admin_invitation_permissions_permission", "permission_id"),)

    invitation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "admin_invitations.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_admin_invitation_permissions_invitation",
        ),
        primary_key=True,
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "permissions.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_admin_invitation_permissions_permission",
        ),
        primary_key=True,
    )

    invitation: Mapped["AdminInvitation"] = relationship(back_populates="permission_grants")
    permission: Mapped["Permission"] = relationship(lazy="joined")
