"""Conversations de l'assistant : fil, messages, journal des tours.

Le journal est une table à part et non des colonnes de plus sur le message :
il se lit autrement — agrégé dans A-13 plutôt que relu dans le fil —, il se
purge à un autre rythme, et un tour peut exister sans message d'assistant,
quand il s'est arrêté sur un refus.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UuidPk, pg_enum


class ChatRole(str, enum.Enum):
    UTILISATEUR = "utilisateur"
    ASSISTANT = "assistant"
    SYSTEME = "systeme"


class ChatConversation(TimestampMixin, Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (
        CheckConstraint("length(btrim(titre)) > 0", name="titre_non_vide"),
        Index("idx_chat_conversations_user", "user_id", text("derniere_activite DESC")),
    )

    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", name="fk_chat_conversations_user")
    )
    titre: Mapped[str] = mapped_column(
        String(120), server_default=text("'Nouvelle conversation'"), default="Nouvelle conversation"
    )
    #: Résumé des tours anciens. Réécrit, jamais empilé.
    resume: Mapped[str] = mapped_column(Text, server_default=text("''"), default="")
    derniere_activite: Mapped[datetime] = mapped_column(server_default=text("now()"))

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="ChatMessage.created_at",
    )


class ChatMessage(TimestampMixin, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint(
            "length(btrim(contenu)) > 0 OR carte IS NOT NULL", name="non_vide"
        ),
        Index("idx_chat_messages_conversation", "conversation_id", "created_at"),
    )

    id: Mapped[UuidPk]
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_conversations.id", ondelete="CASCADE", name="fk_chat_messages_conversation")
    )
    role: Mapped[ChatRole] = mapped_column(pg_enum(ChatRole, "chat_role"))
    contenu: Mapped[str] = mapped_column(Text, server_default=text("''"), default="")
    carte: Mapped[str | None] = mapped_column(String(24), default=None)
    donnees: Mapped[Any | None] = mapped_column(JSONB, default=None)
    sources: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'"), default=list
    )

    conversation: Mapped["ChatConversation"] = relationship(back_populates="messages")


class ChatTour(TimestampMixin, Base):
    """Un tour de conversation, vu de l'exploitation."""

    __tablename__ = "chat_tours"
    __table_args__ = (
        Index("idx_chat_tours_date", text("created_at DESC")),
        Index("idx_chat_tours_repli", "repli", text("created_at DESC")),
    )

    id: Mapped[UuidPk]
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_conversations.id", ondelete="CASCADE", name="fk_chat_tours_conversation"),
        default=None,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_chat_tours_user"), default=None
    )
    mode: Mapped[str] = mapped_column(String(16))
    modele: Mapped[str | None] = mapped_column(String(80), default=None)
    repli: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    declencheur_repli: Mapped[str | None] = mapped_column(String(48), default=None)
    iterations: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"), default=0)
    outils: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'"), default=list
    )
    duree_ms: Mapped[int] = mapped_column(server_default=text("0"), default=0)
    premier_jeton_ms: Mapped[int | None] = mapped_column(default=None)
    jetons_invite: Mapped[int] = mapped_column(server_default=text("0"), default=0)
    jetons_reponse: Mapped[int] = mapped_column(server_default=text("0"), default=0)
    jetons_contexte: Mapped[int] = mapped_column(server_default=text("0"), default=0)
    injection_suspectee: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    etaye: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    transfert_humain: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
