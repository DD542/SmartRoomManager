"""Modèles du domaine support : tickets, base de connaissances, chatbot,
notifications, modèles d'e-mails, journal d'audit.

Risques N+1 et stratégies de chargement
---------------------------------------
- File des tickets (A-13) : chaque ligne affiche le demandeur et la salle.
  `Ticket.requester` et `Ticket.room` sont en `selectin` — deux requêtes pour la
  page entière.
- Fil d'un ticket : `Ticket.messages` reste paresseuse et n'est chargée qu'à
  l'ouverture du détail, avec `TicketMessage.author` en `joined` puisque chaque
  message affiche son auteur.
- Journal d'audit : `AuditLog.actor` est en `selectin`, mais `actor_label` suffit
  à l'affichage — la relation ne sert qu'au filtre par auteur, et une entrée dont
  le compte a disparu reste lisible sans elle.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UuidPk, pg_enum
from app.db.enums import ArticleStatus, AuditAction, NotificationChannel, TicketStatus

if TYPE_CHECKING:
    from app.models.comptes import AdminAccount, User
    from app.models.parc import Room
    from app.models.rag import FaqFragment
    from app.models.reservations import Booking


class Ticket(TimestampMixin, Base):
    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("reference", name="uq_tickets_reference"),
        CheckConstraint("reference ~ '^#?[0-9]{1,10}$'", name="reference_format"),
        CheckConstraint("btrim(subject) <> ''", name="subject_not_blank"),
        CheckConstraint(
            "(status IN ('resolu', 'ferme')) = (resolved_at IS NOT NULL)",
            name="resolved",
        ),
        Index("idx_tickets_queue", "status", text("updated_at DESC")),
        Index("idx_tickets_requester", "requester_id", text("created_at DESC")),
        Index(
            "idx_tickets_room", "room_id", postgresql_where=text("room_id IS NOT NULL")
        ),
        Index(
            "idx_tickets_booking",
            "booking_id",
            postgresql_where=text("booking_id IS NOT NULL"),
        ),
        Index(
            "idx_tickets_assigned_admin",
            "assigned_admin_id",
            postgresql_where=text("assigned_admin_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    #: Référence communiquée au demandeur : « #152 ».
    reference: Mapped[str] = mapped_column(String(16))
    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="RESTRICT",
            onupdate="CASCADE",
            name="fk_tickets_requester",
        )
    )
    subject: Mapped[str] = mapped_column(String(180))
    category: Mapped[str] = mapped_column(String(40))
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "rooms.id", ondelete="SET NULL", onupdate="CASCADE", name="fk_tickets_room"
        ),
        default=None,
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "bookings.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_tickets_booking",
        ),
        default=None,
    )
    status: Mapped[TicketStatus] = mapped_column(
        pg_enum(TicketStatus, "ticket_status"),
        server_default=text("'ouvert'"),
        default=TicketStatus.OUVERT,
    )
    assigned_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_tickets_assigned_admin",
        ),
        default=None,
    )
    first_response_at: Mapped[datetime | None] = mapped_column(default=None)
    resolved_at: Mapped[datetime | None] = mapped_column(default=None)

    requester: Mapped["User"] = relationship(back_populates="tickets", lazy="selectin")
    room: Mapped["Room | None"] = relationship(
        back_populates="tickets", lazy="selectin"
    )
    booking: Mapped["Booking | None"] = relationship(back_populates="tickets")
    assigned_admin: Mapped["AdminAccount | None"] = relationship(
        back_populates="assigned_tickets"
    )
    messages: Mapped[list["TicketMessage"]] = relationship(
        back_populates="ticket",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TicketMessage.sent_at",
        lazy="select",
    )
    notifications: Mapped[list["Notification"]] = relationship(back_populates="ticket")


class TicketMessage(TimestampMixin, Base):
    __tablename__ = "ticket_messages"
    __table_args__ = (
        CheckConstraint("btrim(body) <> ''", name="body_not_blank"),
        # Seul le support prend des notes internes.
        CheckConstraint(
            "NOT is_internal OR is_from_support", name="internal_is_support"
        ),
        Index("idx_ticket_messages_ticket", "ticket_id", "sent_at"),
        # Fil visible du demandeur : les notes internes en sont exclues.
        Index(
            "idx_ticket_messages_public",
            "ticket_id",
            "sent_at",
            postgresql_where=text("NOT is_internal"),
        ),
    )

    id: Mapped[UuidPk]
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "tickets.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_ticket_messages_ticket",
        )
    )
    body: Mapped[str] = mapped_column(Text)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_ticket_messages_author",
        ),
        default=None,
    )
    is_from_support: Mapped[bool] = mapped_column(
        server_default=text("false"), default=False
    )
    #: Note interne : visible du support seul, jamais envoyée au demandeur.
    is_internal: Mapped[bool] = mapped_column(
        server_default=text("false"), default=False
    )
    sent_at: Mapped[datetime] = mapped_column(
        server_default=text("now()"), default=None
    )

    ticket: Mapped["Ticket"] = relationship(back_populates="messages")
    author: Mapped["User | None"] = relationship(
        back_populates="ticket_messages", lazy="joined"
    )


class TicketResponseTemplate(TimestampMixin, Base):
    """Réponses types insérables dans le fil d'un ticket."""

    __tablename__ = "ticket_response_templates"
    __table_args__ = (
        UniqueConstraint("code", name="uq_ticket_response_templates_code"),
        CheckConstraint("btrim(body) <> ''", name="body_not_blank"),
        Index(
            "idx_ticket_response_templates_category",
            "category",
            "label",
            postgresql_where=text("is_active"),
        ),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    category: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(server_default=text("true"), default=True)


class FaqCategory(TimestampMixin, Base):
    __tablename__ = "faq_categories"
    __table_args__ = (
        UniqueConstraint("code", name="uq_faq_categories_code"),
        CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name="code_format"),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(80))
    icon: Mapped[str | None] = mapped_column(String(40), default=None)
    sort_order: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("0"), default=0
    )

    articles: Mapped[list["FaqArticle"]] = relationship(back_populates="category")


class FaqArticle(TimestampMixin, Base):
    __tablename__ = "faq_articles"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_faq_articles_slug"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
        CheckConstraint("view_count >= 0", name="views"),
        CheckConstraint(
            "(status = 'publie') = (published_at IS NOT NULL)", name="published"
        ),
        # Un article trop court ne peut pas être publié.
        CheckConstraint(
            "status <> 'publie' OR length(btrim(body)) >= 40", name="publishable"
        ),
        Index(
            "idx_faq_articles_published",
            "category_id",
            text("view_count DESC"),
            postgresql_where=text("status = 'publie'"),
        ),
        Index("idx_faq_articles_category", "category_id"),
        Index(
            "idx_faq_articles_search_trgm",
            text("(title || ' ' || excerpt) gin_trgm_ops"),
            postgresql_using="gin",
        ),
    )

    id: Mapped[UuidPk]
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "faq_categories.id",
            ondelete="RESTRICT",
            onupdate="CASCADE",
            name="fk_faq_articles_category",
        )
    )
    slug: Mapped[str] = mapped_column(String(160))
    title: Mapped[str] = mapped_column(String(180))
    excerpt: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[ArticleStatus] = mapped_column(
        pg_enum(ArticleStatus, "article_status"),
        server_default=text("'brouillon'"),
        default=ArticleStatus.BROUILLON,
    )
    #: Compteur dénormalisé : information indicative, pas une agrégation.
    view_count: Mapped[int] = mapped_column(server_default=text("0"), default=0)
    published_at: Mapped[datetime | None] = mapped_column(default=None)

    category: Mapped["FaqCategory"] = relationship(
        back_populates="articles", lazy="joined"
    )
    #: Fragments vectorisés (`app/models/rag.py`). Paresseuse : aucun écran
    #: n'affiche les fragments, seule l'indexation les manipule.
    fragments: Mapped[list["FaqFragment"]] = relationship(
        back_populates="article",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="FaqFragment.position",
    )
    related_links: Mapped[list["FaqArticleLink"]] = relationship(
        back_populates="article",
        foreign_keys="FaqArticleLink.article_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    related_articles: Mapped[list["FaqArticle"]] = relationship(
        secondary="faq_article_links",
        primaryjoin="FaqArticle.id == FaqArticleLink.article_id",
        secondaryjoin="FaqArticle.id == FaqArticleLink.related_article_id",
        viewonly=True,
    )
    intents: Mapped[list["ChatbotIntent"]] = relationship(back_populates="article")


class FaqArticleLink(TimestampMixin, Base):
    """Auto-relation M–N des articles liés."""

    __tablename__ = "faq_article_links"
    __table_args__ = (
        CheckConstraint("article_id <> related_article_id", name="not_self"),
        Index("idx_faq_article_links_related", "related_article_id"),
    )

    article_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "faq_articles.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_faq_article_links_article",
        ),
        primary_key=True,
    )
    related_article_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "faq_articles.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_faq_article_links_related",
        ),
        primary_key=True,
    )

    article: Mapped["FaqArticle"] = relationship(
        back_populates="related_links", foreign_keys=[article_id]
    )
    related_article: Mapped["FaqArticle"] = relationship(
        foreign_keys=[related_article_id]
    )


class ChatbotIntent(TimestampMixin, Base):
    __tablename__ = "chatbot_intents"
    __table_args__ = (
        UniqueConstraint("code", name="uq_chatbot_intents_code"),
        CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name="code_format"),
        CheckConstraint("btrim(answer) <> ''", name="answer_not_blank"),
        CheckConstraint(
            "array_length(quick_replies, 1) IS NULL OR array_length(quick_replies, 1) <= 5",
            name="quick_replies",
        ),
        Index(
            "idx_chatbot_intents_article",
            "faq_article_id",
            postgresql_where=text("faq_article_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120))
    answer: Mapped[str] = mapped_column(Text)
    #: Rendues d'un bloc : tableau, là où les mots-clés recherchés sont une table.
    quick_replies: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'"), default=list
    )
    escalates_to_ticket: Mapped[bool] = mapped_column(
        server_default=text("false"), default=False
    )
    faq_article_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "faq_articles.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_chatbot_intents_article",
        ),
        default=None,
    )
    is_active: Mapped[bool] = mapped_column(server_default=text("true"), default=True)

    article: Mapped["FaqArticle | None"] = relationship(back_populates="intents")
    keywords: Mapped[list["ChatbotIntentKeyword"]] = relationship(
        back_populates="intent",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )


class ChatbotIntentKeyword(TimestampMixin, Base):
    """Table fille et non tableau : un mot-clé se recherche et s'indexe."""

    __tablename__ = "chatbot_intent_keywords"
    __table_args__ = (
        UniqueConstraint("intent_id", "keyword", name="uq_chatbot_intent_keywords"),
        CheckConstraint("btrim(keyword) <> ''", name="not_blank"),
        Index("idx_chatbot_intent_keywords_keyword", "keyword"),
    )

    id: Mapped[UuidPk]
    intent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "chatbot_intents.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_chatbot_intent_keywords_intent",
        )
    )
    keyword: Mapped[str] = mapped_column(CITEXT)

    intent: Mapped["ChatbotIntent"] = relationship(back_populates="keywords")


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
        # Compteur de la barre supérieure : notifications non lues.
        Index(
            "idx_notifications_unread",
            "user_id",
            text("sent_at DESC"),
            postgresql_where=text("read_at IS NULL"),
        ),
        Index("idx_notifications_user", "user_id", text("sent_at DESC")),
        Index(
            "idx_notifications_booking",
            "booking_id",
            postgresql_where=text("booking_id IS NOT NULL"),
        ),
        Index(
            "idx_notifications_ticket",
            "ticket_id",
            postgresql_where=text("ticket_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_notifications_user",
        )
    )
    title: Mapped[str] = mapped_column(String(180))
    channel: Mapped[NotificationChannel] = mapped_column(
        pg_enum(NotificationChannel, "notification_channel"),
        server_default=text("'in_app'"),
        default=NotificationChannel.IN_APP,
    )
    body: Mapped[str | None] = mapped_column(Text, default=None)
    #: Gabarit qui l'a produite — `reservation_rappel`, `reservation_annulation`.
    #: L'écran en tire l'action à proposer : un rappel mène à la validation de
    #: présence, une confirmation à la réservation. Sans lui, une notification
    #: n'est qu'un texte : le champ `action` que la liste sait afficher n'était
    #: alimenté par rien, et aucune notification n'a jamais été actionnable.
    template_code: Mapped[str | None] = mapped_column(String(60), default=None)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "bookings.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_notifications_booking",
        ),
        default=None,
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "tickets.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_notifications_ticket",
        ),
        default=None,
    )
    read_at: Mapped[datetime | None] = mapped_column(default=None)
    sent_at: Mapped[datetime] = mapped_column(
        server_default=text("now()"), default=None
    )

    user: Mapped["User"] = relationship(back_populates="notifications")
    booking: Mapped["Booking | None"] = relationship(back_populates="notifications")
    ticket: Mapped["Ticket | None"] = relationship(back_populates="notifications")


class EmailTemplateVariable(TimestampMixin, Base):
    """Référentiel des variables autorisées dans les modèles d'e-mails.

    Il permet de refuser un modèle citant une variable inconnue, qui resterait
    non remplacée dans l'e-mail envoyé.
    """

    __tablename__ = "email_template_variables"
    __table_args__ = (
        UniqueConstraint("code", name="uq_email_template_variables_code"),
        CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name="code_format"),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120))
    sample_value: Mapped[str] = mapped_column(String(180))


class EmailTemplate(TimestampMixin, Base):
    __tablename__ = "email_templates"
    __table_args__ = (
        UniqueConstraint("code", name="uq_email_templates_code"),
        CheckConstraint("btrim(subject) <> ''", name="subject_not_blank"),
        CheckConstraint("btrim(body) <> ''", name="body_not_blank"),
        Index(
            "idx_email_templates_updated_by",
            "updated_by_admin_id",
            postgresql_where=text("updated_by_admin_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    trigger_label: Mapped[str] = mapped_column(String(180))
    subject: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    #: Désactivé, le modèle n'envoie plus rien pour son événement.
    is_enabled: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    updated_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_email_templates_updated_by",
        ),
        default=None,
    )

    updated_by: Mapped["AdminAccount | None"] = relationship(
        back_populates="edited_templates"
    )


class AuditLog(TimestampMixin, Base):
    """Journal immuable : ni DELETE ni réécriture, seul le signalement s'ajoute.

    Le trigger `trg_audit_logs_append_only` fait respecter cette propriété au
    niveau base ; l'ORM ne peut pas la garantir seul.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint("btrim(actor_label) <> ''", name="actor_label_not_blank"),
        CheckConstraint("btrim(target_label) <> ''", name="target_label_not_blank"),
        CheckConstraint("flag_reason IS NULL OR flagged_at IS NOT NULL", name="flag"),
        Index("idx_audit_logs_occurred", text("occurred_at DESC")),
        Index(
            "idx_audit_logs_actor",
            "actor_admin_id",
            text("occurred_at DESC"),
            postgresql_where=text("actor_admin_id IS NOT NULL"),
        ),
        Index("idx_audit_logs_action", "action", text("occurred_at DESC")),
        Index("idx_audit_logs_target", "target_type", "target_id"),
        Index(
            "idx_audit_logs_flagged",
            text("occurred_at DESC"),
            postgresql_where=text("flagged_at IS NOT NULL"),
        ),
        Index(
            "idx_audit_logs_search_trgm",
            text("(target_label || ' ' || actor_label) gin_trgm_ops"),
            postgresql_using="gin",
        ),
    )

    id: Mapped[UuidPk]
    #: Nom figé : le journal reste lisible après suppression du compte.
    actor_label: Mapped[str] = mapped_column(String(120))
    action: Mapped[AuditAction] = mapped_column(pg_enum(AuditAction, "audit_action"))
    target_type: Mapped[str] = mapped_column(String(60))
    target_label: Mapped[str] = mapped_column(String(160))
    actor_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_audit_logs_actor",
        ),
        default=None,
    )
    #: Sans clé étrangère : la cible est polymorphe et peut avoir disparu.
    target_id: Mapped[uuid.UUID | None] = mapped_column(default=None)
    diff_before: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    diff_after: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    ip_address: Mapped[str | None] = mapped_column(INET, default=None)
    user_agent: Mapped[str | None] = mapped_column(String(255), default=None)
    session_id: Mapped[str | None] = mapped_column(String(64), default=None)
    flagged_at: Mapped[datetime | None] = mapped_column(default=None)
    flag_reason: Mapped[str | None] = mapped_column(String(255), default=None)
    occurred_at: Mapped[datetime] = mapped_column(
        server_default=text("now()"), default=None
    )

    actor: Mapped["AdminAccount | None"] = relationship(
        back_populates="audit_entries", lazy="selectin"
    )
