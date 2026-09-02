"""Fragments vectorisés de la base de connaissances.

Un modèle à part et non une colonne de plus sur `faq_articles` : un article
produit plusieurs fragments, et c'est le fragment — quelques phrases — qui
porte un vecteur exploitable. Vectoriser l'article entier moyennerait tous ses
paragraphes et ne retrouverait plus celui qui répond à la question.

La colonne `lexical` est calculée par PostgreSQL et n'apparaît donc pas ici en
écriture : elle est déclarée en lecture seule, ce qui interdit à SQLAlchemy de
tenter de l'écrire — la base refuserait, mais l'erreur arriverait à l'exécution
plutôt qu'à la lecture du modèle.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CHAR,
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UuidPk

#: Dimension de `nomic-embed-text`, figée par la migration `0007_rag_pgvector`.
DIMENSION_VECTEUR = 768


class FaqFragment(TimestampMixin, Base):
    __tablename__ = "faq_fragments"
    __table_args__ = (
        UniqueConstraint(
            "article_id", "position", name="uq_faq_fragments_article_position"
        ),
        CheckConstraint("length(contenu) > 0", name="contenu_non_vide"),
        CheckConstraint("position >= 0", name="position_positive"),
        # Un vecteur sans le nom du modèle qui l'a produit serait inexploitable :
        # deux modèles ne partagent pas le même espace, et comparer leurs
        # distances ne voudrait rien dire.
        CheckConstraint(
            "(vecteur IS NULL AND modele IS NULL AND vectorise_le IS NULL)"
            " OR (vecteur IS NOT NULL AND modele IS NOT NULL AND vectorise_le IS NOT NULL)",
            name="vecteur_modele",
        ),
        Index("idx_faq_fragments_article", "article_id"),
        # Les deux index de la recherche hybride. Déclarés ici autant que dans
        # la migration : `alembic check` compare les deux, et c'est ce qui
        # empêche un index de disparaître d'un côté sans qu'on le sache.
        Index("idx_faq_fragments_lexical", "lexical", postgresql_using="gin"),
        Index(
            "idx_faq_fragments_vecteur",
            "vecteur",
            postgresql_using="hnsw",
            postgresql_ops={"vecteur": "vector_cosine_ops"},
        ),
        Index(
            "idx_faq_fragments_a_vectoriser",
            "modele",
            postgresql_where=text("vecteur IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    article_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "faq_articles.id", ondelete="CASCADE", name="fk_faq_fragments_article"
        )
    )
    #: Rang du fragment dans son article. Sert à restituer l'ordre de lecture
    #: quand plusieurs fragments du même article ressortent.
    position: Mapped[int] = mapped_column(SmallInteger)
    contenu: Mapped[str] = mapped_column(Text)
    empreinte: Mapped[str] = mapped_column(CHAR(32))
    vecteur: Mapped[list[float] | None] = mapped_column(
        Vector(DIMENSION_VECTEUR), default=None
    )
    modele: Mapped[str | None] = mapped_column(String(80), default=None)
    vectorise_le: Mapped[datetime | None] = mapped_column(default=None)

    #: Colonne générée par PostgreSQL. `Computed` la déclare comme telle :
    #: SQLAlchemy l'exclut alors des INSERT et des UPDATE, là où une colonne
    #: ordinaire serait proposée à l'écriture et refusée par la base.
    lexical: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('french_unaccent', contenu)", persisted=True),
        nullable=True,
    )

    article: Mapped["FaqArticle"] = relationship(back_populates="fragments")  # noqa: F821
