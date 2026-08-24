"""Schémas des comptes, des préférences et de la matrice de permissions."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field

from app.api.v1.schemas.common import ApiModel, ReadModel
from app.db.enums import UserStatus

Email = Annotated[str, Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=255)]
PermissionCode = Annotated[str, Field(pattern=r"^[a-z]+\.[a-z]+$", max_length=40)]


class PreferencesIn(ApiModel):
    preferred_building_id: uuid.UUID | None = None
    usual_capacity_min: Annotated[int | None, Field(ge=1, le=500)] = None
    usual_capacity_max: Annotated[int | None, Field(ge=1, le=500)] = None
    email_notifications: bool = True
    in_app_notifications: bool = True
    reminder_delay_min: Annotated[int, Field(ge=5, le=1440)] = 30


class PreferencesOut(ReadModel):
    preferred_building_id: uuid.UUID | None
    usual_capacity_min: int | None
    usual_capacity_max: int | None
    email_notifications: bool
    in_app_notifications: bool
    reminder_delay_min: int
    weekly_quota_hours: int


class ProfileIn(ApiModel):
    """Ce qu'un utilisateur peut changer lui-même.

    L'adresse n'y figure pas : elle identifie le compte, et la changer sans
    vérification permettrait de détourner une session.
    """

    first_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    last_name: Annotated[str | None, Field(min_length=1, max_length=80)] = None
    phone: Annotated[str | None, Field(max_length=20)] = None
    promotion: Annotated[str | None, Field(max_length=60)] = None
    department: Annotated[str | None, Field(max_length=60)] = None


class UserOut(ReadModel):
    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    phone: str | None
    promotion: str | None
    department: str | None
    badge_number: str | None
    status: UserStatus
    is_admin: bool = False
    last_login_at: datetime | None
    preferences: PreferencesOut | None = None


class UserMetricsOut(ReadModel):
    """Métriques calculées, jamais stockées : elles bougent à chaque écriture."""

    active_bookings: int
    cancellations: int
    no_shows: int
    attendance_rate: float | None
    booked_hours_this_week: float
    weekly_quota_hours: int
    remaining_credits_h: float


class UserDetailOut(UserOut):
    metrics: UserMetricsOut | None = None


class UserStatusIn(ApiModel):
    status: UserStatus
    reason: Annotated[str, Field(min_length=3, max_length=255)]


class QuotaIn(ApiModel):
    weekly_quota_hours: Annotated[int, Field(ge=1, le=168)]


class PermissionOut(ReadModel):
    id: uuid.UUID
    code: str
    label: str


class PermissionGroupOut(ReadModel):
    id: uuid.UUID
    code: str
    label: str
    permissions: list[PermissionOut] = Field(default_factory=list)


class AdminAccountOut(ReadModel):
    user_id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    job_title: str
    is_owner: bool
    last_admin_login_at: datetime | None
    permissions: list[str] = Field(default_factory=list)


class AdminPromoteIn(ApiModel):
    user_id: uuid.UUID
    job_title: Annotated[str, Field(min_length=1, max_length=80)]
    permissions: list[PermissionCode] = Field(default_factory=list, max_length=20)


class PermissionsIn(ApiModel):
    #: Liste complète : elle remplace la matrice, elle ne s'y ajoute pas.
    permissions: list[PermissionCode] = Field(default_factory=list, max_length=20)


class InvitationIn(ApiModel):
    email: Email
    permissions: Annotated[list[PermissionCode], Field(min_length=1, max_length=20)]


class AdminInvitationOut(ReadModel):
    id: uuid.UUID
    email: str
    sent_at: datetime
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    permissions: list[str] = Field(default_factory=list)
