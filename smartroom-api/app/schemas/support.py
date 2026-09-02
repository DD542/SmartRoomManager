"""Schémas du domaine support et traçabilité."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import Field, model_validator

from app.db.enums import ArticleStatus, AuditAction, NotificationChannel, TicketStatus
from app.schemas.common import ApiModel, Email, ReadModel, Slug, TimestampedRead
from app.schemas.comptes import UserRead

#: Variables autorisées dans les modèles d'e-mails, image du référentiel en base.
TEMPLATE_VARIABLES = frozenset(
    {"prenom", "salle", "batiment", "date", "creneau", "code_acces", "lien_reservation"}
)

_VARIABLE_PATTERN = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def variables_inconnues(texte: str) -> list[str]:
    """Variables citées par un modèle mais absentes du référentiel."""
    employees = _VARIABLE_PATTERN.findall(texte or "")
    return sorted({nom for nom in employees if nom not in TEMPLATE_VARIABLES})


# --------------------------------------------------------------------------- #
# Tickets
# --------------------------------------------------------------------------- #


class TicketCreate(ApiModel):
    subject: Annotated[str, Field(min_length=3, max_length=180)]
    category: Annotated[str, Field(min_length=1, max_length=40)]
    body: Annotated[str, Field(min_length=3)]
    room_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None


class TicketUpdate(ApiModel):
    status: TicketStatus | None = None
    assigned_admin_id: uuid.UUID | None = None
    category: Annotated[str | None, Field(min_length=1, max_length=40)] = None


class TicketMessageCreate(ApiModel):
    body: Annotated[str, Field(min_length=1)]
    #: Une note interne reste dans le fil mais n'est jamais envoyée au demandeur.
    is_internal: bool = False
    #: Clôt le ticket dans le même geste que la réponse.
    resolve: bool = False

    @model_validator(mode="after")
    def _note_interne_ne_resout_pas(self) -> "TicketMessageCreate":
        if self.is_internal and self.resolve:
            raise ValueError(
                "Une note interne ne peut pas résoudre le ticket à elle seule."
            )
        return self


class TicketMessageRead(TimestampedRead):
    ticket_id: uuid.UUID
    author_user_id: uuid.UUID | None
    is_from_support: bool
    is_internal: bool
    body: str
    sent_at: datetime


class TicketRead(TimestampedRead):
    reference: str
    requester_id: uuid.UUID
    room_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    subject: str
    category: str
    status: TicketStatus
    assigned_admin_id: uuid.UUID | None
    first_response_at: datetime | None
    resolved_at: datetime | None
    requester: UserRead | None = None


class TicketDetailRead(TicketRead):
    messages: list[TicketMessageRead] = Field(default_factory=list)


class TicketResponseTemplateRead(TimestampedRead):
    code: str
    category: str
    label: str
    body: str
    is_active: bool


# --------------------------------------------------------------------------- #
# Base de connaissances
# --------------------------------------------------------------------------- #

#: Seuil de publication, aligné sur `ck_faq_articles_publishable`.
LONGUEUR_MIN_PUBLICATION = 40


class FaqCategoryRead(TimestampedRead):
    code: str
    label: str
    icon: str | None
    sort_order: int
    article_count: int = 0


class FaqArticleCreate(ApiModel):
    category_id: uuid.UUID
    slug: Slug
    title: Annotated[str, Field(min_length=3, max_length=180)]
    excerpt: Annotated[str | None, Field(max_length=255)] = None
    body: Annotated[str, Field(min_length=1)]
    related_article_ids: list[uuid.UUID] = Field(default_factory=list)


class FaqArticleUpdate(ApiModel):
    category_id: uuid.UUID | None = None
    slug: Slug | None = None
    title: Annotated[str | None, Field(min_length=3, max_length=180)] = None
    excerpt: Annotated[str | None, Field(max_length=255)] = None
    body: Annotated[str | None, Field(min_length=1)] = None
    related_article_ids: list[uuid.UUID] | None = None


class FaqArticleStatusUpdate(ApiModel):
    status: ArticleStatus
    body: Annotated[str | None, Field(min_length=1)] = None

    @model_validator(mode="after")
    def _publication_possible(self) -> "FaqArticleStatusUpdate":
        # Contrôle purement structurel quand le corps accompagne la demande ;
        # sinon la base tranche via ck_faq_articles_publishable.
        if (
            self.status is ArticleStatus.PUBLIE
            and self.body is not None
            and len(self.body.strip()) < LONGUEUR_MIN_PUBLICATION
        ):
            raise ValueError(
                f"Un article publié doit compter au moins {LONGUEUR_MIN_PUBLICATION} caractères."
            )
        return self


class FaqArticleRead(TimestampedRead):
    category_id: uuid.UUID
    slug: str
    title: str
    excerpt: str
    body: str
    status: ArticleStatus
    view_count: int
    published_at: datetime | None


class ChatbotIntentRead(TimestampedRead):
    code: str
    label: str
    answer: str
    quick_replies: list[str] = Field(default_factory=list)
    escalates_to_ticket: bool
    faq_article_id: uuid.UUID | None
    is_active: bool
    keywords: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Notifications
# --------------------------------------------------------------------------- #


class NotificationRead(TimestampedRead):
    user_id: uuid.UUID
    channel: NotificationChannel
    title: str
    body: str | None
    booking_id: uuid.UUID | None
    ticket_id: uuid.UUID | None
    read_at: datetime | None
    sent_at: datetime


class NotificationMarkRead(ApiModel):
    """Marquage en lot ; une liste vide marque tout comme lu."""

    notification_ids: list[uuid.UUID] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Modèles d'e-mails
# --------------------------------------------------------------------------- #


class EmailTemplateVariableRead(TimestampedRead):
    code: str
    label: str
    sample_value: str


class EmailTemplateCreate(ApiModel):
    code: Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]*$", max_length=40)]
    name: Annotated[str, Field(min_length=1, max_length=120)]
    trigger_label: Annotated[str, Field(min_length=1, max_length=180)]
    subject: Annotated[str, Field(min_length=1, max_length=255)]
    body: Annotated[str, Field(min_length=1)]
    is_enabled: bool = True

    @model_validator(mode="after")
    def _variables_connues(self) -> "EmailTemplateCreate":
        inconnues = variables_inconnues(self.subject) + variables_inconnues(self.body)
        if inconnues:
            raise ValueError(
                f"Variable inconnue : {{{{{inconnues[0]}}}}}. "
                "Elle ne serait pas remplacée à l'envoi."
            )
        return self


class EmailTemplateUpdate(ApiModel):
    subject: Annotated[str | None, Field(min_length=1, max_length=255)] = None
    body: Annotated[str | None, Field(min_length=1)] = None
    is_enabled: bool | None = None

    @model_validator(mode="after")
    def _variables_connues(self) -> "EmailTemplateUpdate":
        inconnues = variables_inconnues(self.subject or "") + variables_inconnues(
            self.body or ""
        )
        if inconnues:
            raise ValueError(
                f"Variable inconnue : {{{{{inconnues[0]}}}}}. "
                "Elle ne serait pas remplacée à l'envoi."
            )
        return self


class EmailTemplateRead(TimestampedRead):
    code: str
    name: str
    trigger_label: str
    subject: str
    body: str
    is_enabled: bool


class EmailTemplateTest(ApiModel):
    email: Email


class EmailTemplatePreview(ReadModel):
    """Rendu avec le jeu d'exemple : mot pour mot ce que recevra l'utilisateur."""

    subject: str
    body: str


# --------------------------------------------------------------------------- #
# Journal d'audit
# --------------------------------------------------------------------------- #


class AuditLogRead(TimestampedRead):
    actor_admin_id: uuid.UUID | None
    actor_label: str
    action: AuditAction
    target_type: str
    target_id: uuid.UUID | None
    target_label: str
    diff_before: dict[str, Any] | None
    diff_after: dict[str, Any] | None
    ip_address: str | None
    user_agent: str | None
    session_id: str | None
    flagged_at: datetime | None
    flag_reason: str | None
    occurred_at: datetime


class AuditLogFlag(ApiModel):
    """Un signalement s'ajoute au journal : il n'efface et ne modifie rien."""

    reason: Annotated[str, Field(min_length=3, max_length=255)]


class AuditSearchParams(ApiModel):
    period: Annotated[str, Field(pattern=r"^(24h|7j|30j|tout)$")] = "7j"
    author_id: uuid.UUID | None = None
    action: AuditAction | None = None
    query: Annotated[str | None, Field(max_length=120)] = None


# --------------------------------------------------------------------------- #
# Statistiques
# --------------------------------------------------------------------------- #


class OccupancyPoint(ReadModel):
    occupancy_date: datetime
    hour_of_day: int
    booking_count: int
    booked_minutes: float


class RoomOccupancyRead(ReadModel):
    room_id: uuid.UUID
    room_name: str
    building_name: str
    booking_count: int
    booked_minutes: float
    open_minutes: float
    occupancy_rate: float | None
    no_show_rate: float


class DashboardRead(ReadModel):
    occupancy_rate: float
    period_bookings: int
    pending_requests: int
    resolved_requests: int
    no_show_rate: float
    trend: list[OccupancyPoint] = Field(default_factory=list)
    heatmap: list[OccupancyPoint] = Field(default_factory=list)
