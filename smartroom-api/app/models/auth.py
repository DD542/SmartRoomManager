"""Jetons de session et de réinitialisation.

Aucun secret n'est stocké en clair : ces deux tables ne contiennent que des
empreintes SHA-256. Perdre la base ne donne aucune session ni aucun lien de
réinitialisation exploitable.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAt, TimestampMixin, UuidPk


class RefreshToken(TimestampMixin, Base):
    """Jeton de rafraîchissement, une ligne par émission.

    Les émissions successives d'une même session partagent `family_id`. Un
    jeton déjà utilisé qui reparaît signale un vol : toute la famille est alors
    révoquée d'un coup, ce qu'un simple compteur ne permettrait pas.
    """

    __tablename__ = "refresh_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_refresh_tokens_hash"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        CheckConstraint("scope IN ('user', 'admin')", name="scope"),
        # La révocation en masse d'une famille et le nettoyage des jetons
        # expirés sont les deux seules requêtes de balayage de cette table.
        Index("idx_refresh_tokens_family", "family_id", "revoked_at"),
        Index(
            "idx_refresh_tokens_active",
            "user_id",
            "expires_at",
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_refresh_tokens_user",
        )
    )
    #: Empreinte SHA-256 du jeton opaque. Le clair n'existe que côté client.
    token_hash: Mapped[str] = mapped_column(String(64))
    #: Identifie la chaîne de rotations issue d'une même connexion.
    family_id: Mapped[uuid.UUID] = mapped_column()
    scope: Mapped[str] = mapped_column(String(10), server_default=text("'user'"), default="user")
    expires_at: Mapped[datetime] = mapped_column()
    used_at: Mapped[datetime | None] = mapped_column(default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)
    #: Contexte de l'émission, utile au support quand un compte signale un accès
    #: qu'il ne reconnaît pas.
    ip_address: Mapped[str | None] = mapped_column(INET, default=None)
    user_agent: Mapped[str | None] = mapped_column(String(255), default=None)

    user: Mapped["User"] = relationship(back_populates="refresh_tokens")  # noqa: F821

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.used_at is None


class PasswordResetToken(Base):
    """Lien de réinitialisation, à usage unique et à durée limitée."""

    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_password_reset_tokens_hash"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        Index(
            "idx_password_reset_tokens_pending",
            "user_id",
            "expires_at",
            postgresql_where=text("used_at IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_password_reset_tokens_user",
        )
    )
    token_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column()
    used_at: Mapped[datetime | None] = mapped_column(default=None)
    requested_ip: Mapped[str | None] = mapped_column(INET, default=None)
    created_at: Mapped[CreatedAt]

    user: Mapped["User"] = relationship(back_populates="password_resets")  # noqa: F821
