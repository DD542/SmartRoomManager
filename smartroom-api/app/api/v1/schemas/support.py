"""Schémas du support, des notifications et des statistiques."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import Field, field_validator

from app.api.v1.schemas.common import ApiModel, ReadModel
from app.db.enums import ArticleStatus, AuditAction, NotificationChannel, TicketStatus


# --------------------------------------------------------------------------- #
# Tickets
# --------------------------------------------------------------------------- #


class TicketIn(ApiModel):
    subject: Annotated[str, Field(min_length=3, max_length=160)]
    category: Annotated[str, Field(min_length=1, max_length=40)]
    body: Annotated[str, Field(min_length=3, max_length=5000)]
    room_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None


class TicketMessageIn(ApiModel):
    body: Annotated[str, Field(min_length=1, max_length=5000)]
    #: Note interne : visible du support, jamais du demandeur.
    is_internal: bool = False


class TicketMessageOut(ReadModel):
    id: uuid.UUID
    ticket_id: uuid.UUID
    body: str
    author_user_id: uuid.UUID | None
    is_from_support: bool
    is_internal: bool
    sent_at: datetime


class TicketOut(ReadModel):
    id: uuid.UUID
    reference: str
    requester_id: uuid.UUID
    requester_name: str
    subject: str
    category: str
    status: TicketStatus
    room_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    assigned_admin_id: uuid.UUID | None
    first_response_at: datetime | None
    resolved_at: datetime | None
    message_count: int
    created_at: datetime
    messages: list[TicketMessageOut] = Field(default_factory=list)


class TicketStatusIn(ApiModel):
    status: TicketStatus


class TicketAssigneeIn(ApiModel):
    admin_user_id: uuid.UUID | None = None


class ResponseTemplateOut(ReadModel):
    id: uuid.UUID
    code: str
    category: str
    label: str
    body: str


# --------------------------------------------------------------------------- #
# Base de connaissances
# --------------------------------------------------------------------------- #


class FaqCategoryOut(ReadModel):
    id: uuid.UUID
    code: str
    label: str
    icon: str | None
    sort_order: int
    article_count: int = 0


class FaqArticleIn(ApiModel):
    category_id: uuid.UUID
    slug: Annotated[str, Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=160)]
    title: Annotated[str, Field(min_length=1, max_length=160)]
    excerpt: Annotated[str, Field(min_length=1, max_length=320)]
    body: Annotated[str, Field(min_length=1)]
    status: ArticleStatus = ArticleStatus.BROUILLON


class FaqArticlePatchIn(ApiModel):
    category_id: uuid.UUID | None = None
    title: Annotated[str | None, Field(min_length=1, max_length=160)] = None
    excerpt: Annotated[str | None, Field(min_length=1, max_length=320)] = None
    body: Annotated[str | None, Field(min_length=1)] = None


class FaqArticleStatusIn(ApiModel):
    status: ArticleStatus


class FaqArticleOut(ReadModel):
    id: uuid.UUID
    category_id: uuid.UUID
    slug: str
    title: str
    excerpt: str
    body: str
    status: ArticleStatus
    view_count: int
    published_at: datetime | None


# --------------------------------------------------------------------------- #
# Chatbot
# --------------------------------------------------------------------------- #


class ChatMessageIn(ApiModel):
    message: Annotated[str, Field(min_length=1, max_length=500)]


class ChatAnswerOut(ReadModel):
    """`confidence` est exposée : un score faible explique un « je ne sais pas »."""

    intent_code: str | None
    intent_label: str | None
    answer: str
    quick_replies: list[str] = Field(default_factory=list)
    escalates_to_ticket: bool
    faq_article_id: uuid.UUID | None
    confidence: float


class ChatIntentOut(ReadModel):
    id: uuid.UUID
    code: str
    label: str
    answer: str
    quick_replies: list[str] = Field(default_factory=list)
    escalates_to_ticket: bool
    faq_article_id: uuid.UUID | None
    is_active: bool
    keywords: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Notifications et gabarits
# --------------------------------------------------------------------------- #


class NotificationOut(ReadModel):
    id: uuid.UUID
    title: str
    body: str | None
    channel: NotificationChannel
    #: Gabarit d'origine, dont l'écran tire l'action proposée.
    template_code: str | None = None
    booking_id: uuid.UUID | None
    ticket_id: uuid.UUID | None
    read_at: datetime | None
    sent_at: datetime


class NotificationReadIn(ApiModel):
    read: bool = True


class EmailTemplateOut(ReadModel):
    id: uuid.UUID
    code: str
    name: str
    trigger_label: str
    subject: str
    body: str
    is_enabled: bool
    updated_at: datetime


class EmailTemplateIn(ApiModel):
    name: Annotated[str | None, Field(min_length=1, max_length=120)] = None
    trigger_label: Annotated[str | None, Field(min_length=1, max_length=160)] = None
    subject: Annotated[str | None, Field(min_length=1, max_length=200)] = None
    body: Annotated[str | None, Field(min_length=1)] = None


class EmailTemplateStateIn(ApiModel):
    enabled: bool


class EmailPreviewIn(ApiModel):
    variables: dict[str, str] = Field(default_factory=dict)


class EmailPreviewOut(ReadModel):
    to: str
    subject: str
    body: str


class EmailVariableOut(ReadModel):
    code: str
    label: str
    sample_value: str


# --------------------------------------------------------------------------- #
# Statistiques
# --------------------------------------------------------------------------- #


class MyStatsOut(ReadModel):
    window_days: int
    total_bookings: int
    active_bookings: int
    cancelled_bookings: int
    upcoming_bookings: int
    booked_hours: float
    distinct_rooms: int
    #: `null` quand aucune réservation n'est encore écoulée : une réunion de
    #: demain n'est ni honorée ni manquée.
    attendance_rate: float | None
    no_show_rate: float | None


class PublicStatsOut(ReadModel):
    rooms: int
    buildings: int
    seats: int
    bookings_last_30_days: int


class OverviewOut(ReadModel):
    window_days: int
    bookings: int
    cancellations: int
    no_shows: int
    pending_access_requests: int
    open_tickets: int
    rooms_in_maintenance: int
    occupancy_percent: int


class OccupancyPointOut(ReadModel):
    period: str
    occupancy_percent: int
    bookings: int
    hours: float


class RoomStatsOut(ReadModel):
    room_id: uuid.UUID
    room_name: str
    building_name: str
    capacity: int
    occupancy_percent: int
    hours: float
    bookings: int
    no_shows: int


class PeakHourOut(ReadModel):
    weekday: int
    hour: int
    bookings: int
    hours: float


# --------------------------------------------------------------------------- #
# Audit
# --------------------------------------------------------------------------- #


class AuditEntryOut(ReadModel):
    id: uuid.UUID
    actor_label: str
    actor_admin_id: uuid.UUID | None
    action: AuditAction
    target_type: str
    target_label: str
    target_id: uuid.UUID | None
    diff_before: dict[str, Any] | None
    diff_after: dict[str, Any] | None
    #: `INET` côté base : psycopg rend un `IPv4Address`, que Pydantic refuse de
    #: convertir en `str` de lui-même. Le validateur le fait, sans quoi toute
    #: entrée d'audit portant une adresse — c'est-à-dire toute écriture faite
    #: depuis un navigateur — rend un 500 à la lecture.
    ip_address: str | None

    @field_validator("ip_address", mode="before")
    @classmethod
    def _adresse_en_texte(cls, valeur: object) -> str | None:
        return None if valeur is None else str(valeur)
    session_id: str | None
    flagged_at: datetime | None
    flag_reason: str | None
    occurred_at: datetime


class AuditFlagIn(ApiModel):
    flagged: bool = True
    reason: Annotated[str | None, Field(max_length=255)] = None
