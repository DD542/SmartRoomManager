-- =============================================================================
-- SmartRoom Manager — 02 : domaine comptes et permissions
-- Utilisateurs, préférences, comptes d'administration, matrice de permissions,
-- invitations.
-- Prérequis : 00_extensions_enums.sql, 01_parc.sql
--
-- Deux rôles applicatifs seulement. La qualité d'administrateur n'est pas une
-- colonne mais l'existence d'une ligne dans admin_accounts : l'état incohérent
-- « rôle admin sans permissions » devient impossible à représenter.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id             UUID        NOT NULL DEFAULT gen_random_uuid(),
    email          CITEXT      NOT NULL,
    -- bcrypt via passlib, coût 12 : 60 caractères. Aucun mot de passe en clair.
    password_hash  TEXT        NOT NULL,
    first_name     VARCHAR(80) NOT NULL,
    last_name      VARCHAR(80) NOT NULL,
    phone          VARCHAR(20),
    promotion      VARCHAR(60),
    department     VARCHAR(60),
    badge_number   VARCHAR(20),
    status         user_status NOT NULL DEFAULT 'actif',
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,

    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT ck_users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT ck_users_first_name_not_blank CHECK (btrim(first_name) <> ''),
    CONSTRAINT ck_users_last_name_not_blank CHECK (btrim(last_name) <> ''),
    CONSTRAINT ck_users_phone_format CHECK (phone IS NULL OR phone ~ '^[0-9 +.()-]{6,20}$'),
    -- Un compte supprimé est nécessairement suspendu : il ne doit plus rien ouvrir.
    CONSTRAINT ck_users_deleted_is_suspended CHECK (deleted_at IS NULL OR status = 'suspendu')
);

-- Unicité restreinte aux comptes vivants : une adresse redevient disponible
-- après suppression logique, ce qu'une contrainte UNIQUE simple interdirait.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email
    ON users (email) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_badge_number
    ON users (badge_number) WHERE deleted_at IS NULL AND badge_number IS NOT NULL;

-- Filtres de l'écran A-11 : promotion, département, statut.
CREATE INDEX IF NOT EXISTS idx_users_directory
    ON users (status, department, promotion) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_name_trgm
    ON users USING gin ((first_name || ' ' || last_name) gin_trgm_ops) WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- user_preferences — extension 1–1 optionnelle
-- Sortie de `users`, chargée à chaque requête authentifiée, car toutes ces
-- colonnes sont facultatives et lues par deux écrans seulement.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                UUID        NOT NULL,
    preferred_building_id  UUID,
    usual_capacity_min     SMALLINT,
    usual_capacity_max     SMALLINT,
    email_notifications    BOOLEAN     NOT NULL DEFAULT true,
    in_app_notifications   BOOLEAN     NOT NULL DEFAULT true,
    reminder_delay_min     SMALLINT    NOT NULL DEFAULT 30,
    -- Quota individuel : surcharge booking_rules.weekly_quota_hours pour ce compte.
    weekly_quota_hours     SMALLINT    NOT NULL DEFAULT 12,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_user_preferences PRIMARY KEY (user_id),
    CONSTRAINT fk_user_preferences_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- SET NULL : une préférence de bâtiment n'est pas une dépendance.
    CONSTRAINT fk_user_preferences_building FOREIGN KEY (preferred_building_id)
        REFERENCES buildings (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_user_preferences_capacity CHECK (
        (usual_capacity_min IS NULL AND usual_capacity_max IS NULL)
        OR (usual_capacity_min IS NOT NULL AND usual_capacity_max IS NOT NULL
            AND usual_capacity_min >= 1 AND usual_capacity_min <= usual_capacity_max)
    ),
    CONSTRAINT ck_user_preferences_reminder CHECK (reminder_delay_min BETWEEN 5 AND 1440),
    CONSTRAINT ck_user_preferences_quota CHECK (weekly_quota_hours BETWEEN 0 AND 168)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_building
    ON user_preferences (preferred_building_id) WHERE preferred_building_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- admin_accounts — spécialisation 1–1 de users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_accounts (
    user_id               UUID        NOT NULL,
    job_title             VARCHAR(80) NOT NULL,
    -- Le propriétaire conserve toutes les permissions : les lui retirer fermerait
    -- la configuration du système pour tout le monde.
    is_owner              BOOLEAN     NOT NULL DEFAULT false,
    -- Session d'administration distincte de la session utilisateur.
    last_admin_login_at   TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_admin_accounts PRIMARY KEY (user_id),
    CONSTRAINT fk_admin_accounts_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_admin_accounts_job_title CHECK (btrim(job_title) <> '')
);

-- Un seul propriétaire : l'index ne couvre que les lignes à true, l'unicité de
-- la valeur `true` interdit donc la deuxième.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_accounts_single_owner
    ON admin_accounts (is_owner) WHERE is_owner;


-- -----------------------------------------------------------------------------
-- permission_groups — sections de la matrice A-12
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_groups (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    code        VARCHAR(40) NOT NULL,
    label       VARCHAR(80) NOT NULL,
    sort_order  SMALLINT    NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_permission_groups PRIMARY KEY (id),
    CONSTRAINT uq_permission_groups_code UNIQUE (code),
    CONSTRAINT ck_permission_groups_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);


-- -----------------------------------------------------------------------------
-- permissions — référentiel fermé des sept droits applicatifs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    group_id    UUID         NOT NULL,
    code        VARCHAR(40)  NOT NULL,
    label       VARCHAR(120) NOT NULL,
    sort_order  SMALLINT     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_permissions PRIMARY KEY (id),
    -- RESTRICT : le référentiel est figé, vider un groupe encore utilisé serait une erreur.
    CONSTRAINT fk_permissions_group FOREIGN KEY (group_id)
        REFERENCES permission_groups (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_permissions_code UNIQUE (code),
    -- Forme « domaine.action », vérifiée par la base pour éviter les codes libres.
    CONSTRAINT ck_permissions_code_format CHECK (code ~ '^[a-z]+\.[a-z]+$')
);

CREATE INDEX IF NOT EXISTS idx_permissions_group ON permissions (group_id, sort_order);


-- -----------------------------------------------------------------------------
-- admin_permissions — matrice permissions × administrateurs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_permissions (
    admin_user_id        UUID        NOT NULL,
    permission_id        UUID        NOT NULL,
    -- Traçabilité de l'octroi ; le journal d'audit conserve le détail.
    granted_by_admin_id  UUID,
    granted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_admin_permissions PRIMARY KEY (admin_user_id, permission_id),
    CONSTRAINT fk_admin_permissions_admin FOREIGN KEY (admin_user_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_admin_permissions_permission FOREIGN KEY (permission_id)
        REFERENCES permissions (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- SET NULL : l'octroi survit au départ de l'administrateur qui l'a accordé.
    CONSTRAINT fk_admin_permissions_granted_by FOREIGN KEY (granted_by_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Sens inverse de la clé primaire : « qui détient cette permission ? » (colonne
-- de la matrice) et vérification d'un droit unique lors d'une requête d'API.
CREATE INDEX IF NOT EXISTS idx_admin_permissions_permission
    ON admin_permissions (permission_id, admin_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_permissions_granted_by
    ON admin_permissions (granted_by_admin_id) WHERE granted_by_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- admin_invitations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_invitations (
    id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
    email                 CITEXT      NOT NULL,
    -- Le jeton en clair n'existe que dans l'e-mail envoyé.
    token_hash            TEXT        NOT NULL,
    invited_by_admin_id   UUID        NOT NULL,
    sent_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ NOT NULL,
    accepted_at           TIMESTAMPTZ,
    revoked_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_admin_invitations PRIMARY KEY (id),
    -- RESTRICT : l'invitant reste identifiable tant que l'invitation existe.
    CONSTRAINT fk_admin_invitations_invited_by FOREIGN KEY (invited_by_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_admin_invitations_token UNIQUE (token_hash),
    CONSTRAINT ck_admin_invitations_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT ck_admin_invitations_expiry CHECK (expires_at > sent_at),
    -- Une invitation est acceptée ou révoquée, jamais les deux.
    CONSTRAINT ck_admin_invitations_final_state CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

-- Une seule invitation en cours par adresse ; les invitations closes s'empilent
-- pour l'historique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_invitations_pending
    ON admin_invitations (email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_invitations_invited_by
    ON admin_invitations (invited_by_admin_id, sent_at DESC);


-- -----------------------------------------------------------------------------
-- admin_invitation_permissions — périmètre choisi dès l'invitation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_invitation_permissions (
    invitation_id  UUID        NOT NULL,
    permission_id  UUID        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_admin_invitation_permissions PRIMARY KEY (invitation_id, permission_id),
    CONSTRAINT fk_admin_invitation_permissions_invitation FOREIGN KEY (invitation_id)
        REFERENCES admin_invitations (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_admin_invitation_permissions_permission FOREIGN KEY (permission_id)
        REFERENCES permissions (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_invitation_permissions_permission
    ON admin_invitation_permissions (permission_id);


-- -----------------------------------------------------------------------------
-- Clé étrangère différée du domaine parc
-- floor_plans est créée en 01, avant admin_accounts : la contrainte ne peut être
-- posée qu'ici. ADD CONSTRAINT n'accepte pas IF NOT EXISTS, d'où le garde-fou.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_floor_plans_uploaded_by_admin'
    ) THEN
        ALTER TABLE floor_plans
            ADD CONSTRAINT fk_floor_plans_uploaded_by_admin
                FOREIGN KEY (uploaded_by_admin_id)
                REFERENCES admin_accounts (user_id)
                ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_floor_plans_uploaded_by
    ON floor_plans (uploaded_by_admin_id) WHERE uploaded_by_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Horodatage automatique des mises à jour
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_admin_accounts_updated_at
    BEFORE UPDATE ON admin_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_permission_groups_updated_at
    BEFORE UPDATE ON permission_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_permissions_updated_at
    BEFORE UPDATE ON permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_admin_permissions_updated_at
    BEFORE UPDATE ON admin_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_admin_invitations_updated_at
    BEFORE UPDATE ON admin_invitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_admin_invitation_permissions_updated_at
    BEFORE UPDATE ON admin_invitation_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Référentiel des permissions — données de structure, pas des seeds de démo
-- Les sept droits sont figés par le code applicatif : ils appartiennent au schéma.
-- -----------------------------------------------------------------------------
INSERT INTO permission_groups (code, label, sort_order) VALUES
    ('espaces',        'Gestion des espaces',      1),
    ('utilisateurs',   'Gestion des utilisateurs', 2),
    ('operations',     'Opérations',               3),
    ('administration', 'Administration',           4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (group_id, code, label, sort_order)
SELECT g.id, v.code, v.label, v.sort_order
  FROM (VALUES
        ('espaces',        'rooms.manage',        'Gérer les salles et équipements',        1),
        ('espaces',        'rules.configure',     'Configurer les règles de réservation',   2),
        ('utilisateurs',   'users.manage',        'Gérer les comptes utilisateurs',         1),
        ('utilisateurs',   'support.handle',      'Traiter les demandes d''aide',           2),
        ('operations',     'conflicts.arbitrate', 'Arbitrer les conflits',                  1),
        ('operations',     'data.export',         'Exporter les données',                   2),
        ('administration', 'system.configure',    'Configurer le système',                  1)
       ) AS v(group_code, code, label, sort_order)
  JOIN permission_groups g ON g.code = v.group_code
ON CONFLICT (code) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Documentation embarquée
-- -----------------------------------------------------------------------------
COMMENT ON TABLE  users IS 'Annuaire des personnes. Suppression logique via deleted_at.';
COMMENT ON COLUMN users.password_hash IS 'bcrypt (passlib). Aucun mot de passe en clair, jamais exposé par l''API.';
COMMENT ON TABLE  admin_accounts IS 'Spécialisation 1-1 de users : être administrateur, c''est avoir une ligne ici.';
COMMENT ON COLUMN admin_accounts.is_owner IS 'Compte propriétaire, unique, dont les permissions ne sont pas révocables.';
COMMENT ON TABLE  admin_permissions IS 'Matrice permissions x administrateurs de l''écran A-12. Suppression physique.';
