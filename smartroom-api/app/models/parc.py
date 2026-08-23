"""Modèles du domaine parc : bâtiments, étages, plans, salles, équipements.

Risques N+1 et stratégies de chargement
---------------------------------------
- Liste des salles (U-03, A-05) : chaque carte affiche le bâtiment, les
  équipements et le visuel de couverture. Sans précaution, une liste de vingt
  salles produit soixante et une requêtes. `Room.floor`, `Room.room_equipments`
  et `Room.photos` sont donc en `selectin` : trois requêtes au total, quel que
  soit le nombre de salles.
- `Floor.building` est en `joined` : la relation est unitaire et systématiquement
  affichée, une jointure coûte moins qu'un aller-retour.
- `Room.bookings` est en `select` (paresseux) et **doit** être chargée
  explicitement par `selectinload` avec un filtre de période : la collection
  complète d'une salle grandit indéfiniment.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
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
from sqlalchemy.dialects.postgresql import NUMERIC
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UuidPk, pg_enum
from app.db.enums import EquipmentCategory, PlanDocumentKind, RoomStatus

if TYPE_CHECKING:
    from app.models.comptes import AdminAccount, UserPreference
    from app.models.reservations import (
        AccessRequest,
        Booking,
        BookingRule,
        ClosureRoom,
        OpeningHour,
        RecurrenceRule,
    )
    from app.models.support import Ticket


class Building(TimestampMixin, Base):
    __tablename__ = "buildings"
    __table_args__ = (
        UniqueConstraint("code", name="uq_buildings_code"),
        CheckConstraint("code ~ '^[A-Z0-9]{1,4}$'", name="code_format"),
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index("idx_buildings_sort_order", "sort_order", "name"),
    )

    id: Mapped[UuidPk]
    #: Préfixe des codes d'accès émis pour les salles du bâtiment.
    code: Mapped[str] = mapped_column(String(4))
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(String(255), default=None)
    sort_order: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"), default=0)

    floors: Mapped[list["Floor"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", passive_deletes=True
    )
    booking_rules: Mapped[list["BookingRule"]] = relationship(back_populates="building")
    opening_hours: Mapped[list["OpeningHour"]] = relationship(back_populates="building")
    user_preferences: Mapped[list["UserPreference"]] = relationship(back_populates="preferred_building")


class Floor(TimestampMixin, Base):
    __tablename__ = "floors"
    __table_args__ = (
        UniqueConstraint("building_id", "code", name="uq_floors_building_code"),
        UniqueConstraint("building_id", "level", name="uq_floors_building_level"),
        CheckConstraint("level BETWEEN -5 AND 60", name="level_range"),
        Index("idx_floors_building_id", "building_id", "level"),
    )

    id: Mapped[UuidPk]
    building_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("buildings.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_floors_building")
    )
    #: Texte affiché (« RDC », « 2e »).
    code: Mapped[str] = mapped_column(String(8))
    label: Mapped[str] = mapped_column(String(60))
    #: Entier de tri : `code` étant du texte, il ne s'ordonne pas correctement.
    level: Mapped[int] = mapped_column(SmallInteger)

    building: Mapped["Building"] = relationship(back_populates="floors", lazy="joined")
    plan: Mapped["FloorPlan | None"] = relationship(
        back_populates="floor", cascade="all, delete-orphan", passive_deletes=True
    )
    rooms: Mapped[list["Room"]] = relationship(back_populates="floor")


class FloorPlan(TimestampMixin, Base):
    """Document de plan déposé par l'administration, un par étage au maximum."""

    __tablename__ = "floor_plans"
    __table_args__ = (
        UniqueConstraint("floor_id", name="uq_floor_plans_floor"),
        CheckConstraint(
            "file_size_bytes > 0 AND file_size_bytes <= 5 * 1024 * 1024",
            name="size",
        ),
        CheckConstraint("btrim(file_name) <> ''", name="file_name"),
        Index(
            "idx_floor_plans_uploaded_by",
            "uploaded_by_admin_id",
            postgresql_where=text("uploaded_by_admin_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    floor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("floors.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_floor_plans_floor")
    )
    kind: Mapped[PlanDocumentKind] = mapped_column(pg_enum(PlanDocumentKind, "plan_document_kind"))
    file_url: Mapped[str] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(160))
    file_size_bytes: Mapped[int]
    uploaded_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_floor_plans_uploaded_by_admin",
        ),
        default=None,
    )
    uploaded_at: Mapped[datetime] = mapped_column(server_default=text("now()"), default=None)

    floor: Mapped["Floor"] = relationship(back_populates="plan")
    uploaded_by: Mapped["AdminAccount | None"] = relationship(back_populates="uploaded_plans")


class Room(TimestampMixin, SoftDeleteMixin, Base):
    __tablename__ = "rooms"
    __table_args__ = (
        CheckConstraint("capacity BETWEEN 1 AND 500", name="capacity"),
        CheckConstraint("area_m2 > 0 AND area_m2 <= 5000", name="area"),
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint(
            "deleted_at IS NULL OR status = 'archivee'", name="archived_state"
        ),
        # Unicités partielles : archiver une salle libère son nom et son slug.
        Index(
            "uq_rooms_floor_name",
            "floor_id",
            "name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("uq_rooms_slug", "slug", unique=True, postgresql_where=text("deleted_at IS NULL")),
        Index("idx_rooms_floor_id", "floor_id"),
        # Index composite de la recherche de disponibilité.
        Index(
            "idx_rooms_search",
            "status",
            "capacity",
            "floor_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_rooms_name_trgm",
            text("name gin_trgm_ops"),
            postgresql_using="gin",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    floor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("floors.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_rooms_floor")
    )
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140))
    capacity: Mapped[int] = mapped_column(SmallInteger)
    area_m2: Mapped[Decimal] = mapped_column(NUMERIC(6, 2))
    status: Mapped[RoomStatus] = mapped_column(
        pg_enum(RoomStatus, "room_status"), server_default=text("'disponible'"), default=RoomStatus.DISPONIBLE
    )
    is_accessible: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    badge_required: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    #: Code permanent du terminal, haché : le clair n'est jamais persisté.
    access_code_hash: Mapped[str | None] = mapped_column(Text, default=None)
    description: Mapped[str | None] = mapped_column(Text, default=None)

    floor: Mapped["Floor"] = relationship(back_populates="rooms", lazy="selectin")
    placement: Mapped["RoomPlacement | None"] = relationship(
        back_populates="room", cascade="all, delete-orphan", passive_deletes=True
    )
    photos: Mapped[list["RoomPhoto"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RoomPhoto.position",
        lazy="selectin",
    )
    room_equipments: Mapped[list["RoomEquipment"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
    )
    # Lecture seule : l'écriture passe par l'objet d'association, qui porte la
    # quantité installée.
    equipments: Mapped[list["Equipment"]] = relationship(
        secondary="room_equipments", viewonly=True, lazy="selectin"
    )
    # Volontairement paresseuse : à charger avec un filtre de période.
    bookings: Mapped[list["Booking"]] = relationship(back_populates="room", lazy="select")
    booking_rule: Mapped["BookingRule | None"] = relationship(back_populates="room")
    opening_hours: Mapped[list["OpeningHour"]] = relationship(back_populates="room")
    closures: Mapped[list["ClosureRoom"]] = relationship(back_populates="room")
    recurrence_rules: Mapped[list["RecurrenceRule"]] = relationship(back_populates="room")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="room")
    access_requests: Mapped[list["AccessRequest"]] = relationship(
        back_populates="room", foreign_keys="AccessRequest.room_id"
    )


class RoomPlacement(TimestampMixin, Base):
    """Géométrie de la salle sur le plan de son étage, en pourcentage du viewBox."""

    __tablename__ = "room_placements"
    __table_args__ = (
        CheckConstraint("pos_x >= 0 AND pos_y >= 0", name="origin"),
        CheckConstraint("width > 0 AND height > 0", name="size"),
        CheckConstraint(
            "pos_x + width <= 100 AND pos_y + height <= 100", name="bounds"
        ),
        CheckConstraint("rotation IN (0, 90, 180, 270)", name="rotation"),
    )

    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_room_placements_room"),
        primary_key=True,
    )
    pos_x: Mapped[Decimal] = mapped_column(NUMERIC(5, 2))
    pos_y: Mapped[Decimal] = mapped_column(NUMERIC(5, 2))
    width: Mapped[Decimal] = mapped_column(NUMERIC(5, 2))
    height: Mapped[Decimal] = mapped_column(NUMERIC(5, 2))
    rotation: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"), default=0)
    is_entrance_marked: Mapped[bool] = mapped_column(server_default=text("false"), default=False)

    room: Mapped["Room"] = relationship(back_populates="placement")


class Equipment(TimestampMixin, Base):
    __tablename__ = "equipments"
    __table_args__ = (
        UniqueConstraint("code", name="uq_equipments_code"),
        CheckConstraint("code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="code_format"),
        CheckConstraint("btrim(label) <> ''", name="label_not_blank"),
        Index(
            "idx_equipments_filterable",
            "category",
            "label",
            postgresql_where=text("is_filterable"),
        ),
    )

    id: Mapped[UuidPk]
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(80))
    category: Mapped[EquipmentCategory] = mapped_column(pg_enum(EquipmentCategory, "equipment_category"))
    #: Clé de la table d'icônes du front, pas un chemin de fichier.
    icon: Mapped[str] = mapped_column(String(40))
    description: Mapped[str | None] = mapped_column(String(255), default=None)
    is_filterable: Mapped[bool] = mapped_column(server_default=text("false"), default=False)

    room_equipments: Mapped[list["RoomEquipment"]] = relationship(back_populates="equipment")


class RoomEquipment(TimestampMixin, Base):
    """Objet d'association : la quantité installée interdit une simple table secondaire."""

    __tablename__ = "room_equipments"
    __table_args__ = (
        CheckConstraint("quantity > 0 AND quantity <= 50", name="quantity"),
        Index("idx_room_equipments_equipment", "equipment_id", "room_id"),
    )

    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_room_equipments_room"),
        primary_key=True,
    )
    equipment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "equipments.id",
            ondelete="RESTRICT",
            onupdate="CASCADE",
            name="fk_room_equipments_equipment",
        ),
        primary_key=True,
    )
    quantity: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"), default=1)

    room: Mapped["Room"] = relationship(back_populates="room_equipments")
    equipment: Mapped["Equipment"] = relationship(back_populates="room_equipments", lazy="joined")


class RoomPhoto(TimestampMixin, Base):
    __tablename__ = "room_photos"
    __table_args__ = (
        UniqueConstraint("room_id", "position", name="uq_room_photos_position"),
        CheckConstraint("position BETWEEN 0 AND 5", name="position"),
        Index("idx_room_photos_room_id", "room_id", "position"),
    )

    id: Mapped[UuidPk]
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_room_photos_room")
    )
    file_url: Mapped[str] = mapped_column(Text)
    alt_text: Mapped[str | None] = mapped_column(String(160), default=None)
    #: Position 0 = visuel de couverture des résultats de recherche.
    position: Mapped[int] = mapped_column(SmallInteger, default=0)

    room: Mapped["Room"] = relationship(back_populates="photos")
