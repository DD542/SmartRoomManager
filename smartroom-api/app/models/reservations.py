"""Modèles du domaine réservation : créneaux, règles, horaires, arbitrage.

Risques N+1 et stratégies de chargement
---------------------------------------
- Liste « toutes les réservations » (A-03) : chaque ligne montre la salle, son
  bâtiment et l'organisateur. `Booking.room` et `Booking.owner` sont en
  `selectin` — trois requêtes pour la page entière au lieu de deux par ligne.
- Détail d'une réservation : participants, frise et code d'accès. Les trois
  collections sont paresseuses et doivent être demandées par `selectinload`
  dans la requête de détail : les charger pour la liste serait du gaspillage.
- Résolution des règles (`booking_rules`, `opening_hours`) : trois lectures au
  plus par vérification, mises en cache pour la durée de la requête HTTP.
  Les charger en relation depuis `Room` provoquerait un N+1 sur la recherche
  de disponibilité, qui balaie tout le catalogue.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import (
    CITEXT,
    DATERANGE,
    TSTZRANGE,
    ExcludeConstraint,
    Range,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeleteMixin, TimestampMixin, UuidPk, pg_enum
from app.db.enums import (
    AccessType,
    BookingEventType,
    BookingSource,
    BookingStatus,
    ClosureKind,
    ParticipantResponse,
    RecurrenceFreq,
    RequestStatus,
    RuleScope,
)

if TYPE_CHECKING:
    from app.models.comptes import AdminAccount, User
    from app.models.parc import Building, Room
    from app.models.support import Notification, Ticket

#: Cohérence portée / cible, partagée par booking_rules et opening_hours.
SCOPE_TARGET_CHECK = (
    "(scope = 'global'   AND building_id IS NULL     AND room_id IS NULL)"
    " OR (scope = 'batiment' AND building_id IS NOT NULL AND room_id IS NULL)"
    " OR (scope = 'salle'    AND building_id IS NULL     AND room_id IS NOT NULL)"
)


class RecurrenceRule(TimestampMixin, Base):
    """Série récurrente. Les occurrences sont matérialisées en `bookings` :
    c'est la seule façon de leur appliquer la contrainte anti-chevauchement."""

    __tablename__ = "recurrence_rules"
    __table_args__ = (
        CheckConstraint("interval_count BETWEEN 1 AND 12", name="interval"),
        CheckConstraint(
            "array_length(byweekday, 1) BETWEEN 1 AND 7"
            " AND byweekday <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]",
            name="weekdays",
        ),
        CheckConstraint("until_date >= start_date", name="dates"),
        CheckConstraint(
            "until_date <= start_date + INTERVAL '1 year'", name="horizon"
        ),
        CheckConstraint("end_time > start_time", name="times"),
        Index("idx_recurrence_rules_owner", "owner_id", text("start_date DESC")),
        Index("idx_recurrence_rules_room", "room_id"),
    )

    id: Mapped[UuidPk]
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_recurrence_rules_owner")
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_recurrence_rules_room")
    )
    freq: Mapped[RecurrenceFreq] = mapped_column(pg_enum(RecurrenceFreq, "recurrence_freq"))
    interval_count: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"), default=1)
    #: Jours visés, 0 = dimanche. Tableau : lu et réécrit d'un bloc.
    byweekday: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger))
    start_date: Mapped[date]
    until_date: Mapped[date]
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)

    owner: Mapped["User"] = relationship(back_populates="recurrence_rules")
    room: Mapped["Room"] = relationship(back_populates="recurrence_rules")
    occurrences: Mapped[list["Booking"]] = relationship(back_populates="recurrence_rule")


class Booking(TimestampMixin, SoftDeleteMixin, Base):
    """Réservation d'une salle sur un créneau.

    `ex_bookings_no_overlap` interdit toute double réservation au niveau base :
    aucune vérification applicative n'offrirait cette garantie sous concurrence.
    """

    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
        # Bornes finies et normalisées en [) : deux réunions jointives ne se
        # chevauchent pas.
        CheckConstraint(
            "NOT isempty(time_range)"
            " AND lower(time_range) IS NOT NULL"
            " AND upper(time_range) IS NOT NULL"
            " AND lower_inc(time_range)"
            " AND NOT upper_inc(time_range)",
            name="range_bounds",
        ),
        # Un blocage administratif échappe aux bornes de durée : fermer une salle
        # pour travaux dure une journée entière.
        CheckConstraint(
            "source = 'blocage'"
            " OR (upper(time_range) - lower(time_range))"
            "     BETWEEN INTERVAL '30 minutes' AND INTERVAL '4 hours'",
            name="duration",
        ),
        CheckConstraint(
            "source <> 'blocage'"
            " OR (upper(time_range) - lower(time_range)) <= INTERVAL '30 days'",
            name="blocking_duration",
        ),
        CheckConstraint(
            "(owner_id IS NULL) = (source = 'blocage')", name="owner_presence"
        ),
        CheckConstraint(
            "attendee_count >= 0 AND (source = 'blocage' OR attendee_count > 0)",
            name="attendee_count",
        ),
        CheckConstraint(
            "(status = 'annulee') = (cancelled_at IS NOT NULL)"
            " AND (status = 'annulee')"
            "     = (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')",
            name="cancel_state",
        ),
        CheckConstraint(
            "checked_in_at IS NULL OR checked_in_at >= lower(time_range)",
            name="checkin_after_start",
        ),
        CheckConstraint(
            "status <> 'annulee' OR checked_in_at IS NULL",
            name="cancelled_not_checked_in",
        ),
        CheckConstraint(
            "recurrence_rule_id IS NULL OR source = 'recurrente'",
            name="recurrence_source",
        ),
        # Contrainte centrale du sujet. Le prédicat rend un créneau annulé
        # immédiatement réservable sans supprimer la ligne, nécessaire aux
        # statistiques de no-show.
        ExcludeConstraint(
            ("room_id", "="),
            ("time_range", "&&"),
            using="gist",
            where=text("status <> 'annulee' AND deleted_at IS NULL"),
            name="ex_bookings_no_overlap",
        ),
        # L'index de la contrainte EXCLUDE couvre déjà (room_id, time_range)
        # filtré sur les réservations actives : le redéclarer serait un doublon.
        Index(
            "idx_bookings_range_gist",
            "time_range",
            postgresql_using="gist",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_bookings_owner_start",
            "owner_id",
            text("lower(time_range) DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "idx_bookings_status_source",
            "status",
            "source",
            text("lower(time_range) DESC"),
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # Tâche de libération automatique après absence de check-in.
        Index(
            "idx_bookings_checkin_pending",
            text("lower(time_range)"),
            postgresql_where=text(
                "status = 'confirmee' AND checked_in_at IS NULL AND deleted_at IS NULL"
            ),
        ),
        Index(
            "idx_bookings_recurrence",
            "recurrence_rule_id",
            postgresql_where=text("recurrence_rule_id IS NOT NULL"),
        ),
        Index(
            "idx_bookings_created_by_admin",
            "created_by_admin_id",
            postgresql_where=text("created_by_admin_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_bookings_room")
    )
    #: NULL pour un blocage administratif : personne ne l'organise.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_bookings_owner"),
        default=None,
    )
    created_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_bookings_created_by_admin",
        ),
        default=None,
    )
    recurrence_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "recurrence_rules.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_bookings_recurrence",
        ),
        default=None,
    )
    title: Mapped[str] = mapped_column(String(160), default="Réunion")
    #: Le créneau est une donnée unique, indexable en GiST.
    time_range: Mapped[Range[datetime]] = mapped_column(TSTZRANGE, default=None)
    attendee_count: Mapped[int] = mapped_column(SmallInteger, default=1)
    status: Mapped[BookingStatus] = mapped_column(
        pg_enum(BookingStatus, "booking_status"),
        server_default=text("'confirmee'"),
        default=BookingStatus.CONFIRMEE,
    )
    source: Mapped[BookingSource] = mapped_column(
        pg_enum(BookingSource, "booking_source"),
        server_default=text("'utilisateur'"),
        default=BookingSource.UTILISATEUR,
    )
    #: Créée en ignorant les règles ; jamais en ignorant un conflit.
    is_forced: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    checked_in_at: Mapped[datetime | None] = mapped_column(default=None)
    cancelled_at: Mapped[datetime | None] = mapped_column(default=None)
    cancel_reason: Mapped[str | None] = mapped_column(String(255), default=None)

    room: Mapped["Room"] = relationship(back_populates="bookings", lazy="selectin")
    owner: Mapped["User | None"] = relationship(back_populates="bookings", lazy="selectin")
    created_by_admin: Mapped["AdminAccount | None"] = relationship(back_populates="created_bookings")
    recurrence_rule: Mapped["RecurrenceRule | None"] = relationship(back_populates="occurrences")

    participants: Mapped[list["BookingParticipant"]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", passive_deletes=True, lazy="select"
    )
    events: Mapped[list["BookingEvent"]] = relationship(
        back_populates="booking",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="BookingEvent.occurred_at",
        lazy="select",
    )
    access_codes: Mapped[list["BookingAccessCode"]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", passive_deletes=True, lazy="select"
    )
    access_requests: Mapped[list["AccessRequest"]] = relationship(back_populates="booking")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="booking")
    notifications: Mapped[list["Notification"]] = relationship(back_populates="booking")

    @property
    def starts_at(self) -> datetime | None:
        return self.time_range.lower if self.time_range else None

    @property
    def ends_at(self) -> datetime | None:
        return self.time_range.upper if self.time_range else None


class BookingParticipant(TimestampMixin, Base):
    __tablename__ = "booking_participants"
    __table_args__ = (
        UniqueConstraint("booking_id", "email", name="uq_booking_participants_email"),
        CheckConstraint(
            "email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'",
            name="email_format",
        ),
        CheckConstraint(
            "btrim(display_name) <> ''", name="name_not_blank"
        ),
        CheckConstraint(
            "(response = 'en_attente') = (responded_at IS NULL)",
            name="responded",
        ),
        Index(
            "uq_booking_participants_organizer",
            "booking_id",
            unique=True,
            postgresql_where=text("is_organizer"),
        ),
        Index(
            "idx_booking_participants_user", "user_id", postgresql_where=text("user_id IS NOT NULL")
        ),
        Index("idx_booking_participants_email", "email"),
    )

    id: Mapped[UuidPk]
    booking_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "bookings.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_booking_participants_booking"
        )
    )
    #: NULL pour un invité externe : l'adresse reste la source de vérité.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "users.id", ondelete="SET NULL", onupdate="CASCADE", name="fk_booking_participants_user"
        ),
        default=None,
    )
    email: Mapped[str] = mapped_column(CITEXT, default=None)
    display_name: Mapped[str] = mapped_column(String(120), default=None)
    response: Mapped[ParticipantResponse] = mapped_column(
        pg_enum(ParticipantResponse, "participant_response"),
        server_default=text("'en_attente'"),
        default=ParticipantResponse.EN_ATTENTE,
    )
    is_organizer: Mapped[bool] = mapped_column(server_default=text("false"), default=False)
    responded_at: Mapped[datetime | None] = mapped_column(default=None)

    booking: Mapped["Booking"] = relationship(back_populates="participants")
    user: Mapped["User | None"] = relationship(back_populates="participations")


class BookingEvent(TimestampMixin, Base):
    """Frise de l'écran de détail, en ajout seul."""

    __tablename__ = "booking_events"
    __table_args__ = (
        CheckConstraint("btrim(label) <> ''", name="label_not_blank"),
        Index("idx_booking_events_booking", "booking_id", "occurred_at"),
    )

    id: Mapped[UuidPk]
    booking_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "bookings.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_booking_events_booking"
        )
    )
    event_type: Mapped[BookingEventType] = mapped_column(pg_enum(BookingEventType, "booking_event_type"))
    #: Libellé figé au moment du fait, lisible même si la règle a changé depuis.
    label: Mapped[str] = mapped_column(String(160))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", onupdate="CASCADE", name="fk_booking_events_actor"),
        default=None,
    )
    occurred_at: Mapped[datetime] = mapped_column(server_default=text("now()"), default=None)

    booking: Mapped["Booking"] = relationship(back_populates="events")
    actor: Mapped["User | None"] = relationship(back_populates="booking_events")


class BookingAccessCode(TimestampMixin, Base):
    __tablename__ = "booking_access_codes"
    __table_args__ = (
        CheckConstraint("expires_at > issued_at", name="expiry"),
        CheckConstraint(
            "code_hint ~ '^[A-Z0-9]-\\*{4}$'", name="hint_format"
        ),
        # Un seul code actif par réservation ; les révoqués restent pour l'audit.
        Index(
            "uq_booking_access_codes_active",
            "booking_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index("idx_booking_access_codes_booking", "booking_id", text("issued_at DESC")),
    )

    id: Mapped[UuidPk]
    booking_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "bookings.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_booking_access_codes_booking",
        )
    )
    #: Le code en clair ne vit que dans l'e-mail et sur l'écran de confirmation.
    code_hash: Mapped[str] = mapped_column(Text)
    #: Suffit à l'affichage masqué « A-**** ».
    code_hint: Mapped[str] = mapped_column(String(8))
    issued_at: Mapped[datetime] = mapped_column(server_default=text("now()"), default=None)
    expires_at: Mapped[datetime] = mapped_column(default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(default=None)

    booking: Mapped["Booking"] = relationship(back_populates="access_codes")


class BookingRule(TimestampMixin, Base):
    """Règles de réservation. Résolution : salle, puis bâtiment, puis global."""

    __tablename__ = "booking_rules"
    __table_args__ = (
        CheckConstraint(SCOPE_TARGET_CHECK, name="scope_target"),
        CheckConstraint("min_duration_min >= 15", name="min_duration"),
        CheckConstraint(
            "max_duration_min > min_duration_min", name="duration_order"
        ),
        CheckConstraint("buffer_min BETWEEN 0 AND 120", name="buffer"),
        CheckConstraint("max_advance_days BETWEEN 1 AND 365", name="advance"),
        CheckConstraint("min_advance_min BETWEEN 0 AND 1440", name="min_advance"),
        CheckConstraint(
            "cancel_deadline_min BETWEEN 0 AND 10080", name="cancel_deadline"
        ),
        CheckConstraint("checkin_window_min >= 5", name="checkin_window"),
        CheckConstraint(
            "max_active_bookings BETWEEN 1 AND 100", name="active_bookings"
        ),
        CheckConstraint(
            "validation_capacity_threshold IS NULL OR validation_capacity_threshold >= 1",
            name="threshold",
        ),
        # Un quota inférieur à une seule réservation maximale rendrait la règle
        # inapplicable.
        CheckConstraint(
            "weekly_quota_hours * 60 >= max_duration_min", name="quota_coherence"
        ),
        Index("uq_booking_rules_global", "scope", unique=True, postgresql_where=text("scope = 'global'")),
        Index(
            "uq_booking_rules_building",
            "building_id",
            unique=True,
            postgresql_where=text("scope = 'batiment'"),
        ),
        Index("uq_booking_rules_room", "room_id", unique=True, postgresql_where=text("scope = 'salle'")),
    )

    id: Mapped[UuidPk]
    scope: Mapped[RuleScope] = mapped_column(pg_enum(RuleScope, "rule_scope"))
    building_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "buildings.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_booking_rules_building"
        ),
        default=None,
    )
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_booking_rules_room"),
        default=None,
    )
    min_duration_min: Mapped[int] = mapped_column(SmallInteger, server_default=text("30"), default=30)
    max_duration_min: Mapped[int] = mapped_column(SmallInteger, server_default=text("240"), default=240)
    buffer_min: Mapped[int] = mapped_column(SmallInteger, server_default=text("15"), default=15)
    max_advance_days: Mapped[int] = mapped_column(SmallInteger, server_default=text("60"), default=60)
    #: Délai minimal avant le début du créneau. Sans lui, une réservation
    #: posée pour « dans deux minutes » passerait toutes les autres règles.
    min_advance_min: Mapped[int] = mapped_column(
        SmallInteger, server_default=text("15"), default=15
    )
    cancel_deadline_min: Mapped[int] = mapped_column(SmallInteger, server_default=text("60"), default=60)
    checkin_window_min: Mapped[int] = mapped_column(SmallInteger, server_default=text("10"), default=10)
    weekly_quota_hours: Mapped[int] = mapped_column(SmallInteger, server_default=text("12"), default=12)
    max_active_bookings: Mapped[int] = mapped_column(SmallInteger, server_default=text("10"), default=10)
    #: Au-delà, la réservation passe en validation administrative.
    validation_capacity_threshold: Mapped[int | None] = mapped_column(SmallInteger, default=None)

    building: Mapped["Building | None"] = relationship(back_populates="booking_rules")
    room: Mapped["Room | None"] = relationship(back_populates="booking_rule")


class OpeningHour(TimestampMixin, Base):
    """Jours et horaires d'ouverture. Une fermeture est `is_open = False`."""

    __tablename__ = "opening_hours"
    __table_args__ = (
        CheckConstraint(SCOPE_TARGET_CHECK, name="scope_target"),
        CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday"),
        CheckConstraint("closes_at > opens_at", name="order"),
        Index("uq_opening_hours_global", "weekday", unique=True, postgresql_where=text("scope = 'global'")),
        Index(
            "uq_opening_hours_building",
            "building_id",
            "weekday",
            unique=True,
            postgresql_where=text("scope = 'batiment'"),
        ),
        Index(
            "uq_opening_hours_room",
            "room_id",
            "weekday",
            unique=True,
            postgresql_where=text("scope = 'salle'"),
        ),
    )

    id: Mapped[UuidPk]
    scope: Mapped[RuleScope] = mapped_column(pg_enum(RuleScope, "rule_scope"))
    building_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "buildings.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_opening_hours_building"
        ),
        default=None,
    )
    room_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_opening_hours_room"),
        default=None,
    )
    #: 0 = dimanche, comme EXTRACT(DOW).
    weekday: Mapped[int] = mapped_column(SmallInteger, default=1)
    is_open: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    opens_at: Mapped[time] = mapped_column(Time, default=None)
    closes_at: Mapped[time] = mapped_column(Time, default=None)

    building: Mapped["Building | None"] = relationship(back_populates="opening_hours")
    room: Mapped["Room | None"] = relationship(back_populates="opening_hours")


class ClosurePeriod(TimestampMixin, Base):
    __tablename__ = "closure_periods"
    __table_args__ = (
        CheckConstraint("btrim(label) <> ''", name="label_not_blank"),
        CheckConstraint(
            "NOT isempty(date_span)"
            " AND lower(date_span) IS NOT NULL"
            " AND upper(date_span) IS NOT NULL",
            name="span",
        ),
        Index("idx_closure_periods_span", "date_span", postgresql_using="gist"),
        Index(
            "idx_closure_periods_created_by",
            "created_by_admin_id",
            postgresql_where=text("created_by_admin_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    label: Mapped[str] = mapped_column(String(160))
    date_span: Mapped[Range[date]] = mapped_column(DATERANGE)
    kind: Mapped[ClosureKind] = mapped_column(pg_enum(ClosureKind, "closure_kind"))
    #: Portée globale : aucune ligne de liaison. La cohérence est applicative,
    #: un CHECK ne traverse pas les tables.
    is_global: Mapped[bool] = mapped_column(server_default=text("true"), default=True)
    created_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_closure_periods_created_by",
        ),
        default=None,
    )

    created_by: Mapped["AdminAccount | None"] = relationship(back_populates="created_closures")
    buildings: Mapped[list["ClosureBuilding"]] = relationship(
        back_populates="closure", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )
    rooms: Mapped[list["ClosureRoom"]] = relationship(
        back_populates="closure", cascade="all, delete-orphan", passive_deletes=True, lazy="selectin"
    )


class ClosureBuilding(TimestampMixin, Base):
    __tablename__ = "closure_buildings"
    __table_args__ = (Index("idx_closure_buildings_building", "building_id", "closure_id"),)

    closure_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "closure_periods.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_closure_buildings_closure",
        ),
        primary_key=True,
    )
    building_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "buildings.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_closure_buildings_building",
        ),
        primary_key=True,
    )

    closure: Mapped["ClosurePeriod"] = relationship(back_populates="buildings")
    building: Mapped["Building"] = relationship(lazy="joined")


class ClosureRoom(TimestampMixin, Base):
    __tablename__ = "closure_rooms"
    __table_args__ = (Index("idx_closure_rooms_room", "room_id", "closure_id"),)

    closure_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "closure_periods.id",
            ondelete="CASCADE",
            onupdate="CASCADE",
            name="fk_closure_rooms_closure",
        ),
        primary_key=True,
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE", onupdate="CASCADE", name="fk_closure_rooms_room"),
        primary_key=True,
    )

    closure: Mapped["ClosurePeriod"] = relationship(back_populates="rooms")
    room: Mapped["Room"] = relationship(back_populates="closures", lazy="joined")


class AccessRequest(TimestampMixin, Base):
    """File d'arbitrage unique : conflits, capacité et accès hors horaires."""

    __tablename__ = "access_requests"
    __table_args__ = (
        UniqueConstraint("reference", name="uq_access_requests_reference"),
        CheckConstraint(
            "reference ~ '^#[A-Z]{3,4}-[0-9]{3,6}$'", name="reference_format"
        ),
        CheckConstraint(
            "NOT isempty(requested_range)"
            " AND lower(requested_range) IS NOT NULL"
            " AND upper(requested_range) IS NOT NULL",
            name="range",
        ),
        # `decided_by_admin_id` n'est pas exigé : il passe à NULL si le compte
        # disparaît, et l'exiger ferait échouer cette suppression.
        CheckConstraint(
            "(status = 'ouvert' AND decided_at IS NULL)"
            " OR (status <> 'ouvert' AND decided_at IS NOT NULL)",
            name="decision",
        ),
        CheckConstraint(
            "alternative_room_id IS NULL OR alternative_room_id <> room_id",
            name="alternative_differs",
        ),
        Index(
            "idx_access_requests_queue",
            "status",
            "created_at",
            postgresql_where=text("status = 'ouvert'"),
        ),
        Index("idx_access_requests_room", "room_id"),
        Index("idx_access_requests_requester", "requester_id"),
        Index(
            "idx_access_requests_booking", "booking_id", postgresql_where=text("booking_id IS NOT NULL")
        ),
        Index(
            "idx_access_requests_decided_by",
            "decided_by_admin_id",
            postgresql_where=text("decided_by_admin_id IS NOT NULL"),
        ),
        Index(
            "idx_access_requests_alternative",
            "alternative_room_id",
            postgresql_where=text("alternative_room_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    #: Référence lisible par le support : « #CONF-8492 ».
    reference: Mapped[str] = mapped_column(String(16))
    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "users.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_access_requests_requester"
        )
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rooms.id", ondelete="RESTRICT", onupdate="CASCADE", name="fk_access_requests_room")
    )
    requested_range: Mapped[Range[datetime]] = mapped_column(TSTZRANGE)
    access_type: Mapped[AccessType] = mapped_column(pg_enum(AccessType, "access_type"))
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "bookings.id", ondelete="SET NULL", onupdate="CASCADE", name="fk_access_requests_booking"
        ),
        default=None,
    )
    reason: Mapped[str | None] = mapped_column(Text, default=None)
    status: Mapped[RequestStatus] = mapped_column(
        pg_enum(RequestStatus, "request_status"),
        server_default=text("'ouvert'"),
        default=RequestStatus.OUVERT,
    )
    decided_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "admin_accounts.user_id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_access_requests_decided_by",
        ),
        default=None,
    )
    decision_comment: Mapped[str | None] = mapped_column(Text, default=None)
    alternative_room_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "rooms.id",
            ondelete="SET NULL",
            onupdate="CASCADE",
            name="fk_access_requests_alternative_room",
        ),
        default=None,
    )
    decided_at: Mapped[datetime | None] = mapped_column(default=None)

    requester: Mapped["User"] = relationship(back_populates="access_requests")
    room: Mapped["Room"] = relationship(back_populates="access_requests", foreign_keys=[room_id])
    alternative_room: Mapped["Room | None"] = relationship(foreign_keys=[alternative_room_id])
    booking: Mapped["Booking | None"] = relationship(back_populates="access_requests")
    decided_by: Mapped["AdminAccount | None"] = relationship(back_populates="decided_requests")
