"""Schéma initial de SmartRoom Manager.

Crée les extensions, les dix-sept types énumérés, les trente-neuf tables avec
leurs contraintes — dont la contrainte EXCLUDE anti-chevauchement —, les
fonctions et triggers, la vue matérialisée d'occupation et les données de
structure (référentiel des permissions, variables d'e-mail, règles globales).

Le corps des tables est issu de l'autogénération sur les modèles SQLAlchemy ;
les objets qu'Alembic ne sait pas décrire — extensions, types ENUM, fonctions,
triggers, vues — sont ajoutés ici en SQL explicite.

Revision ID: 0001_schema_initial
Revises:
Create Date: 2026-08-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_schema_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


#: Types énumérés, dans l'ordre de sql/00_extensions_enums.sql.
ENUMS: dict[str, tuple[str, ...]] = {
    "booking_status": ("en_attente", "confirmee", "terminee", "annulee"),
    "room_status": ("disponible", "maintenance", "archivee"),
    "ticket_status": ("ouvert", "en_cours", "resolu", "ferme"),
    "access_type": (
        "hors_jour_ouverture",
        "hors_horaire",
        "depassement_capacite",
        "equipement_indisponible",
        "conflit_reservation",
    ),
    "notification_channel": ("email", "in_app"),
    "booking_source": ("utilisateur", "admin", "recurrente", "blocage"),
    "booking_event_type": (
        "creation",
        "confirmation",
        "modification",
        "rappel",
        "checkin",
        "annulation",
        "liberation_auto",
    ),
    "participant_response": ("en_attente", "accepte", "decline"),
    "user_status": ("actif", "suspendu"),
    "request_status": ("ouvert", "accorde", "refuse", "reoriente"),
    "rule_scope": ("global", "batiment", "salle"),
    "closure_kind": ("fermeture", "exception"),
    "recurrence_freq": ("hebdomadaire", "bihebdomadaire", "mensuelle"),
    "equipment_category": ("audiovisuel", "mobilier", "amenagement"),
    "article_status": ("brouillon", "publie"),
    "audit_action": (
        "creation",
        "modification",
        "suppression",
        "permission",
        "maintenance",
        "connexion",
    ),
    "plan_document_kind": ("image", "pdf"),
}

#: Toutes les tables portant `updated_at`, sauf audit_logs : son horodatage doit
#: rester celui du fait, pas celui d'un signalement ultérieur.
TABLES_HORODATEES: tuple[str, ...] = (
    "access_requests",
    "admin_accounts",
    "admin_invitation_permissions",
    "admin_invitations",
    "admin_permissions",
    "booking_access_codes",
    "booking_events",
    "booking_participants",
    "booking_rules",
    "bookings",
    "buildings",
    "chatbot_intent_keywords",
    "chatbot_intents",
    "closure_buildings",
    "closure_periods",
    "closure_rooms",
    "email_template_variables",
    "email_templates",
    "equipments",
    "faq_article_links",
    "faq_articles",
    "faq_categories",
    "floor_plans",
    "floors",
    "notifications",
    "opening_hours",
    "permission_groups",
    "permissions",
    "recurrence_rules",
    "room_equipments",
    "room_photos",
    "room_placements",
    "rooms",
    "ticket_messages",
    "ticket_response_templates",
    "tickets",
    "user_preferences",
    "users",
)


FONCTION_SET_UPDATED_AT = """
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$fn$;
"""

FONCTION_AUDIT_APPEND_ONLY = """
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Le journal d''audit est immuable : suppression interdite.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    -- `actor_admin_id` peut passer à NULL : c'est l'action ON DELETE SET NULL
    -- de la clé étrangère quand le compte disparaît. Le journal reste lisible
    -- grâce à `actor_label`, figé. Toute autre réattribution reste interdite.
    IF (NEW.id, NEW.actor_label, NEW.action, NEW.target_type,
        NEW.target_id, NEW.target_label, NEW.diff_before, NEW.diff_after,
        NEW.ip_address, NEW.user_agent, NEW.session_id, NEW.occurred_at)
       IS DISTINCT FROM
       (OLD.id, OLD.actor_label, OLD.action, OLD.target_type,
        OLD.target_id, OLD.target_label, OLD.diff_before, OLD.diff_after,
        OLD.ip_address, OLD.user_agent, OLD.session_id, OLD.occurred_at)
       OR (NEW.actor_admin_id IS DISTINCT FROM OLD.actor_admin_id
           AND NEW.actor_admin_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'Le journal d''audit est immuable : seul le signalement est modifiable.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$fn$;
"""

FONCTION_TIMEZONE = """
CREATE OR REPLACE FUNCTION smartroom_timezone() RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
    SELECT 'Europe/Paris'::text;
$fn$;
"""

FONCTION_OUVERTURE = """
CREATE OR REPLACE FUNCTION resolve_opening_minutes(
    p_room_id UUID, p_building_id UUID, p_weekday SMALLINT
) RETURNS NUMERIC
LANGUAGE sql STABLE AS $fn$
    SELECT COALESCE(
        (SELECT CASE WHEN is_open
                     THEN EXTRACT(EPOCH FROM (closes_at - opens_at)) / 60 ELSE 0 END
           FROM opening_hours
          WHERE scope = 'salle' AND room_id = p_room_id AND weekday = p_weekday),
        (SELECT CASE WHEN is_open
                     THEN EXTRACT(EPOCH FROM (closes_at - opens_at)) / 60 ELSE 0 END
           FROM opening_hours
          WHERE scope = 'batiment' AND building_id = p_building_id AND weekday = p_weekday),
        (SELECT CASE WHEN is_open
                     THEN EXTRACT(EPOCH FROM (closes_at - opens_at)) / 60 ELSE 0 END
           FROM opening_hours
          WHERE scope = 'global' AND weekday = p_weekday),
        0
    );
$fn$;
"""

VUE_OCCUPATION = """
CREATE MATERIALIZED VIEW mv_room_occupancy_hourly AS
SELECT
    r.id AS room_id,
    f.building_id AS building_id,
    (tranche AT TIME ZONE smartroom_timezone())::date AS occupancy_date,
    EXTRACT(HOUR FROM tranche AT TIME ZONE smartroom_timezone())::SMALLINT AS hour_of_day,
    count(*)::INTEGER AS booking_count,
    ROUND(SUM(
        EXTRACT(EPOCH FROM (
            LEAST(upper(b.time_range), tranche + INTERVAL '1 hour')
            - GREATEST(lower(b.time_range), tranche)
        )) / 60
    )::numeric, 2) AS booked_minutes,
    count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::INTEGER AS checked_in_count,
    count(*) FILTER (WHERE b.source = 'blocage')::INTEGER AS blocking_count
FROM bookings b
JOIN rooms r ON r.id = b.room_id
JOIN floors f ON f.id = r.floor_id
CROSS JOIN LATERAL generate_series(
    date_trunc('hour', lower(b.time_range)),
    upper(b.time_range) - INTERVAL '1 microsecond',
    INTERVAL '1 hour'
) AS tranche
WHERE b.status <> 'annulee' AND b.deleted_at IS NULL
GROUP BY r.id, f.building_id, 3, 4;
"""

VUE_SALLE_JOUR = """
CREATE OR REPLACE VIEW v_room_occupancy_daily AS
SELECT
    o.room_id,
    o.building_id,
    o.occupancy_date,
    SUM(o.booking_count)::INTEGER AS booking_count,
    SUM(o.booked_minutes) AS booked_minutes,
    SUM(o.checked_in_count)::INTEGER AS checked_in_count,
    h.open_minutes,
    CASE WHEN h.open_minutes > 0
         THEN ROUND(LEAST(SUM(o.booked_minutes) / h.open_minutes, 1), 4)
         ELSE NULL END AS occupancy_rate
FROM mv_room_occupancy_hourly o
CROSS JOIN LATERAL (
    SELECT resolve_opening_minutes(
        o.room_id, o.building_id, EXTRACT(DOW FROM o.occupancy_date)::SMALLINT
    ) AS open_minutes
) AS h
GROUP BY o.room_id, o.building_id, o.occupancy_date, h.open_minutes;
"""

VUE_BATIMENT_JOUR = """
CREATE OR REPLACE VIEW v_building_occupancy_daily AS
SELECT
    d.building_id,
    d.occupancy_date,
    COUNT(DISTINCT d.room_id)::INTEGER AS room_count,
    SUM(d.booking_count)::INTEGER AS booking_count,
    SUM(d.booked_minutes) AS booked_minutes,
    SUM(d.open_minutes) AS open_minutes,
    CASE WHEN SUM(d.open_minutes) > 0
         THEN ROUND(SUM(d.booked_minutes) / SUM(d.open_minutes), 4)
         ELSE NULL END AS occupancy_rate
FROM v_room_occupancy_daily d
GROUP BY d.building_id, d.occupancy_date;
"""

FONCTION_REFRESH = """
CREATE OR REPLACE FUNCTION refresh_room_occupancy(p_concurrently BOOLEAN DEFAULT true)
RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
    IF p_concurrently THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_room_occupancy_hourly;
    ELSE
        REFRESH MATERIALIZED VIEW mv_room_occupancy_hourly;
    END IF;
END;
$fn$;
"""

#: Référentiels figés par le code applicatif : ils appartiennent au schéma, pas
#: au jeu de démonstration.
DONNEES_DE_STRUCTURE = """
INSERT INTO permission_groups (code, label, sort_order) VALUES
    ('espaces', 'Gestion des espaces', 1),
    ('utilisateurs', 'Gestion des utilisateurs', 2),
    ('operations', 'Opérations', 3),
    ('administration', 'Administration', 4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (group_id, code, label, sort_order)
SELECT g.id, v.code, v.label, v.sort_order
  FROM (VALUES
        ('espaces', 'rooms.manage', 'Gérer les salles et équipements', 1),
        ('espaces', 'rules.configure', 'Configurer les règles de réservation', 2),
        ('utilisateurs', 'users.manage', 'Gérer les comptes utilisateurs', 1),
        ('utilisateurs', 'support.handle', 'Traiter les demandes d''aide', 2),
        ('operations', 'conflicts.arbitrate', 'Arbitrer les conflits', 1),
        ('operations', 'data.export', 'Exporter les données', 2),
        ('administration', 'system.configure', 'Configurer le système', 1)
       ) AS v(group_code, code, label, sort_order)
  JOIN permission_groups g ON g.code = v.group_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO email_template_variables (code, label, sample_value) VALUES
    ('prenom', 'Prénom du destinataire', 'Dylan'),
    ('salle', 'Nom de la salle', 'Salle Vinci'),
    ('batiment', 'Bâtiment et étage', 'Bâtiment A — 2e étage'),
    ('date', 'Date de la réservation', 'jeudi 26 mars 2026'),
    ('creneau', 'Créneau horaire', '14:00 - 15:30'),
    ('code_acces', 'Code d''accès temporaire', 'A-4821'),
    ('lien_reservation', 'Lien vers la réservation', 'https://smartroom.ece.fr/app/reservations/1')
ON CONFLICT (code) DO NOTHING;

INSERT INTO booking_rules (scope) VALUES ('global') ON CONFLICT DO NOTHING;

INSERT INTO opening_hours (scope, weekday, is_open, opens_at, closes_at) VALUES
    ('global', 1, true, '08:00', '20:00'),
    ('global', 2, true, '08:00', '20:00'),
    ('global', 3, true, '08:00', '20:00'),
    ('global', 4, true, '08:00', '20:00'),
    ('global', 5, true, '08:00', '20:00'),
    ('global', 6, true, '09:00', '13:00'),
    ('global', 0, false, '00:00', '23:59')
ON CONFLICT DO NOTHING;
"""


def upgrade() -> None:
    # pgcrypto pour gen_random_uuid(), btree_gist pour la contrainte EXCLUDE,
    # citext pour les e-mails, pg_trgm pour les recherches par similarité.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # Types créés ici et non par les CREATE TABLE : plusieurs tables partagent
    # le même type, chacune tenterait de le créer.
    for nom, valeurs in ENUMS.items():
        libelles = ", ".join(f"'{valeur}'" for valeur in valeurs)
        op.execute(f"CREATE TYPE {nom} AS ENUM ({libelles})")

    op.create_table('buildings',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=4), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('address', sa.String(length=255), nullable=True),
    sa.Column('sort_order', sa.SmallInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(name) <> ''", name=op.f('ck_buildings_name_not_blank')),
    sa.CheckConstraint("code ~ '^[A-Z0-9]{1,4}$'", name=op.f('ck_buildings_code_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_buildings')),
    sa.UniqueConstraint('code', name='uq_buildings_code')
    )
    op.create_index('idx_buildings_sort_order', 'buildings', ['sort_order', 'name'], unique=False)
    op.create_table('email_template_variables',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('sample_value', sa.String(length=180), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name=op.f('ck_email_template_variables_code_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_template_variables')),
    sa.UniqueConstraint('code', name='uq_email_template_variables_code')
    )
    op.create_table('equipments',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('category', postgresql.ENUM('audiovisuel', 'mobilier', 'amenagement', name='equipment_category', create_type=False), nullable=False),
    sa.Column('icon', sa.String(length=40), nullable=False),
    sa.Column('description', sa.String(length=255), nullable=True),
    sa.Column('is_filterable', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(label) <> ''", name=op.f('ck_equipments_label_not_blank')),
    sa.CheckConstraint("code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f('ck_equipments_code_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_equipments')),
    sa.UniqueConstraint('code', name='uq_equipments_code')
    )
    op.create_index('idx_equipments_filterable', 'equipments', ['category', 'label'], unique=False, postgresql_where=sa.text('is_filterable'))
    op.create_table('faq_categories',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('icon', sa.String(length=40), nullable=True),
    sa.Column('sort_order', sa.SmallInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name=op.f('ck_faq_categories_code_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_faq_categories')),
    sa.UniqueConstraint('code', name='uq_faq_categories_code')
    )
    op.create_table('permission_groups',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=80), nullable=False),
    sa.Column('sort_order', sa.SmallInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name=op.f('ck_permission_groups_code_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_permission_groups')),
    sa.UniqueConstraint('code', name='uq_permission_groups_code')
    )
    op.create_table('ticket_response_templates',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(body) <> ''", name=op.f('ck_ticket_response_templates_body_not_blank')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ticket_response_templates')),
    sa.UniqueConstraint('code', name='uq_ticket_response_templates_code')
    )
    op.create_index('idx_ticket_response_templates_category', 'ticket_response_templates', ['category', 'label'], unique=False, postgresql_where=sa.text('is_active'))
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', postgresql.CITEXT(), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('first_name', sa.String(length=80), nullable=False),
    sa.Column('last_name', sa.String(length=80), nullable=False),
    sa.Column('phone', sa.String(length=20), nullable=True),
    sa.Column('promotion', sa.String(length=60), nullable=True),
    sa.Column('department', sa.String(length=60), nullable=True),
    sa.Column('badge_number', sa.String(length=20), nullable=True),
    sa.Column('status', postgresql.ENUM('actif', 'suspendu', name='user_status', create_type=False), server_default=sa.text("'actif'"), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("btrim(first_name) <> ''", name=op.f('ck_users_first_name_not_blank')),
    sa.CheckConstraint("btrim(last_name) <> ''", name=op.f('ck_users_last_name_not_blank')),
    sa.CheckConstraint("deleted_at IS NULL OR status = 'suspendu'", name=op.f('ck_users_deleted_is_suspended')),
    sa.CheckConstraint("email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'", name=op.f('ck_users_email_format')),
    sa.CheckConstraint("phone IS NULL OR phone ~ '^[0-9 +.()-]{6,20}$'", name=op.f('ck_users_phone_format')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    op.create_index('idx_users_directory', 'users', ['status', 'department', 'promotion'], unique=False, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('idx_users_name_trgm', 'users', [sa.literal_column("(first_name || ' ' || last_name) gin_trgm_ops")], unique=False, postgresql_using='gin', postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('uq_users_badge_number', 'users', ['badge_number'], unique=True, postgresql_where=sa.text('deleted_at IS NULL AND badge_number IS NOT NULL'))
    op.create_index('uq_users_email', 'users', ['email'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_table('admin_accounts',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('job_title', sa.String(length=80), nullable=False),
    sa.Column('is_owner', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('last_admin_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(job_title) <> ''", name=op.f('ck_admin_accounts_job_title')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_admin_accounts_user', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_admin_accounts'))
    )
    op.create_index('uq_admin_accounts_single_owner', 'admin_accounts', ['is_owner'], unique=True, postgresql_where=sa.text('is_owner'))
    op.create_table('faq_articles',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('category_id', sa.UUID(), nullable=False),
    sa.Column('slug', sa.String(length=160), nullable=False),
    sa.Column('title', sa.String(length=180), nullable=False),
    sa.Column('excerpt', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('status', postgresql.ENUM('brouillon', 'publie', name='article_status', create_type=False), server_default=sa.text("'brouillon'"), nullable=False),
    sa.Column('view_count', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'publie') = (published_at IS NOT NULL)", name=op.f('ck_faq_articles_published')),
    sa.CheckConstraint("btrim(title) <> ''", name=op.f('ck_faq_articles_title_not_blank')),
    sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f('ck_faq_articles_slug_format')),
    sa.CheckConstraint("status <> 'publie' OR length(btrim(body)) >= 40", name=op.f('ck_faq_articles_publishable')),
    sa.CheckConstraint('view_count >= 0', name=op.f('ck_faq_articles_views')),
    sa.ForeignKeyConstraint(['category_id'], ['faq_categories.id'], name='fk_faq_articles_category', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_faq_articles')),
    sa.UniqueConstraint('slug', name='uq_faq_articles_slug')
    )
    op.create_index('idx_faq_articles_category', 'faq_articles', ['category_id'], unique=False)
    op.create_index('idx_faq_articles_published', 'faq_articles', ['category_id', sa.literal_column('view_count DESC')], unique=False, postgresql_where=sa.text("status = 'publie'"))
    op.create_index('idx_faq_articles_search_trgm', 'faq_articles', [sa.literal_column("(title || ' ' || excerpt) gin_trgm_ops")], unique=False, postgresql_using='gin')
    op.create_table('floors',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('building_id', sa.UUID(), nullable=False),
    sa.Column('code', sa.String(length=8), nullable=False),
    sa.Column('label', sa.String(length=60), nullable=False),
    sa.Column('level', sa.SmallInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('level BETWEEN -5 AND 60', name=op.f('ck_floors_level_range')),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name='fk_floors_building', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_floors')),
    sa.UniqueConstraint('building_id', 'code', name='uq_floors_building_code'),
    sa.UniqueConstraint('building_id', 'level', name='uq_floors_building_level')
    )
    op.create_index('idx_floors_building_id', 'floors', ['building_id', 'level'], unique=False)
    op.create_table('permissions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('group_id', sa.UUID(), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('sort_order', sa.SmallInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("code ~ '^[a-z]+\\.[a-z]+$'", name=op.f('ck_permissions_code_format')),
    sa.ForeignKeyConstraint(['group_id'], ['permission_groups.id'], name='fk_permissions_group', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_permissions')),
    sa.UniqueConstraint('code', name='uq_permissions_code')
    )
    op.create_index('idx_permissions_group', 'permissions', ['group_id', 'sort_order'], unique=False)
    op.create_table('user_preferences',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('preferred_building_id', sa.UUID(), nullable=True),
    sa.Column('usual_capacity_min', sa.SmallInteger(), nullable=True),
    sa.Column('usual_capacity_max', sa.SmallInteger(), nullable=True),
    sa.Column('email_notifications', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('in_app_notifications', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('reminder_delay_min', sa.SmallInteger(), server_default=sa.text('30'), nullable=False),
    sa.Column('weekly_quota_hours', sa.SmallInteger(), server_default=sa.text('12'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('(usual_capacity_min IS NULL AND usual_capacity_max IS NULL) OR (usual_capacity_min IS NOT NULL AND usual_capacity_max IS NOT NULL     AND usual_capacity_min >= 1 AND usual_capacity_min <= usual_capacity_max)', name=op.f('ck_user_preferences_capacity')),
    sa.CheckConstraint('reminder_delay_min BETWEEN 5 AND 1440', name=op.f('ck_user_preferences_reminder')),
    sa.CheckConstraint('weekly_quota_hours BETWEEN 0 AND 168', name=op.f('ck_user_preferences_quota')),
    sa.ForeignKeyConstraint(['preferred_building_id'], ['buildings.id'], name='fk_user_preferences_building', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_user_preferences_user', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_user_preferences'))
    )
    op.create_index('idx_user_preferences_building', 'user_preferences', ['preferred_building_id'], unique=False, postgresql_where=sa.text('preferred_building_id IS NOT NULL'))
    op.create_table('admin_invitations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', postgresql.CITEXT(), nullable=False),
    sa.Column('token_hash', sa.Text(), nullable=False),
    sa.Column('invited_by_admin_id', sa.UUID(), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'", name=op.f('ck_admin_invitations_email_format')),
    sa.CheckConstraint('accepted_at IS NULL OR revoked_at IS NULL', name=op.f('ck_admin_invitations_final_state')),
    sa.CheckConstraint('expires_at > sent_at', name=op.f('ck_admin_invitations_expiry')),
    sa.ForeignKeyConstraint(['invited_by_admin_id'], ['admin_accounts.user_id'], name='fk_admin_invitations_invited_by', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_admin_invitations')),
    sa.UniqueConstraint('token_hash', name='uq_admin_invitations_token')
    )
    op.create_index('idx_admin_invitations_invited_by', 'admin_invitations', ['invited_by_admin_id', sa.literal_column('sent_at DESC')], unique=False)
    op.create_index('uq_admin_invitations_pending', 'admin_invitations', ['email'], unique=True, postgresql_where=sa.text('accepted_at IS NULL AND revoked_at IS NULL'))
    op.create_table('admin_permissions',
    sa.Column('admin_user_id', sa.UUID(), nullable=False),
    sa.Column('permission_id', sa.UUID(), nullable=False),
    sa.Column('granted_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('granted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['admin_user_id'], ['admin_accounts.user_id'], name='fk_admin_permissions_admin', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['granted_by_admin_id'], ['admin_accounts.user_id'], name='fk_admin_permissions_granted_by', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], name='fk_admin_permissions_permission', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('admin_user_id', 'permission_id', name=op.f('pk_admin_permissions'))
    )
    op.create_index('idx_admin_permissions_granted_by', 'admin_permissions', ['granted_by_admin_id'], unique=False, postgresql_where=sa.text('granted_by_admin_id IS NOT NULL'))
    op.create_index('idx_admin_permissions_permission', 'admin_permissions', ['permission_id', 'admin_user_id'], unique=False)
    op.create_table('audit_logs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('actor_label', sa.String(length=120), nullable=False),
    sa.Column('action', postgresql.ENUM('creation', 'modification', 'suppression', 'permission', 'maintenance', 'connexion', name='audit_action', create_type=False), nullable=False),
    sa.Column('target_type', sa.String(length=60), nullable=False),
    sa.Column('target_label', sa.String(length=160), nullable=False),
    sa.Column('actor_admin_id', sa.UUID(), nullable=True),
    sa.Column('target_id', sa.UUID(), nullable=True),
    sa.Column('diff_before', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('diff_after', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('ip_address', postgresql.INET(), nullable=True),
    sa.Column('user_agent', sa.String(length=255), nullable=True),
    sa.Column('session_id', sa.String(length=64), nullable=True),
    sa.Column('flagged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('flag_reason', sa.String(length=255), nullable=True),
    sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(actor_label) <> ''", name=op.f('ck_audit_logs_actor_label_not_blank')),
    sa.CheckConstraint("btrim(target_label) <> ''", name=op.f('ck_audit_logs_target_label_not_blank')),
    sa.CheckConstraint('flag_reason IS NULL OR flagged_at IS NOT NULL', name=op.f('ck_audit_logs_flag')),
    sa.ForeignKeyConstraint(['actor_admin_id'], ['admin_accounts.user_id'], name='fk_audit_logs_actor', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_logs'))
    )
    op.create_index('idx_audit_logs_action', 'audit_logs', ['action', sa.literal_column('occurred_at DESC')], unique=False)
    op.create_index('idx_audit_logs_actor', 'audit_logs', ['actor_admin_id', sa.literal_column('occurred_at DESC')], unique=False, postgresql_where=sa.text('actor_admin_id IS NOT NULL'))
    op.create_index('idx_audit_logs_flagged', 'audit_logs', [sa.literal_column('occurred_at DESC')], unique=False, postgresql_where=sa.text('flagged_at IS NOT NULL'))
    op.create_index('idx_audit_logs_occurred', 'audit_logs', [sa.literal_column('occurred_at DESC')], unique=False)
    op.create_index('idx_audit_logs_search_trgm', 'audit_logs', [sa.literal_column("(target_label || ' ' || actor_label) gin_trgm_ops")], unique=False, postgresql_using='gin')
    op.create_index('idx_audit_logs_target', 'audit_logs', ['target_type', 'target_id'], unique=False)
    op.create_table('chatbot_intents',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('answer', sa.Text(), nullable=False),
    sa.Column('quick_replies', sa.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
    sa.Column('escalates_to_ticket', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('faq_article_id', sa.UUID(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(answer) <> ''", name=op.f('ck_chatbot_intents_answer_not_blank')),
    sa.CheckConstraint("code ~ '^[a-z][a-z0-9_]*$'", name=op.f('ck_chatbot_intents_code_format')),
    sa.CheckConstraint('array_length(quick_replies, 1) IS NULL OR array_length(quick_replies, 1) <= 5', name=op.f('ck_chatbot_intents_quick_replies')),
    sa.ForeignKeyConstraint(['faq_article_id'], ['faq_articles.id'], name='fk_chatbot_intents_article', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_chatbot_intents')),
    sa.UniqueConstraint('code', name='uq_chatbot_intents_code')
    )
    op.create_index('idx_chatbot_intents_article', 'chatbot_intents', ['faq_article_id'], unique=False, postgresql_where=sa.text('faq_article_id IS NOT NULL'))
    op.create_table('closure_periods',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('label', sa.String(length=160), nullable=False),
    sa.Column('date_span', postgresql.DATERANGE(), nullable=False),
    sa.Column('kind', postgresql.ENUM('fermeture', 'exception', name='closure_kind', create_type=False), nullable=False),
    sa.Column('is_global', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(label) <> ''", name=op.f('ck_closure_periods_label_not_blank')),
    sa.CheckConstraint('NOT isempty(date_span) AND lower(date_span) IS NOT NULL AND upper(date_span) IS NOT NULL', name=op.f('ck_closure_periods_span')),
    sa.ForeignKeyConstraint(['created_by_admin_id'], ['admin_accounts.user_id'], name='fk_closure_periods_created_by', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_closure_periods'))
    )
    op.create_index('idx_closure_periods_created_by', 'closure_periods', ['created_by_admin_id'], unique=False, postgresql_where=sa.text('created_by_admin_id IS NOT NULL'))
    op.create_index('idx_closure_periods_span', 'closure_periods', ['date_span'], unique=False, postgresql_using='gist')
    op.create_table('email_templates',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('trigger_label', sa.String(length=180), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('updated_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(body) <> ''", name=op.f('ck_email_templates_body_not_blank')),
    sa.CheckConstraint("btrim(subject) <> ''", name=op.f('ck_email_templates_subject_not_blank')),
    sa.ForeignKeyConstraint(['updated_by_admin_id'], ['admin_accounts.user_id'], name='fk_email_templates_updated_by', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_templates')),
    sa.UniqueConstraint('code', name='uq_email_templates_code')
    )
    op.create_index('idx_email_templates_updated_by', 'email_templates', ['updated_by_admin_id'], unique=False, postgresql_where=sa.text('updated_by_admin_id IS NOT NULL'))
    op.create_table('faq_article_links',
    sa.Column('article_id', sa.UUID(), nullable=False),
    sa.Column('related_article_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('article_id <> related_article_id', name=op.f('ck_faq_article_links_not_self')),
    sa.ForeignKeyConstraint(['article_id'], ['faq_articles.id'], name='fk_faq_article_links_article', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['related_article_id'], ['faq_articles.id'], name='fk_faq_article_links_related', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('article_id', 'related_article_id', name=op.f('pk_faq_article_links'))
    )
    op.create_index('idx_faq_article_links_related', 'faq_article_links', ['related_article_id'], unique=False)
    op.create_table('floor_plans',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('floor_id', sa.UUID(), nullable=False),
    sa.Column('kind', postgresql.ENUM('image', 'pdf', name='plan_document_kind', create_type=False), nullable=False),
    sa.Column('file_url', sa.Text(), nullable=False),
    sa.Column('file_name', sa.String(length=160), nullable=False),
    sa.Column('file_size_bytes', sa.Integer(), nullable=False),
    sa.Column('uploaded_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(file_name) <> ''", name=op.f('ck_floor_plans_file_name')),
    sa.CheckConstraint('file_size_bytes > 0 AND file_size_bytes <= 5 * 1024 * 1024', name=op.f('ck_floor_plans_size')),
    sa.ForeignKeyConstraint(['floor_id'], ['floors.id'], name='fk_floor_plans_floor', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by_admin_id'], ['admin_accounts.user_id'], name='fk_floor_plans_uploaded_by_admin', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_floor_plans')),
    sa.UniqueConstraint('floor_id', name='uq_floor_plans_floor')
    )
    op.create_index('idx_floor_plans_uploaded_by', 'floor_plans', ['uploaded_by_admin_id'], unique=False, postgresql_where=sa.text('uploaded_by_admin_id IS NOT NULL'))
    op.create_table('rooms',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('floor_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('slug', sa.String(length=140), nullable=False),
    sa.Column('capacity', sa.SmallInteger(), nullable=False),
    sa.Column('area_m2', sa.NUMERIC(precision=6, scale=2), nullable=False),
    sa.Column('status', postgresql.ENUM('disponible', 'maintenance', 'archivee', name='room_status', create_type=False), server_default=sa.text("'disponible'"), nullable=False),
    sa.Column('is_accessible', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('badge_required', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('access_code_hash', sa.Text(), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("btrim(name) <> ''", name=op.f('ck_rooms_name_not_blank')),
    sa.CheckConstraint("deleted_at IS NULL OR status = 'archivee'", name=op.f('ck_rooms_archived_state')),
    sa.CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name=op.f('ck_rooms_slug_format')),
    sa.CheckConstraint('area_m2 > 0 AND area_m2 <= 5000', name=op.f('ck_rooms_area')),
    sa.CheckConstraint('capacity BETWEEN 1 AND 500', name=op.f('ck_rooms_capacity')),
    sa.ForeignKeyConstraint(['floor_id'], ['floors.id'], name='fk_rooms_floor', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_rooms'))
    )
    op.create_index('idx_rooms_floor_id', 'rooms', ['floor_id'], unique=False)
    op.create_index('idx_rooms_name_trgm', 'rooms', [sa.literal_column('name gin_trgm_ops')], unique=False, postgresql_using='gin', postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('idx_rooms_search', 'rooms', ['status', 'capacity', 'floor_id'], unique=False, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('uq_rooms_floor_name', 'rooms', ['floor_id', 'name'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('uq_rooms_slug', 'rooms', ['slug'], unique=True, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_table('admin_invitation_permissions',
    sa.Column('invitation_id', sa.UUID(), nullable=False),
    sa.Column('permission_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['invitation_id'], ['admin_invitations.id'], name='fk_admin_invitation_permissions_invitation', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], name='fk_admin_invitation_permissions_permission', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('invitation_id', 'permission_id', name=op.f('pk_admin_invitation_permissions'))
    )
    op.create_index('idx_admin_invitation_permissions_permission', 'admin_invitation_permissions', ['permission_id'], unique=False)
    op.create_table('booking_rules',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('scope', postgresql.ENUM('global', 'batiment', 'salle', name='rule_scope', create_type=False), nullable=False),
    sa.Column('building_id', sa.UUID(), nullable=True),
    sa.Column('room_id', sa.UUID(), nullable=True),
    sa.Column('min_duration_min', sa.SmallInteger(), server_default=sa.text('30'), nullable=False),
    sa.Column('max_duration_min', sa.SmallInteger(), server_default=sa.text('240'), nullable=False),
    sa.Column('buffer_min', sa.SmallInteger(), server_default=sa.text('15'), nullable=False),
    sa.Column('max_advance_days', sa.SmallInteger(), server_default=sa.text('60'), nullable=False),
    sa.Column('cancel_deadline_min', sa.SmallInteger(), server_default=sa.text('60'), nullable=False),
    sa.Column('checkin_window_min', sa.SmallInteger(), server_default=sa.text('10'), nullable=False),
    sa.Column('weekly_quota_hours', sa.SmallInteger(), server_default=sa.text('12'), nullable=False),
    sa.Column('max_active_bookings', sa.SmallInteger(), server_default=sa.text('10'), nullable=False),
    sa.Column('validation_capacity_threshold', sa.SmallInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(scope = 'global'   AND building_id IS NULL     AND room_id IS NULL) OR (scope = 'batiment' AND building_id IS NOT NULL AND room_id IS NULL) OR (scope = 'salle'    AND building_id IS NULL     AND room_id IS NOT NULL)", name=op.f('ck_booking_rules_scope_target')),
    sa.CheckConstraint('buffer_min BETWEEN 0 AND 120', name=op.f('ck_booking_rules_buffer')),
    sa.CheckConstraint('cancel_deadline_min BETWEEN 0 AND 10080', name=op.f('ck_booking_rules_cancel_deadline')),
    sa.CheckConstraint('checkin_window_min >= 5', name=op.f('ck_booking_rules_checkin_window')),
    sa.CheckConstraint('max_active_bookings BETWEEN 1 AND 100', name=op.f('ck_booking_rules_active_bookings')),
    sa.CheckConstraint('max_advance_days BETWEEN 1 AND 365', name=op.f('ck_booking_rules_advance')),
    sa.CheckConstraint('max_duration_min > min_duration_min', name=op.f('ck_booking_rules_duration_order')),
    sa.CheckConstraint('min_duration_min >= 15', name=op.f('ck_booking_rules_min_duration')),
    sa.CheckConstraint('validation_capacity_threshold IS NULL OR validation_capacity_threshold >= 1', name=op.f('ck_booking_rules_threshold')),
    sa.CheckConstraint('weekly_quota_hours * 60 >= max_duration_min', name=op.f('ck_booking_rules_quota_coherence')),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name='fk_booking_rules_building', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_booking_rules_room', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_booking_rules'))
    )
    op.create_index('uq_booking_rules_building', 'booking_rules', ['building_id'], unique=True, postgresql_where=sa.text("scope = 'batiment'"))
    op.create_index('uq_booking_rules_global', 'booking_rules', ['scope'], unique=True, postgresql_where=sa.text("scope = 'global'"))
    op.create_index('uq_booking_rules_room', 'booking_rules', ['room_id'], unique=True, postgresql_where=sa.text("scope = 'salle'"))
    op.create_table('chatbot_intent_keywords',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('intent_id', sa.UUID(), nullable=False),
    sa.Column('keyword', postgresql.CITEXT(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(keyword) <> ''", name=op.f('ck_chatbot_intent_keywords_not_blank')),
    sa.ForeignKeyConstraint(['intent_id'], ['chatbot_intents.id'], name='fk_chatbot_intent_keywords_intent', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_chatbot_intent_keywords')),
    sa.UniqueConstraint('intent_id', 'keyword', name='uq_chatbot_intent_keywords')
    )
    op.create_index('idx_chatbot_intent_keywords_keyword', 'chatbot_intent_keywords', ['keyword'], unique=False)
    op.create_table('closure_buildings',
    sa.Column('closure_id', sa.UUID(), nullable=False),
    sa.Column('building_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name='fk_closure_buildings_building', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['closure_id'], ['closure_periods.id'], name='fk_closure_buildings_closure', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('closure_id', 'building_id', name=op.f('pk_closure_buildings'))
    )
    op.create_index('idx_closure_buildings_building', 'closure_buildings', ['building_id', 'closure_id'], unique=False)
    op.create_table('closure_rooms',
    sa.Column('closure_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['closure_id'], ['closure_periods.id'], name='fk_closure_rooms_closure', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_closure_rooms_room', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('closure_id', 'room_id', name=op.f('pk_closure_rooms'))
    )
    op.create_index('idx_closure_rooms_room', 'closure_rooms', ['room_id', 'closure_id'], unique=False)
    op.create_table('opening_hours',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('scope', postgresql.ENUM('global', 'batiment', 'salle', name='rule_scope', create_type=False), nullable=False),
    sa.Column('building_id', sa.UUID(), nullable=True),
    sa.Column('room_id', sa.UUID(), nullable=True),
    sa.Column('weekday', sa.SmallInteger(), nullable=False),
    sa.Column('is_open', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('opens_at', sa.Time(), nullable=False),
    sa.Column('closes_at', sa.Time(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(scope = 'global'   AND building_id IS NULL     AND room_id IS NULL) OR (scope = 'batiment' AND building_id IS NOT NULL AND room_id IS NULL) OR (scope = 'salle'    AND building_id IS NULL     AND room_id IS NOT NULL)", name=op.f('ck_opening_hours_scope_target')),
    sa.CheckConstraint('closes_at > opens_at', name=op.f('ck_opening_hours_order')),
    sa.CheckConstraint('weekday BETWEEN 0 AND 6', name=op.f('ck_opening_hours_weekday')),
    sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], name='fk_opening_hours_building', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_opening_hours_room', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_opening_hours'))
    )
    op.create_index('uq_opening_hours_building', 'opening_hours', ['building_id', 'weekday'], unique=True, postgresql_where=sa.text("scope = 'batiment'"))
    op.create_index('uq_opening_hours_global', 'opening_hours', ['weekday'], unique=True, postgresql_where=sa.text("scope = 'global'"))
    op.create_index('uq_opening_hours_room', 'opening_hours', ['room_id', 'weekday'], unique=True, postgresql_where=sa.text("scope = 'salle'"))
    op.create_table('recurrence_rules',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('freq', postgresql.ENUM('hebdomadaire', 'bihebdomadaire', 'mensuelle', name='recurrence_freq', create_type=False), nullable=False),
    sa.Column('interval_count', sa.SmallInteger(), server_default=sa.text('1'), nullable=False),
    sa.Column('byweekday', sa.ARRAY(sa.SmallInteger()), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('until_date', sa.Date(), nullable=False),
    sa.Column('start_time', sa.Time(), nullable=False),
    sa.Column('end_time', sa.Time(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("until_date <= start_date + INTERVAL '1 year'", name=op.f('ck_recurrence_rules_horizon')),
    sa.CheckConstraint('array_length(byweekday, 1) BETWEEN 1 AND 7 AND byweekday <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]', name=op.f('ck_recurrence_rules_weekdays')),
    sa.CheckConstraint('end_time > start_time', name=op.f('ck_recurrence_rules_times')),
    sa.CheckConstraint('interval_count BETWEEN 1 AND 12', name=op.f('ck_recurrence_rules_interval')),
    sa.CheckConstraint('until_date >= start_date', name=op.f('ck_recurrence_rules_dates')),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name='fk_recurrence_rules_owner', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_recurrence_rules_room', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_recurrence_rules'))
    )
    op.create_index('idx_recurrence_rules_owner', 'recurrence_rules', ['owner_id', sa.literal_column('start_date DESC')], unique=False)
    op.create_index('idx_recurrence_rules_room', 'recurrence_rules', ['room_id'], unique=False)
    op.create_table('room_equipments',
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('equipment_id', sa.UUID(), nullable=False),
    sa.Column('quantity', sa.SmallInteger(), server_default=sa.text('1'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('quantity > 0 AND quantity <= 50', name=op.f('ck_room_equipments_quantity')),
    sa.ForeignKeyConstraint(['equipment_id'], ['equipments.id'], name='fk_room_equipments_equipment', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_room_equipments_room', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('room_id', 'equipment_id', name=op.f('pk_room_equipments'))
    )
    op.create_index('idx_room_equipments_equipment', 'room_equipments', ['equipment_id', 'room_id'], unique=False)
    op.create_table('room_photos',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('file_url', sa.Text(), nullable=False),
    sa.Column('alt_text', sa.String(length=160), nullable=True),
    sa.Column('position', sa.SmallInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('position BETWEEN 0 AND 5', name=op.f('ck_room_photos_position')),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_room_photos_room', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_room_photos')),
    sa.UniqueConstraint('room_id', 'position', name='uq_room_photos_position')
    )
    op.create_index('idx_room_photos_room_id', 'room_photos', ['room_id', 'position'], unique=False)
    op.create_table('room_placements',
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('pos_x', sa.NUMERIC(precision=5, scale=2), nullable=False),
    sa.Column('pos_y', sa.NUMERIC(precision=5, scale=2), nullable=False),
    sa.Column('width', sa.NUMERIC(precision=5, scale=2), nullable=False),
    sa.Column('height', sa.NUMERIC(precision=5, scale=2), nullable=False),
    sa.Column('rotation', sa.SmallInteger(), server_default=sa.text('0'), nullable=False),
    sa.Column('is_entrance_marked', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('pos_x + width <= 100 AND pos_y + height <= 100', name=op.f('ck_room_placements_bounds')),
    sa.CheckConstraint('pos_x >= 0 AND pos_y >= 0', name=op.f('ck_room_placements_origin')),
    sa.CheckConstraint('rotation IN (0, 90, 180, 270)', name=op.f('ck_room_placements_rotation')),
    sa.CheckConstraint('width > 0 AND height > 0', name=op.f('ck_room_placements_size')),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_room_placements_room', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('room_id', name=op.f('pk_room_placements'))
    )
    op.create_table('bookings',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('created_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('recurrence_rule_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(length=160), nullable=False),
    sa.Column('time_range', postgresql.TSTZRANGE(), nullable=False),
    sa.Column('attendee_count', sa.SmallInteger(), nullable=False),
    sa.Column('status', postgresql.ENUM('en_attente', 'confirmee', 'terminee', 'annulee', name='booking_status', create_type=False), server_default=sa.text("'confirmee'"), nullable=False),
    sa.Column('source', postgresql.ENUM('utilisateur', 'admin', 'recurrente', 'blocage', name='booking_source', create_type=False), server_default=sa.text("'utilisateur'"), nullable=False),
    sa.Column('is_forced', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('checked_in_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancel_reason', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    postgresql.ExcludeConstraint((sa.column('room_id'), '='), (sa.column('time_range'), '&&'), where=sa.text("status <> 'annulee' AND deleted_at IS NULL"), using='gist', name='ex_bookings_no_overlap'),
    sa.CheckConstraint("(owner_id IS NULL) = (source = 'blocage')", name=op.f('ck_bookings_owner_presence')),
    sa.CheckConstraint("(status = 'annulee') = (cancelled_at IS NOT NULL) AND (status = 'annulee')     = (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')", name=op.f('ck_bookings_cancel_state')),
    sa.CheckConstraint("attendee_count >= 0 AND (source = 'blocage' OR attendee_count > 0)", name=op.f('ck_bookings_attendee_count')),
    sa.CheckConstraint("btrim(title) <> ''", name=op.f('ck_bookings_title_not_blank')),
    sa.CheckConstraint("recurrence_rule_id IS NULL OR source = 'recurrente'", name=op.f('ck_bookings_recurrence_source')),
    sa.CheckConstraint("source <> 'blocage' OR (upper(time_range) - lower(time_range)) <= INTERVAL '30 days'", name=op.f('ck_bookings_blocking_duration')),
    sa.CheckConstraint("source = 'blocage' OR (upper(time_range) - lower(time_range))     BETWEEN INTERVAL '30 minutes' AND INTERVAL '4 hours'", name=op.f('ck_bookings_duration')),
    sa.CheckConstraint("status <> 'annulee' OR checked_in_at IS NULL", name=op.f('ck_bookings_cancelled_not_checked_in')),
    sa.CheckConstraint('NOT isempty(time_range) AND lower(time_range) IS NOT NULL AND upper(time_range) IS NOT NULL AND lower_inc(time_range) AND NOT upper_inc(time_range)', name=op.f('ck_bookings_range_bounds')),
    sa.CheckConstraint('checked_in_at IS NULL OR checked_in_at >= lower(time_range)', name=op.f('ck_bookings_checkin_after_start')),
    sa.ForeignKeyConstraint(['created_by_admin_id'], ['admin_accounts.user_id'], name='fk_bookings_created_by_admin', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name='fk_bookings_owner', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['recurrence_rule_id'], ['recurrence_rules.id'], name='fk_bookings_recurrence', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_bookings_room', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_bookings'))
    )
    op.create_index('idx_bookings_checkin_pending', 'bookings', [sa.literal_column('lower(time_range)')], unique=False, postgresql_where=sa.text("status = 'confirmee' AND checked_in_at IS NULL AND deleted_at IS NULL"))
    op.create_index('idx_bookings_created_by_admin', 'bookings', ['created_by_admin_id'], unique=False, postgresql_where=sa.text('created_by_admin_id IS NOT NULL'))
    op.create_index('idx_bookings_owner_start', 'bookings', ['owner_id', sa.literal_column('lower(time_range) DESC')], unique=False, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('idx_bookings_range_gist', 'bookings', ['time_range'], unique=False, postgresql_using='gist', postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_index('idx_bookings_recurrence', 'bookings', ['recurrence_rule_id'], unique=False, postgresql_where=sa.text('recurrence_rule_id IS NOT NULL'))
    op.create_index('idx_bookings_status_source', 'bookings', ['status', 'source', sa.literal_column('lower(time_range) DESC')], unique=False, postgresql_where=sa.text('deleted_at IS NULL'))
    op.create_table('access_requests',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=16), nullable=False),
    sa.Column('requester_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('requested_range', postgresql.TSTZRANGE(), nullable=False),
    sa.Column('access_type', postgresql.ENUM('hors_jour_ouverture', 'hors_horaire', 'depassement_capacite', 'equipement_indisponible', 'conflit_reservation', name='access_type', create_type=False), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=True),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('status', postgresql.ENUM('ouvert', 'accorde', 'refuse', 'reoriente', name='request_status', create_type=False), server_default=sa.text("'ouvert'"), nullable=False),
    sa.Column('decided_by_admin_id', sa.UUID(), nullable=True),
    sa.Column('decision_comment', sa.Text(), nullable=True),
    sa.Column('alternative_room_id', sa.UUID(), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status = 'ouvert' AND decided_at IS NULL) OR (status <> 'ouvert' AND decided_at IS NOT NULL)", name=op.f('ck_access_requests_decision')),
    sa.CheckConstraint("reference ~ '^#[A-Z]{3,4}-[0-9]{3,6}$'", name=op.f('ck_access_requests_reference_format')),
    sa.CheckConstraint('NOT isempty(requested_range) AND lower(requested_range) IS NOT NULL AND upper(requested_range) IS NOT NULL', name=op.f('ck_access_requests_range')),
    sa.CheckConstraint('alternative_room_id IS NULL OR alternative_room_id <> room_id', name=op.f('ck_access_requests_alternative_differs')),
    sa.ForeignKeyConstraint(['alternative_room_id'], ['rooms.id'], name='fk_access_requests_alternative_room', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], name='fk_access_requests_booking', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['decided_by_admin_id'], ['admin_accounts.user_id'], name='fk_access_requests_decided_by', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name='fk_access_requests_requester', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_access_requests_room', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_access_requests')),
    sa.UniqueConstraint('reference', name='uq_access_requests_reference')
    )
    op.create_index('idx_access_requests_alternative', 'access_requests', ['alternative_room_id'], unique=False, postgresql_where=sa.text('alternative_room_id IS NOT NULL'))
    op.create_index('idx_access_requests_booking', 'access_requests', ['booking_id'], unique=False, postgresql_where=sa.text('booking_id IS NOT NULL'))
    op.create_index('idx_access_requests_decided_by', 'access_requests', ['decided_by_admin_id'], unique=False, postgresql_where=sa.text('decided_by_admin_id IS NOT NULL'))
    op.create_index('idx_access_requests_queue', 'access_requests', ['status', 'created_at'], unique=False, postgresql_where=sa.text("status = 'ouvert'"))
    op.create_index('idx_access_requests_requester', 'access_requests', ['requester_id'], unique=False)
    op.create_index('idx_access_requests_room', 'access_requests', ['room_id'], unique=False)
    op.create_table('booking_access_codes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('code_hash', sa.Text(), nullable=False),
    sa.Column('code_hint', sa.String(length=8), nullable=False),
    sa.Column('issued_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("code_hint ~ '^[A-Z0-9]-\\*{4}$'", name=op.f('ck_booking_access_codes_hint_format')),
    sa.CheckConstraint('expires_at > issued_at', name=op.f('ck_booking_access_codes_expiry')),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], name='fk_booking_access_codes_booking', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_booking_access_codes'))
    )
    op.create_index('idx_booking_access_codes_booking', 'booking_access_codes', ['booking_id', sa.literal_column('issued_at DESC')], unique=False)
    op.create_index('uq_booking_access_codes_active', 'booking_access_codes', ['booking_id'], unique=True, postgresql_where=sa.text('revoked_at IS NULL'))
    op.create_table('booking_events',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('event_type', postgresql.ENUM('creation', 'confirmation', 'modification', 'rappel', 'checkin', 'annulation', 'liberation_auto', name='booking_event_type', create_type=False), nullable=False),
    sa.Column('label', sa.String(length=160), nullable=False),
    sa.Column('actor_user_id', sa.UUID(), nullable=True),
    sa.Column('occurred_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(label) <> ''", name=op.f('ck_booking_events_label_not_blank')),
    sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], name='fk_booking_events_actor', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], name='fk_booking_events_booking', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_booking_events'))
    )
    op.create_index('idx_booking_events_booking', 'booking_events', ['booking_id', 'occurred_at'], unique=False)
    op.create_table('booking_participants',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('booking_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('email', postgresql.CITEXT(), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('response', postgresql.ENUM('en_attente', 'accepte', 'decline', name='participant_response', create_type=False), server_default=sa.text("'en_attente'"), nullable=False),
    sa.Column('is_organizer', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(response = 'en_attente') = (responded_at IS NULL)", name=op.f('ck_booking_participants_responded')),
    sa.CheckConstraint("btrim(display_name) <> ''", name=op.f('ck_booking_participants_name_not_blank')),
    sa.CheckConstraint("email ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'", name=op.f('ck_booking_participants_email_format')),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], name='fk_booking_participants_booking', onupdate='CASCADE', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_booking_participants_user', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_booking_participants')),
    sa.UniqueConstraint('booking_id', 'email', name='uq_booking_participants_email')
    )
    op.create_index('idx_booking_participants_email', 'booking_participants', ['email'], unique=False)
    op.create_index('idx_booking_participants_user', 'booking_participants', ['user_id'], unique=False, postgresql_where=sa.text('user_id IS NOT NULL'))
    op.create_index('uq_booking_participants_organizer', 'booking_participants', ['booking_id'], unique=True, postgresql_where=sa.text('is_organizer'))
    op.create_table('tickets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=16), nullable=False),
    sa.Column('requester_id', sa.UUID(), nullable=False),
    sa.Column('subject', sa.String(length=180), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=True),
    sa.Column('booking_id', sa.UUID(), nullable=True),
    sa.Column('status', postgresql.ENUM('ouvert', 'en_cours', 'resolu', 'ferme', name='ticket_status', create_type=False), server_default=sa.text("'ouvert'"), nullable=False),
    sa.Column('assigned_admin_id', sa.UUID(), nullable=True),
    sa.Column('first_response_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(status IN ('resolu', 'ferme')) = (resolved_at IS NOT NULL)", name=op.f('ck_tickets_resolved')),
    sa.CheckConstraint("btrim(subject) <> ''", name=op.f('ck_tickets_subject_not_blank')),
    sa.CheckConstraint("reference ~ '^#?[0-9]{1,10}$'", name=op.f('ck_tickets_reference_format')),
    sa.ForeignKeyConstraint(['assigned_admin_id'], ['admin_accounts.user_id'], name='fk_tickets_assigned_admin', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], name='fk_tickets_booking', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name='fk_tickets_requester', onupdate='CASCADE', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], name='fk_tickets_room', onupdate='CASCADE', ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tickets')),
    sa.UniqueConstraint('reference', name='uq_tickets_reference')
    )
    op.create_index('idx_tickets_assigned_admin', 'tickets', ['assigned_admin_id'], unique=False, postgresql_where=sa.text('assigned_admin_id IS NOT NULL'))
    op.create_index('idx_tickets_booking', 'tickets', ['booking_id'], unique=False, postgresql_where=sa.text('booking_id IS NOT NULL'))
    op.create_index('idx_tickets_queue', 'tickets', ['status', sa.literal_column('updated_at DESC')], unique=False)
    op.create_index('idx_tickets_requester', 'tickets', ['requester_id', sa.literal_column('created_at DESC')], unique=False)
    op.create_index('idx_tickets_room', 'tickets', ['room_id'], unique=False, postgresql_where=sa.text('room_id IS NOT NULL'))
    op.create_table('notifications',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=180), nullable=False),
    sa.Column('channel', postgresql.ENUM('email', 'in_app', name='notification_channel', create_type=False), server_default=sa.text("'in_app'"), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('booking_id', sa.UUID(), nullable=True),
    sa.Column('ticket_id', sa.UUID(), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(title) <> ''", name=op.f('ck_notifications_title_not_blank')),
    sa.ForeignKeyConstraint(['booking_id'], ['bookings.id'], name='fk_notifications_booking', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], name='fk_notifications_ticket', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_notifications_user', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notifications'))
    )
    op.create_index('idx_notifications_booking', 'notifications', ['booking_id'], unique=False, postgresql_where=sa.text('booking_id IS NOT NULL'))
    op.create_index('idx_notifications_ticket', 'notifications', ['ticket_id'], unique=False, postgresql_where=sa.text('ticket_id IS NOT NULL'))
    op.create_index('idx_notifications_unread', 'notifications', ['user_id', sa.literal_column('sent_at DESC')], unique=False, postgresql_where=sa.text('read_at IS NULL'))
    op.create_index('idx_notifications_user', 'notifications', ['user_id', sa.literal_column('sent_at DESC')], unique=False)
    op.create_table('ticket_messages',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('ticket_id', sa.UUID(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('author_user_id', sa.UUID(), nullable=True),
    sa.Column('is_from_support', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('is_internal', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("btrim(body) <> ''", name=op.f('ck_ticket_messages_body_not_blank')),
    sa.CheckConstraint('NOT is_internal OR is_from_support', name=op.f('ck_ticket_messages_internal_is_support')),
    sa.ForeignKeyConstraint(['author_user_id'], ['users.id'], name='fk_ticket_messages_author', onupdate='CASCADE', ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], name='fk_ticket_messages_ticket', onupdate='CASCADE', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ticket_messages'))
    )
    op.create_index('idx_ticket_messages_public', 'ticket_messages', ['ticket_id', 'sent_at'], unique=False, postgresql_where=sa.text('NOT is_internal'))
    op.create_index('idx_ticket_messages_ticket', 'ticket_messages', ['ticket_id', 'sent_at'], unique=False)

    # ------------------------------------------------------------------ #
    # Fonctions, triggers, statistiques et données de structure
    # ------------------------------------------------------------------ #
    op.execute(FONCTION_SET_UPDATED_AT)
    op.execute(FONCTION_AUDIT_APPEND_ONLY)

    for table in TABLES_HORODATEES:
        op.execute(
            f"CREATE TRIGGER trg_{table}_updated_at BEFORE UPDATE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
        )

    # Immuabilité du journal : ni suppression, ni réécriture.
    op.execute(
        "CREATE TRIGGER trg_audit_logs_append_only "
        "BEFORE UPDATE OR DELETE ON audit_logs "
        "FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()"
    )

    op.execute(FONCTION_TIMEZONE)
    op.execute(FONCTION_OUVERTURE)
    op.execute(VUE_OCCUPATION)
    op.execute(
        "CREATE UNIQUE INDEX uq_mv_room_occupancy_hourly "
        "ON mv_room_occupancy_hourly (room_id, occupancy_date, hour_of_day)"
    )
    op.execute(
        "CREATE INDEX idx_mv_occupancy_building_date "
        "ON mv_room_occupancy_hourly (building_id, occupancy_date, hour_of_day)"
    )
    op.execute("CREATE INDEX idx_mv_occupancy_date ON mv_room_occupancy_hourly (occupancy_date)")
    op.execute(VUE_SALLE_JOUR)
    op.execute(VUE_BATIMENT_JOUR)
    op.execute(FONCTION_REFRESH)

    op.execute(DONNEES_DE_STRUCTURE)


def downgrade() -> None:
    # Ordre inverse : vues et fonctions d'abord, elles dépendent des tables.
    op.execute("DROP FUNCTION IF EXISTS refresh_room_occupancy(BOOLEAN)")
    op.execute("DROP VIEW IF EXISTS v_building_occupancy_daily")
    op.execute("DROP VIEW IF EXISTS v_room_occupancy_daily")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_room_occupancy_hourly")
    op.execute("DROP FUNCTION IF EXISTS resolve_opening_minutes(UUID, UUID, SMALLINT)")
    op.execute("DROP FUNCTION IF EXISTS smartroom_timezone()")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs")

    for table in TABLES_HORODATEES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_updated_at ON {table}")

    op.drop_index('idx_ticket_messages_ticket', table_name='ticket_messages')
    op.drop_index('idx_ticket_messages_public', table_name='ticket_messages', postgresql_where=sa.text('NOT is_internal'))
    op.drop_table('ticket_messages')
    op.drop_index('idx_notifications_user', table_name='notifications')
    op.drop_index('idx_notifications_unread', table_name='notifications', postgresql_where=sa.text('read_at IS NULL'))
    op.drop_index('idx_notifications_ticket', table_name='notifications', postgresql_where=sa.text('ticket_id IS NOT NULL'))
    op.drop_index('idx_notifications_booking', table_name='notifications', postgresql_where=sa.text('booking_id IS NOT NULL'))
    op.drop_table('notifications')
    op.drop_index('idx_tickets_room', table_name='tickets', postgresql_where=sa.text('room_id IS NOT NULL'))
    op.drop_index('idx_tickets_requester', table_name='tickets')
    op.drop_index('idx_tickets_queue', table_name='tickets')
    op.drop_index('idx_tickets_booking', table_name='tickets', postgresql_where=sa.text('booking_id IS NOT NULL'))
    op.drop_index('idx_tickets_assigned_admin', table_name='tickets', postgresql_where=sa.text('assigned_admin_id IS NOT NULL'))
    op.drop_table('tickets')
    op.drop_index('uq_booking_participants_organizer', table_name='booking_participants', postgresql_where=sa.text('is_organizer'))
    op.drop_index('idx_booking_participants_user', table_name='booking_participants', postgresql_where=sa.text('user_id IS NOT NULL'))
    op.drop_index('idx_booking_participants_email', table_name='booking_participants')
    op.drop_table('booking_participants')
    op.drop_index('idx_booking_events_booking', table_name='booking_events')
    op.drop_table('booking_events')
    op.drop_index('uq_booking_access_codes_active', table_name='booking_access_codes', postgresql_where=sa.text('revoked_at IS NULL'))
    op.drop_index('idx_booking_access_codes_booking', table_name='booking_access_codes')
    op.drop_table('booking_access_codes')
    op.drop_index('idx_access_requests_room', table_name='access_requests')
    op.drop_index('idx_access_requests_requester', table_name='access_requests')
    op.drop_index('idx_access_requests_queue', table_name='access_requests', postgresql_where=sa.text("status = 'ouvert'"))
    op.drop_index('idx_access_requests_decided_by', table_name='access_requests', postgresql_where=sa.text('decided_by_admin_id IS NOT NULL'))
    op.drop_index('idx_access_requests_booking', table_name='access_requests', postgresql_where=sa.text('booking_id IS NOT NULL'))
    op.drop_index('idx_access_requests_alternative', table_name='access_requests', postgresql_where=sa.text('alternative_room_id IS NOT NULL'))
    op.drop_table('access_requests')
    op.drop_index('idx_bookings_status_source', table_name='bookings', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_bookings_recurrence', table_name='bookings', postgresql_where=sa.text('recurrence_rule_id IS NOT NULL'))
    op.drop_index('idx_bookings_range_gist', table_name='bookings', postgresql_using='gist', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_bookings_owner_start', table_name='bookings', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_bookings_created_by_admin', table_name='bookings', postgresql_where=sa.text('created_by_admin_id IS NOT NULL'))
    op.drop_index('idx_bookings_checkin_pending', table_name='bookings', postgresql_where=sa.text("status = 'confirmee' AND checked_in_at IS NULL AND deleted_at IS NULL"))
    op.drop_table('bookings')
    op.drop_table('room_placements')
    op.drop_index('idx_room_photos_room_id', table_name='room_photos')
    op.drop_table('room_photos')
    op.drop_index('idx_room_equipments_equipment', table_name='room_equipments')
    op.drop_table('room_equipments')
    op.drop_index('idx_recurrence_rules_room', table_name='recurrence_rules')
    op.drop_index('idx_recurrence_rules_owner', table_name='recurrence_rules')
    op.drop_table('recurrence_rules')
    op.drop_index('uq_opening_hours_room', table_name='opening_hours', postgresql_where=sa.text("scope = 'salle'"))
    op.drop_index('uq_opening_hours_global', table_name='opening_hours', postgresql_where=sa.text("scope = 'global'"))
    op.drop_index('uq_opening_hours_building', table_name='opening_hours', postgresql_where=sa.text("scope = 'batiment'"))
    op.drop_table('opening_hours')
    op.drop_index('idx_closure_rooms_room', table_name='closure_rooms')
    op.drop_table('closure_rooms')
    op.drop_index('idx_closure_buildings_building', table_name='closure_buildings')
    op.drop_table('closure_buildings')
    op.drop_index('idx_chatbot_intent_keywords_keyword', table_name='chatbot_intent_keywords')
    op.drop_table('chatbot_intent_keywords')
    op.drop_index('uq_booking_rules_room', table_name='booking_rules', postgresql_where=sa.text("scope = 'salle'"))
    op.drop_index('uq_booking_rules_global', table_name='booking_rules', postgresql_where=sa.text("scope = 'global'"))
    op.drop_index('uq_booking_rules_building', table_name='booking_rules', postgresql_where=sa.text("scope = 'batiment'"))
    op.drop_table('booking_rules')
    op.drop_index('idx_admin_invitation_permissions_permission', table_name='admin_invitation_permissions')
    op.drop_table('admin_invitation_permissions')
    op.drop_index('uq_rooms_slug', table_name='rooms', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('uq_rooms_floor_name', table_name='rooms', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_rooms_search', table_name='rooms', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_rooms_name_trgm', table_name='rooms', postgresql_using='gin', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_rooms_floor_id', table_name='rooms')
    op.drop_table('rooms')
    op.drop_index('idx_floor_plans_uploaded_by', table_name='floor_plans', postgresql_where=sa.text('uploaded_by_admin_id IS NOT NULL'))
    op.drop_table('floor_plans')
    op.drop_index('idx_faq_article_links_related', table_name='faq_article_links')
    op.drop_table('faq_article_links')
    op.drop_index('idx_email_templates_updated_by', table_name='email_templates', postgresql_where=sa.text('updated_by_admin_id IS NOT NULL'))
    op.drop_table('email_templates')
    op.drop_index('idx_closure_periods_span', table_name='closure_periods', postgresql_using='gist')
    op.drop_index('idx_closure_periods_created_by', table_name='closure_periods', postgresql_where=sa.text('created_by_admin_id IS NOT NULL'))
    op.drop_table('closure_periods')
    op.drop_index('idx_chatbot_intents_article', table_name='chatbot_intents', postgresql_where=sa.text('faq_article_id IS NOT NULL'))
    op.drop_table('chatbot_intents')
    op.drop_index('idx_audit_logs_target', table_name='audit_logs')
    op.drop_index('idx_audit_logs_search_trgm', table_name='audit_logs', postgresql_using='gin')
    op.drop_index('idx_audit_logs_occurred', table_name='audit_logs')
    op.drop_index('idx_audit_logs_flagged', table_name='audit_logs', postgresql_where=sa.text('flagged_at IS NOT NULL'))
    op.drop_index('idx_audit_logs_actor', table_name='audit_logs', postgresql_where=sa.text('actor_admin_id IS NOT NULL'))
    op.drop_index('idx_audit_logs_action', table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index('idx_admin_permissions_permission', table_name='admin_permissions')
    op.drop_index('idx_admin_permissions_granted_by', table_name='admin_permissions', postgresql_where=sa.text('granted_by_admin_id IS NOT NULL'))
    op.drop_table('admin_permissions')
    op.drop_index('uq_admin_invitations_pending', table_name='admin_invitations', postgresql_where=sa.text('accepted_at IS NULL AND revoked_at IS NULL'))
    op.drop_index('idx_admin_invitations_invited_by', table_name='admin_invitations')
    op.drop_table('admin_invitations')
    op.drop_index('idx_user_preferences_building', table_name='user_preferences', postgresql_where=sa.text('preferred_building_id IS NOT NULL'))
    op.drop_table('user_preferences')
    op.drop_index('idx_permissions_group', table_name='permissions')
    op.drop_table('permissions')
    op.drop_index('idx_floors_building_id', table_name='floors')
    op.drop_table('floors')
    op.drop_index('idx_faq_articles_search_trgm', table_name='faq_articles', postgresql_using='gin')
    op.drop_index('idx_faq_articles_published', table_name='faq_articles', postgresql_where=sa.text("status = 'publie'"))
    op.drop_index('idx_faq_articles_category', table_name='faq_articles')
    op.drop_table('faq_articles')
    op.drop_index('uq_admin_accounts_single_owner', table_name='admin_accounts', postgresql_where=sa.text('is_owner'))
    op.drop_table('admin_accounts')
    op.drop_index('uq_users_email', table_name='users', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('uq_users_badge_number', table_name='users', postgresql_where=sa.text('deleted_at IS NULL AND badge_number IS NOT NULL'))
    op.drop_index('idx_users_name_trgm', table_name='users', postgresql_using='gin', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_index('idx_users_directory', table_name='users', postgresql_where=sa.text('deleted_at IS NULL'))
    op.drop_table('users')
    op.drop_index('idx_ticket_response_templates_category', table_name='ticket_response_templates', postgresql_where=sa.text('is_active'))
    op.drop_table('ticket_response_templates')
    op.drop_table('permission_groups')
    op.drop_table('faq_categories')
    op.drop_index('idx_equipments_filterable', table_name='equipments', postgresql_where=sa.text('is_filterable'))
    op.drop_table('equipments')
    op.drop_table('email_template_variables')
    op.drop_index('idx_buildings_sort_order', table_name='buildings')
    op.drop_table('buildings')

    op.execute("DROP FUNCTION IF EXISTS audit_logs_append_only()")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")

    # Les types ENUM ne disparaissent pas avec les tables qui les utilisent.
    for nom in ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {nom}")

    # Les extensions sont conservées : elles peuvent servir à d'autres schémas
    # de la même base.
