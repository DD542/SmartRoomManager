"""Socle déclaratif SQLAlchemy 2.0.

Les noms de contraintes suivent la convention du projet et sont repris tels
quels par Alembic : `pk_`, `fk_`, `uq_`, `ck_`, `idx_`. Sans convention
explicite, une contrainte renommée d'une version à l'autre produirait une
migration parasite à chaque autogénération.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Annotated

from sqlalchemy import DateTime, MetaData, func, text
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "ix": "idx_%(table_name)s_%(column_0_N_name)s",
}


class Base(DeclarativeBase):
    """Classe de base de tous les modèles.

    `type_annotation_map` évite de répéter le type SQL sur chaque colonne :
    une annotation `Mapped[uuid.UUID]` produit un UUID PostgreSQL, une
    annotation `Mapped[datetime]` un TIMESTAMPTZ.
    """

    metadata = MetaData(naming_convention=NAMING_CONVENTION)

    type_annotation_map = {
        uuid.UUID: PgUUID(as_uuid=True),
        datetime: DateTime(timezone=True),
    }

    def __repr__(self) -> str:  # pragma: no cover - confort de débogage
        identifiant = getattr(self, "id", None) or getattr(self, "user_id", None)
        return f"<{type(self).__name__} {identifiant}>"


# --------------------------------------------------------------------------- #
# Types annotés réutilisables
# --------------------------------------------------------------------------- #

UuidPk = Annotated[
    uuid.UUID,
    mapped_column(primary_key=True, server_default=text("gen_random_uuid()")),
]

CreatedAt = Annotated[datetime, mapped_column(server_default=func.now())]

# `onupdate` double le trigger set_updated_at() côté base : le trigger garantit
# la valeur quelle que soit l'origine de l'écriture, `onupdate` garde l'objet
# Python cohérent sans aller-retour supplémentaire.
UpdatedAt = Annotated[
    datetime,
    mapped_column(server_default=func.now(), onupdate=func.now()),
]


class TimestampMixin:
    """Horodatage porté par toutes les tables du schéma."""

    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


class SoftDeleteMixin:
    """Suppression logique, réservée à Room, User et Booking.

    Toute requête de lecture doit filtrer `deleted_at IS NULL` : les index
    métier de ces trois tables sont partiels sur cette condition.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(default=None)


def pg_enum(python_enum: type[enum.Enum], name: str) -> PgEnum:
    """Lie une énumération Python au type ENUM PostgreSQL correspondant.

    `create_type=False` : les types sont créés par la migration Alembic, pas au
    fil des `CREATE TABLE`, sans quoi deux tables partageant un enum
    tenteraient de le créer deux fois.

    `values_callable` : PostgreSQL reçoit la *valeur* du membre et non son nom,
    faute de quoi `BookingStatus.CONFIRMEE` serait envoyé comme « CONFIRMEE ».
    """
    return PgEnum(
        python_enum,
        name=name,
        create_type=False,
        native_enum=True,
        values_callable=lambda members: [member.value for member in members],
    )
