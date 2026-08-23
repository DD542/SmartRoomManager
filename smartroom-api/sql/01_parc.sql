-- =============================================================================
-- SmartRoom Manager — 01 : domaine parc
-- Bâtiments, étages, plans d'étage, salles, géométrie, équipements, visuels.
-- Prérequis : 00_extensions_enums.sql
--
-- ON UPDATE CASCADE est posé sur toutes les clés étrangères : les clés primaires
-- sont des UUID immuables, la clause est donc sans effet pratique mais rend la
-- stratégie explicite comme l'exige la convention du projet.
--
-- floor_plans.uploaded_by_admin_id référence admin_accounts, créée en 02 : la
-- contrainte correspondante est ajoutée à la fin de 02_comptes.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- buildings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buildings (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    code        VARCHAR(4)   NOT NULL,
    name        VARCHAR(120) NOT NULL,
    address     VARCHAR(255),
    sort_order  SMALLINT     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_buildings PRIMARY KEY (id),
    CONSTRAINT uq_buildings_code UNIQUE (code),
    -- Le code du bâtiment préfixe les codes d'accès (« A-4821 ») : majuscules seulement.
    CONSTRAINT ck_buildings_code_format CHECK (code ~ '^[A-Z0-9]{1,4}$'),
    CONSTRAINT ck_buildings_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_buildings_sort_order ON buildings (sort_order, name);


-- -----------------------------------------------------------------------------
-- floors
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS floors (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    building_id  UUID        NOT NULL,
    code         VARCHAR(8)  NOT NULL,
    label        VARCHAR(60) NOT NULL,
    -- `code` est du texte affiché (RDC, 2e) ; `level` est l'entier qui trie.
    level        SMALLINT    NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_floors PRIMARY KEY (id),
    CONSTRAINT fk_floors_building FOREIGN KEY (building_id)
        REFERENCES buildings (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_floors_building_code UNIQUE (building_id, code),
    CONSTRAINT uq_floors_building_level UNIQUE (building_id, level),
    CONSTRAINT ck_floors_level_range CHECK (level BETWEEN -5 AND 60)
);

CREATE INDEX IF NOT EXISTS idx_floors_building_id ON floors (building_id, level);


-- -----------------------------------------------------------------------------
-- floor_plans — document déposé par l'administration, un par étage au maximum
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS floor_plans (
    id                    UUID               NOT NULL DEFAULT gen_random_uuid(),
    floor_id              UUID               NOT NULL,
    kind                  plan_document_kind NOT NULL,
    file_url              TEXT               NOT NULL,
    file_name             VARCHAR(160)       NOT NULL,
    file_size_bytes       INTEGER            NOT NULL,
    uploaded_by_admin_id  UUID,
    uploaded_at           TIMESTAMPTZ        NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),

    CONSTRAINT pk_floor_plans PRIMARY KEY (id),
    CONSTRAINT fk_floor_plans_floor FOREIGN KEY (floor_id)
        REFERENCES floors (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- Relation 1–1 : un étage n'a qu'un plan courant, le remplacer écrase la ligne.
    CONSTRAINT uq_floor_plans_floor UNIQUE (floor_id),
    CONSTRAINT ck_floor_plans_size CHECK (file_size_bytes > 0 AND file_size_bytes <= 5 * 1024 * 1024),
    CONSTRAINT ck_floor_plans_file_name CHECK (btrim(file_name) <> '')
);


-- -----------------------------------------------------------------------------
-- rooms
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
    id                UUID          NOT NULL DEFAULT gen_random_uuid(),
    floor_id          UUID          NOT NULL,
    name              VARCHAR(120)  NOT NULL,
    slug              VARCHAR(140)  NOT NULL,
    capacity          SMALLINT      NOT NULL,
    area_m2           NUMERIC(6, 2) NOT NULL,
    status            room_status   NOT NULL DEFAULT 'disponible',
    is_accessible     BOOLEAN       NOT NULL DEFAULT false,
    badge_required    BOOLEAN       NOT NULL DEFAULT true,
    -- Code permanent du terminal de la salle : haché, jamais stocké en clair.
    access_code_hash  TEXT,
    description       TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT pk_rooms PRIMARY KEY (id),
    CONSTRAINT fk_rooms_floor FOREIGN KEY (floor_id)
        REFERENCES floors (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_rooms_capacity CHECK (capacity BETWEEN 1 AND 500),
    CONSTRAINT ck_rooms_area CHECK (area_m2 > 0 AND area_m2 <= 5000),
    CONSTRAINT ck_rooms_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT ck_rooms_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- Une salle archivée reste dans le catalogue : elle ne peut pas repasser
    -- « disponible » sans lever la suppression logique.
    CONSTRAINT ck_rooms_archived_state CHECK (deleted_at IS NULL OR status = 'archivee')
);

-- Unicité métier restreinte aux salles vivantes : archiver « Salle Vinci » doit
-- laisser le nom réutilisable au même étage.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rooms_floor_name
    ON rooms (floor_id, name) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rooms_slug
    ON rooms (slug) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_floor_id ON rooms (floor_id);

-- Index composite de la requête la plus fréquente : recherche de salles
-- disponibles filtrée par statut, capacité minimale et bâtiment (via floor_id).
CREATE INDEX IF NOT EXISTS idx_rooms_search
    ON rooms (status, capacity, floor_id) WHERE deleted_at IS NULL;

-- Recherche par nom dans la barre globale et l'écran A-05.
CREATE INDEX IF NOT EXISTS idx_rooms_name_trgm
    ON rooms USING gin (name gin_trgm_ops) WHERE deleted_at IS NULL;


-- -----------------------------------------------------------------------------
-- room_placements — position de la salle sur le plan de son étage (1–1)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_placements (
    room_id             UUID          NOT NULL,
    -- Coordonnées en pourcentage du viewBox : indépendantes de la taille d'affichage.
    pos_x               NUMERIC(5, 2) NOT NULL,
    pos_y               NUMERIC(5, 2) NOT NULL,
    width               NUMERIC(5, 2) NOT NULL,
    height              NUMERIC(5, 2) NOT NULL,
    rotation            SMALLINT      NOT NULL DEFAULT 0,
    is_entrance_marked  BOOLEAN       NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_room_placements PRIMARY KEY (room_id),
    CONSTRAINT fk_room_placements_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_room_placements_origin CHECK (pos_x >= 0 AND pos_y >= 0),
    CONSTRAINT ck_room_placements_size CHECK (width > 0 AND height > 0),
    -- La salle reste entièrement dans le cadre du plan.
    CONSTRAINT ck_room_placements_bounds CHECK (pos_x + width <= 100 AND pos_y + height <= 100),
    CONSTRAINT ck_room_placements_rotation CHECK (rotation IN (0, 90, 180, 270))
);


-- -----------------------------------------------------------------------------
-- equipments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipments (
    id             UUID               NOT NULL DEFAULT gen_random_uuid(),
    code           VARCHAR(40)        NOT NULL,
    label          VARCHAR(80)        NOT NULL,
    category       equipment_category NOT NULL,
    -- Clé de la table d'icônes du front, pas un chemin de fichier.
    icon           VARCHAR(40)        NOT NULL,
    description    VARCHAR(255),
    is_filterable  BOOLEAN            NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ        NOT NULL DEFAULT now(),

    CONSTRAINT pk_equipments PRIMARY KEY (id),
    CONSTRAINT uq_equipments_code UNIQUE (code),
    CONSTRAINT ck_equipments_code_format CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT ck_equipments_label_not_blank CHECK (btrim(label) <> '')
);

-- Alimente la liste des filtres de l'espace utilisateur.
CREATE INDEX IF NOT EXISTS idx_equipments_filterable
    ON equipments (category, label) WHERE is_filterable;


-- -----------------------------------------------------------------------------
-- room_equipments — table de liaison, suppression physique
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_equipments (
    room_id       UUID        NOT NULL,
    equipment_id  UUID        NOT NULL,
    quantity      SMALLINT    NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_room_equipments PRIMARY KEY (room_id, equipment_id),
    CONSTRAINT fk_room_equipments_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- RESTRICT : un équipement encore posé dans une salle ne se supprime pas.
    CONSTRAINT fk_room_equipments_equipment FOREIGN KEY (equipment_id)
        REFERENCES equipments (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_room_equipments_quantity CHECK (quantity > 0 AND quantity <= 50)
);

-- Sens inverse de la clé primaire : filtrage des salles par équipement exigé.
CREATE INDEX IF NOT EXISTS idx_room_equipments_equipment
    ON room_equipments (equipment_id, room_id);


-- -----------------------------------------------------------------------------
-- room_photos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_photos (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    room_id     UUID         NOT NULL,
    file_url    TEXT         NOT NULL,
    alt_text    VARCHAR(160),
    -- Position 0 = visuel de couverture affiché dans les résultats de recherche.
    position    SMALLINT     NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_room_photos PRIMARY KEY (id),
    CONSTRAINT fk_room_photos_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_room_photos_position UNIQUE (room_id, position),
    CONSTRAINT ck_room_photos_position CHECK (position BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_room_photos_room_id ON room_photos (room_id, position);


-- -----------------------------------------------------------------------------
-- Horodatage automatique des mises à jour
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_buildings_updated_at
    BEFORE UPDATE ON buildings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_floors_updated_at
    BEFORE UPDATE ON floors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_floor_plans_updated_at
    BEFORE UPDATE ON floor_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_rooms_updated_at
    BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_room_placements_updated_at
    BEFORE UPDATE ON room_placements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_equipments_updated_at
    BEFORE UPDATE ON equipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_room_equipments_updated_at
    BEFORE UPDATE ON room_equipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_room_photos_updated_at
    BEFORE UPDATE ON room_photos FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Documentation embarquée
-- -----------------------------------------------------------------------------
COMMENT ON TABLE  rooms IS 'Catalogue des salles. Suppression logique via deleted_at, jamais de DELETE.';
COMMENT ON COLUMN rooms.access_code_hash IS 'Code permanent du terminal, haché ; le clair n''est jamais persisté.';
COMMENT ON TABLE  room_placements IS 'Géométrie de la salle sur le plan de son étage, en pourcentage du viewBox.';
COMMENT ON TABLE  room_equipments IS 'Liaison salle-équipement. Suppression physique : une association n''a pas d''existence propre.';
