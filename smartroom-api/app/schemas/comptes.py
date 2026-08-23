"""Schémas du domaine comptes et permissions.

Aucun schéma de sortie n'expose `password_hash` : il n'apparaît dans aucun
`…Read`, ce qui rend la fuite impossible par construction plutôt que par
vigilance.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field, SecretStr, model_validator

from app.db.enums import UserStatus
from app.schemas.common import ApiModel, Email, PermissionCode, ReadModel, TimestampedRead

# --------------------------------------------------------------------------- #
# Utilisateurs
# --------------------------------------------------------------------------- #

Password = Annotated[SecretStr, Field(min_length=10, max_length=128)]


class UserPreferenceIn(ApiModel):
    preferred_building_id: uuid.UUID | None = None
    usual_capacity_min: Annotated[int | None, Field(ge=1, le=500)] = None
    usual_capacity_max: Annotated[int | None, Field(ge=1, le=500)] = None
    email_notifications: bool = True
    in_app_notifications: bool = True
    reminder_delay_min: Annotated[int, Field(ge=5, le=1440)] = 30
    weekly_quota_hours: Annotated[int, Field(ge=0, le=168)] = 12

    @model_validator(mode="after")
    def _capacite_ordonnee(self) -> "UserPreferenceIn":
        borne_min, borne_max = self.usual_capacity_min, self.usual_capacity_max
        if (borne_min is None) != (borne_max is None):
            raise ValueError("Renseignez les deux bornes de capacité, ou aucune.")
        if borne_min is not None and borne_max is not None and borne_min > borne_max:
            raise ValueError("La capacité minimale dépasse la capacité maximale.")
        return self


class UserPreferenceRead(ReadModel):
    preferred_building_id: uuid.UUID | None
    usual_capacity_min: int | None
    usual_capacity_max: int | None
    email_notifications: bool
    in_app_notifications: bool
    reminder_delay_min: int
    weekly_quota_hours: int


class UserCreate(ApiModel):
    email: Email
    #: Reçu en clair, haché immédiatement par le service, jamais persisté tel quel.
    password: Password
    first_name: Annotated[str, Field(min_length=1, max_length=80)]
    last_name: Annotated[str, Field(min_length=1, max_length=80)]
    phone: Annotated[str | None, Field(pattern=r"^[0-9 +.()-]{6,20}$")] = None
    promotion: Annotated[str | None, Field(max_length=60)] = None
    department: Annotated[str | None, Field(max_length=60)] = None
    badge_number: Annotated[str | None, Field(max_length=20)] = None
    preferences: UserPreferenceIn | None = None


class UserUpdate(ApiModel):
    email: Email | None = None
    first_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    last_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    phone: Annotated[str | None, Field(pattern=r"^[0-9 +.()-]{6,20}$")] = None
    promotion: Annotated[str | None, Field(max_length=60)] = None
    department: Annotated[str | None, Field(max_length=60)] = None
    badge_number: Annotated[str | None, Field(max_length=20)] = None
    status: UserStatus | None = None
    preferences: UserPreferenceIn | None = None


class PasswordChange(ApiModel):
    current_password: SecretStr
    new_password: Password

    @model_validator(mode="after")
    def _mot_de_passe_different(self) -> "PasswordChange":
        if self.current_password.get_secret_value() == self.new_password.get_secret_value():
            raise ValueError("Le nouveau mot de passe doit différer de l'ancien.")
        return self


class UserRead(TimestampedRead):
    email: str
    first_name: str
    last_name: str
    phone: str | None
    promotion: str | None
    department: str | None
    badge_number: str | None
    status: UserStatus
    last_login_at: datetime | None
    preferences: UserPreferenceRead | None = None

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class UserMetrics(ReadModel):
    """Métriques calculées de l'écran A-11, jamais stockées."""

    reliability_score: int | None
    attendance_rate: float
    no_show_rate: float
    booked_hours: int
    remaining_credits_h: int
    active_bookings: int
    cancellations: int


class UserDetailRead(UserRead):
    metrics: UserMetrics | None = None


# --------------------------------------------------------------------------- #
# Permissions et comptes d'administration
# --------------------------------------------------------------------------- #


class PermissionRead(TimestampedRead):
    group_id: uuid.UUID
    code: str
    label: str
    sort_order: int


class PermissionGroupRead(TimestampedRead):
    code: str
    label: str
    sort_order: int
    permissions: list[PermissionRead] = Field(default_factory=list)


class AdminAccountCreate(ApiModel):
    """Promotion d'un utilisateur existant en administrateur."""

    user_id: uuid.UUID
    job_title: Annotated[str, Field(min_length=1, max_length=80)]
    permissions: list[PermissionCode] = Field(default_factory=list)

    @model_validator(mode="after")
    def _permissions_uniques(self) -> "AdminAccountCreate":
        if len(self.permissions) != len(set(self.permissions)):
            raise ValueError("Une permission ne peut être accordée qu'une fois.")
        return self


class AdminAccountUpdate(ApiModel):
    job_title: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    #: Liste complète : elle remplace la matrice, elle ne s'y ajoute pas.
    permissions: list[PermissionCode] | None = None


class AdminAccountRead(ReadModel):
    user_id: uuid.UUID
    job_title: str
    is_owner: bool
    last_admin_login_at: datetime | None
    created_at: datetime
    updated_at: datetime
    user: UserRead | None = None
    permissions: list[PermissionRead] = Field(default_factory=list)


class AdminInvitationCreate(ApiModel):
    email: Email
    permissions: list[PermissionCode] = Field(min_length=1)

    @model_validator(mode="after")
    def _permissions_uniques(self) -> "AdminInvitationCreate":
        if len(self.permissions) != len(set(self.permissions)):
            raise ValueError("Une permission ne peut être accordée qu'une fois.")
        return self


class AdminInvitationUpdate(ApiModel):
    """Seul le périmètre est modifiable ; l'adresse impose une nouvelle invitation."""

    permissions: list[PermissionCode] | None = None


class AdminInvitationRead(TimestampedRead):
    email: str
    sent_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    permissions: list[PermissionRead] = Field(default_factory=list)

    @property
    def is_pending(self) -> bool:
        return self.accepted_at is None and self.revoked_at is None


# --------------------------------------------------------------------------- #
# Authentification
# --------------------------------------------------------------------------- #


class LoginRequest(ApiModel):
    email: Email
    password: SecretStr


class TokenResponse(ReadModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead
    #: Renseigné seulement pour une session d'administration.
    admin: AdminAccountRead | None = None


class SessionRead(ReadModel):
    """Session courante rejouée depuis le jeton, sans réémission."""

    user: UserRead
    admin: AdminAccountRead | None = None
    permissions: list[str] = Field(default_factory=list)
