-- =============================================================================
-- SmartRoom Manager — 03 : domaine réservation et règles
-- Récurrences, réservations, participants, historique, codes d'accès, règles,
-- horaires d'ouverture, fermetures exceptionnelles, file d'arbitrage.
-- Prérequis : 00_extensions_enums.sql, 01_parc.sql, 02_comptes.sql
--
-- Fichier central du sujet : la contrainte ex_bookings_no_overlap rend la double
-- réservation impossible au niveau base, sans dépendre du code applicatif.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- recurrence_rules
-- Créée avant bookings : chaque occurrence référence sa série.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recurrence_rules (
    id              UUID            NOT NULL DEFAULT gen_random_uuid(),
    owner_id        UUID            NOT NULL,
    room_id         UUID            NOT NULL,
    freq            recurrence_freq NOT NULL,
    interval_count  SMALLINT        NOT NULL DEFAULT 1,
    -- Jours de la semaine visés, 0 = dimanche. Tableau plutôt que table fille :
    -- la liste est lue et réécrite d'un bloc, jamais interrogée isolément.
    byweekday       SMALLINT[]      NOT NULL,
    start_date      DATE            NOT NULL,
    until_date      DATE            NOT NULL,
    start_time      TIME            NOT NULL,
    end_time        TIME            NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT pk_recurrence_rules PRIMARY KEY (id),
    CONSTRAINT fk_recurrence_rules_owner FOREIGN KEY (owner_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_recurrence_rules_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_recurrence_rules_interval CHECK (interval_count BETWEEN 1 AND 12),
    CONSTRAINT ck_recurrence_rules_weekdays CHECK (
        array_length(byweekday, 1) BETWEEN 1 AND 7
        AND byweekday <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[]
    ),
    CONSTRAINT ck_recurrence_rules_dates CHECK (until_date >= start_date),
    -- Une série ne court pas plus d'un an : au-delà, l'aperçu des occurrences
    -- deviendrait ingérable et le quota hebdomadaire perdrait son sens.
    CONSTRAINT ck_recurrence_rules_horizon CHECK (until_date <= start_date + INTERVAL '1 year'),
    CONSTRAINT ck_recurrence_rules_times CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_recurrence_rules_owner ON recurrence_rules (owner_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_recurrence_rules_room ON recurrence_rules (room_id);


-- -----------------------------------------------------------------------------
-- bookings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
    id                   UUID           NOT NULL DEFAULT gen_random_uuid(),
    room_id              UUID           NOT NULL,
    -- NULL uniquement pour un blocage administratif : personne ne l'organise.
    owner_id             UUID,
    created_by_admin_id  UUID,
    recurrence_rule_id   UUID,
    title                VARCHAR(160)   NOT NULL,
    -- Le créneau est UNE donnée : opérateurs && et @> directement applicables,
    -- indexable en GiST, ce que deux colonnes séparées ne permettent pas.
    time_range           TSTZRANGE      NOT NULL,
    attendee_count       SMALLINT       NOT NULL,
    status               booking_status NOT NULL DEFAULT 'confirmee',
    source               booking_source NOT NULL DEFAULT 'utilisateur',
    -- Créée en passant outre les règles de durée ou de capacité ; jamais en
    -- passant outre un conflit, que la contrainte EXCLUDE rend impossible.
    is_forced            BOOLEAN        NOT NULL DEFAULT false,
    checked_in_at        TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ,
    cancel_reason        VARCHAR(255),
    created_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ    NOT NULL DEFAULT now(),
    deleted_at           TIMESTAMPTZ,

    CONSTRAINT pk_bookings PRIMARY KEY (id),
    -- RESTRICT : une salle qui porte des réservations ne se supprime pas ; elle
    -- s'archive, ce que la suppression logique de rooms prend en charge.
    CONSTRAINT fk_bookings_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_owner FOREIGN KEY (owner_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    -- SET NULL : l'historique des réservations survit au départ de l'administrateur.
    CONSTRAINT fk_bookings_created_by_admin FOREIGN KEY (created_by_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    -- SET NULL : supprimer une série ne supprime pas les occurrences déjà tenues.
    CONSTRAINT fk_bookings_recurrence FOREIGN KEY (recurrence_rule_id)
        REFERENCES recurrence_rules (id) ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT ck_bookings_title_not_blank CHECK (btrim(title) <> ''),

    -- Bornes finies et normalisées en [) : deux réunions dont l'une finit quand
    -- l'autre commence ne se chevauchent pas.
    CONSTRAINT ck_bookings_range_bounds CHECK (
        NOT isempty(time_range)
        AND lower(time_range) IS NOT NULL
        AND upper(time_range) IS NOT NULL
        AND lower_inc(time_range)
        AND NOT upper_inc(time_range)
    ),

    -- Durée minimale et maximale d'une réunion. Un blocage administratif en est
    -- exempté : fermer une salle pour travaux dure une journée entière.
    CONSTRAINT ck_bookings_duration CHECK (
        source = 'blocage'
        OR (upper(time_range) - lower(time_range)) BETWEEN INTERVAL '30 minutes' AND INTERVAL '4 hours'
    ),
    CONSTRAINT ck_bookings_blocking_duration CHECK (
        source <> 'blocage'
        OR (upper(time_range) - lower(time_range)) <= INTERVAL '30 days'
    ),

    -- Un blocage n'a ni organisateur ni effectif ; toute autre réservation a les deux.
    CONSTRAINT ck_bookings_owner_presence CHECK ((owner_id IS NULL) = (source = 'blocage')),
    CONSTRAINT ck_bookings_attendee_count CHECK (
        attendee_count >= 0 AND (source = 'blocage' OR attendee_count > 0)
    ),

    -- Annulation : statut, horodatage et motif vont ensemble ou pas du tout.
    CONSTRAINT ck_bookings_cancel_state CHECK (
        (status = 'annulee') = (cancelled_at IS NOT NULL)
        AND (status = 'annulee') = (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')
    ),

    -- La présence ne se valide pas avant le début du créneau.
    CONSTRAINT ck_bookings_checkin_after_start CHECK (
        checked_in_at IS NULL OR checked_in_at >= lower(time_range)
    ),
    -- Une réservation annulée n'a jamais eu de présence validée.
    CONSTRAINT ck_bookings_cancelled_not_checked_in CHECK (
        status <> 'annulee' OR checked_in_at IS NULL
    ),

    -- Une occurrence rattachée à une série porte la source correspondante.
    CONSTRAINT ck_bookings_recurrence_source CHECK (
        recurrence_rule_id IS NULL OR source = 'recurrente'
    ),

    -- =========================================================================
    -- Contrainte centrale du sujet : impossible de réserver deux fois la même
    -- salle sur des créneaux qui se recouvrent. Le prédicat exclut les
    -- réservations annulées et supprimées, afin qu'un créneau libéré redevienne
    -- immédiatement réservable sans perdre la ligne, nécessaire aux statistiques.
    -- =========================================================================
    CONSTRAINT ex_bookings_no_overlap EXCLUDE USING gist (
        room_id    WITH =,
        time_range WITH &&
    ) WHERE (status <> 'annulee' AND deleted_at IS NULL)
);

-- La contrainte EXCLUDE crée déjà l'index GiST (room_id, time_range) filtré sur
-- les réservations actives : c'est exactement l'index de la recherche de
-- disponibilité, en créer un second serait un doublon coûteux en écriture.

-- Vue calendrier toutes salles confondues (écran A-03) : filtre sur la période
-- avant de joindre les salles.
CREATE INDEX IF NOT EXISTS idx_bookings_range_gist
    ON bookings USING gist (time_range) WHERE deleted_at IS NULL;

-- « Mes réservations », trié du plus récent au plus ancien.
CREATE INDEX IF NOT EXISTS idx_bookings_owner_start
    ON bookings (owner_id, lower(time_range) DESC) WHERE deleted_at IS NULL;

-- Filtres de la liste d'administration : statut et origine.
CREATE INDEX IF NOT EXISTS idx_bookings_status_source
    ON bookings (status, source, lower(time_range) DESC) WHERE deleted_at IS NULL;

-- Tâche de libération automatique : réservations commencées, présence non validée.
CREATE INDEX IF NOT EXISTS idx_bookings_checkin_pending
    ON bookings (lower(time_range))
    WHERE status = 'confirmee' AND checked_in_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_recurrence
    ON bookings (recurrence_rule_id) WHERE recurrence_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_created_by_admin
    ON bookings (created_by_admin_id) WHERE created_by_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- booking_participants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_participants (
    id            UUID                 NOT NULL DEFAULT gen_random_uuid(),
    booking_id    UUID                 NOT NULL,
    -- NULL pour un invité externe : l'adresse reste la source de vérité.
    user_id       UUID,
    email         CITEXT               NOT NULL,
    display_name  VARCHAR(120)         NOT NULL,
    response      participant_response NOT NULL DEFAULT 'en_attente',
    is_organizer  BOOLEAN              NOT NULL DEFAULT false,
    responded_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ          NOT NULL DEFAULT now(),

    CONSTRAINT pk_booking_participants PRIMARY KEY (id),
    CONSTRAINT fk_booking_participants_booking FOREIGN KEY (booking_id)
        REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_booking_participants_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_booking_participants_email UNIQUE (booking_id, email),
    CONSTRAINT ck_booking_participants_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    CONSTRAINT ck_booking_participants_name_not_blank CHECK (btrim(display_name) <> ''),
    CONSTRAINT ck_booking_participants_responded CHECK (
        (response = 'en_attente') = (responded_at IS NULL)
    )
);

-- Un seul organisateur par réservation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_participants_organizer
    ON booking_participants (booking_id) WHERE is_organizer;

CREATE INDEX IF NOT EXISTS idx_booking_participants_user
    ON booking_participants (user_id) WHERE user_id IS NOT NULL;

-- Réponse à une invitation reçue par e-mail, sans compte.
CREATE INDEX IF NOT EXISTS idx_booking_participants_email ON booking_participants (email);


-- -----------------------------------------------------------------------------
-- booking_events — frise de l'écran de détail, en ajout seul
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_events (
    id             UUID               NOT NULL DEFAULT gen_random_uuid(),
    booking_id     UUID               NOT NULL,
    event_type     booking_event_type NOT NULL,
    -- Libellé figé au moment du fait : il doit rester lisible même si la règle
    -- qui l'a produit a changé depuis.
    label          VARCHAR(160)       NOT NULL,
    actor_user_id  UUID,
    occurred_at    TIMESTAMPTZ        NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ        NOT NULL DEFAULT now(),

    CONSTRAINT pk_booking_events PRIMARY KEY (id),
    CONSTRAINT fk_booking_events_booking FOREIGN KEY (booking_id)
        REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_booking_events_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_booking_events_label_not_blank CHECK (btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS idx_booking_events_booking
    ON booking_events (booking_id, occurred_at);


-- -----------------------------------------------------------------------------
-- booking_access_codes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_access_codes (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    booking_id  UUID        NOT NULL,
    -- Le code en clair ne vit que dans l'e-mail et sur l'écran de confirmation.
    code_hash   TEXT        NOT NULL,
    -- Quatre caractères suffisent à l'affichage masqué « A-**** ».
    code_hint   VARCHAR(8)  NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_booking_access_codes PRIMARY KEY (id),
    CONSTRAINT fk_booking_access_codes_booking FOREIGN KEY (booking_id)
        REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_booking_access_codes_expiry CHECK (expires_at > issued_at),
    CONSTRAINT ck_booking_access_codes_hint_format CHECK (code_hint ~ '^[A-Z0-9]-\*{4}$')
);

-- Un seul code actif par réservation ; les codes révoqués restent pour l'audit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_access_codes_active
    ON booking_access_codes (booking_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_access_codes_booking
    ON booking_access_codes (booking_id, issued_at DESC);


-- -----------------------------------------------------------------------------
-- booking_rules — portée hiérarchique global < bâtiment < salle
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_rules (
    id                             UUID        NOT NULL DEFAULT gen_random_uuid(),
    scope                          rule_scope  NOT NULL,
    building_id                    UUID,
    room_id                        UUID,
    min_duration_min               SMALLINT    NOT NULL DEFAULT 30,
    max_duration_min               SMALLINT    NOT NULL DEFAULT 240,
    buffer_min                     SMALLINT    NOT NULL DEFAULT 15,
    max_advance_days               SMALLINT    NOT NULL DEFAULT 60,
    cancel_deadline_min            SMALLINT    NOT NULL DEFAULT 60,
    checkin_window_min             SMALLINT    NOT NULL DEFAULT 10,
    weekly_quota_hours             SMALLINT    NOT NULL DEFAULT 12,
    max_active_bookings            SMALLINT    NOT NULL DEFAULT 10,
    -- Au-delà de ce seuil, la réservation passe en validation administrative.
    validation_capacity_threshold  SMALLINT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_booking_rules PRIMARY KEY (id),
    CONSTRAINT fk_booking_rules_building FOREIGN KEY (building_id)
        REFERENCES buildings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_booking_rules_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE CASCADE,

    -- Exactement une cible renseignée, cohérente avec la portée déclarée.
    CONSTRAINT ck_booking_rules_scope_target CHECK (
        (scope = 'global'   AND building_id IS NULL     AND room_id IS NULL)
        OR (scope = 'batiment' AND building_id IS NOT NULL AND room_id IS NULL)
        OR (scope = 'salle'    AND building_id IS NULL     AND room_id IS NOT NULL)
    ),

    CONSTRAINT ck_booking_rules_min_duration CHECK (min_duration_min >= 15),
    CONSTRAINT ck_booking_rules_duration_order CHECK (max_duration_min > min_duration_min),
    CONSTRAINT ck_booking_rules_buffer CHECK (buffer_min BETWEEN 0 AND 120),
    CONSTRAINT ck_booking_rules_advance CHECK (max_advance_days BETWEEN 1 AND 365),
    CONSTRAINT ck_booking_rules_cancel_deadline CHECK (cancel_deadline_min BETWEEN 0 AND 10080),
    CONSTRAINT ck_booking_rules_checkin_window CHECK (checkin_window_min >= 5),
    CONSTRAINT ck_booking_rules_active_bookings CHECK (max_active_bookings BETWEEN 1 AND 100),
    CONSTRAINT ck_booking_rules_threshold CHECK (
        validation_capacity_threshold IS NULL OR validation_capacity_threshold >= 1
    ),
    -- Un quota inférieur à la durée d'une seule réservation rendrait la règle
    -- inapplicable : aucune réservation maximale ne tiendrait dans la semaine.
    CONSTRAINT ck_booking_rules_quota_coherence CHECK (
        weekly_quota_hours * 60 >= max_duration_min
    )
);

-- Une règle globale, une par bâtiment, une par salle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_rules_global
    ON booking_rules (scope) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_rules_building
    ON booking_rules (building_id) WHERE scope = 'batiment';
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_rules_room
    ON booking_rules (room_id) WHERE scope = 'salle';


-- -----------------------------------------------------------------------------
-- opening_hours — jours et horaires d'ouverture, même hiérarchie de portée
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opening_hours (
    id           UUID        NOT NULL DEFAULT gen_random_uuid(),
    scope        rule_scope  NOT NULL,
    building_id  UUID,
    room_id      UUID,
    -- 0 = dimanche, conformément à EXTRACT(DOW) de PostgreSQL.
    weekday      SMALLINT    NOT NULL,
    -- Une fermeture est une ligne à false, jamais une ligne absente : l'absence
    -- signifierait « non configuré », état différent et indistinguable sinon.
    is_open      BOOLEAN     NOT NULL DEFAULT true,
    opens_at     TIME        NOT NULL,
    closes_at    TIME        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_opening_hours PRIMARY KEY (id),
    CONSTRAINT fk_opening_hours_building FOREIGN KEY (building_id)
        REFERENCES buildings (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_opening_hours_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_opening_hours_scope_target CHECK (
        (scope = 'global'   AND building_id IS NULL     AND room_id IS NULL)
        OR (scope = 'batiment' AND building_id IS NOT NULL AND room_id IS NULL)
        OR (scope = 'salle'    AND building_id IS NULL     AND room_id IS NOT NULL)
    ),
    CONSTRAINT ck_opening_hours_weekday CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT ck_opening_hours_order CHECK (closes_at > opens_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_hours_global
    ON opening_hours (weekday) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_hours_building
    ON opening_hours (building_id, weekday) WHERE scope = 'batiment';
CREATE UNIQUE INDEX IF NOT EXISTS uq_opening_hours_room
    ON opening_hours (room_id, weekday) WHERE scope = 'salle';


-- -----------------------------------------------------------------------------
-- closure_periods — fermetures exceptionnelles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS closure_periods (
    id                    UUID         NOT NULL DEFAULT gen_random_uuid(),
    label                 VARCHAR(160) NOT NULL,
    -- Bornes de dates en [) : la fin est exclusive, comme les créneaux.
    date_span             DATERANGE    NOT NULL,
    kind                  closure_kind NOT NULL,
    -- Portée globale : aucune ligne dans les deux tables de liaison. La cohérence
    -- entre ce drapeau et les liaisons est applicative, un CHECK ne franchit pas
    -- les frontières de table.
    is_global             BOOLEAN      NOT NULL DEFAULT true,
    created_by_admin_id   UUID,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_closure_periods PRIMARY KEY (id),
    CONSTRAINT fk_closure_periods_created_by FOREIGN KEY (created_by_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_closure_periods_label_not_blank CHECK (btrim(label) <> ''),
    CONSTRAINT ck_closure_periods_span CHECK (
        NOT isempty(date_span)
        AND lower(date_span) IS NOT NULL
        AND upper(date_span) IS NOT NULL
    )
);

-- Aperçu annuel et moteur de disponibilité : recherche par recouvrement de dates.
CREATE INDEX IF NOT EXISTS idx_closure_periods_span
    ON closure_periods USING gist (date_span);

CREATE INDEX IF NOT EXISTS idx_closure_periods_created_by
    ON closure_periods (created_by_admin_id) WHERE created_by_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- closure_buildings / closure_rooms — portée d'une fermeture
-- Deux tables de liaison plutôt qu'une colonne tableau : une clé étrangère ne
-- peut pas contraindre les éléments d'un tableau.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS closure_buildings (
    closure_id   UUID        NOT NULL,
    building_id  UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_closure_buildings PRIMARY KEY (closure_id, building_id),
    CONSTRAINT fk_closure_buildings_closure FOREIGN KEY (closure_id)
        REFERENCES closure_periods (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_closure_buildings_building FOREIGN KEY (building_id)
        REFERENCES buildings (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_closure_buildings_building
    ON closure_buildings (building_id, closure_id);

CREATE TABLE IF NOT EXISTS closure_rooms (
    closure_id  UUID        NOT NULL,
    room_id     UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_closure_rooms PRIMARY KEY (closure_id, room_id),
    CONSTRAINT fk_closure_rooms_closure FOREIGN KEY (closure_id)
        REFERENCES closure_periods (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_closure_rooms_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_closure_rooms_room
    ON closure_rooms (room_id, closure_id);


-- -----------------------------------------------------------------------------
-- access_requests — file d'arbitrage unique
-- Conflit, dépassement de capacité, accès hors horaires : même cycle de vie et
-- même écran, une seule table plutôt que quatre.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_requests (
    id                    UUID           NOT NULL DEFAULT gen_random_uuid(),
    -- Référence lisible par le support : « #CONF-8492 ».
    reference             VARCHAR(16)    NOT NULL,
    requester_id          UUID           NOT NULL,
    room_id               UUID           NOT NULL,
    -- Réservation contestée, le cas échéant.
    booking_id            UUID,
    requested_range       TSTZRANGE      NOT NULL,
    access_type           access_type    NOT NULL,
    reason                TEXT,
    status                request_status NOT NULL DEFAULT 'ouvert',
    decided_by_admin_id   UUID,
    decision_comment      TEXT,
    alternative_room_id   UUID,
    decided_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT pk_access_requests PRIMARY KEY (id),
    CONSTRAINT uq_access_requests_reference UNIQUE (reference),
    CONSTRAINT fk_access_requests_requester FOREIGN KEY (requester_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_access_requests_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_access_requests_booking FOREIGN KEY (booking_id)
        REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_access_requests_decided_by FOREIGN KEY (decided_by_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_access_requests_alternative_room FOREIGN KEY (alternative_room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE SET NULL,

    CONSTRAINT ck_access_requests_reference_format CHECK (reference ~ '^#[A-Z]{3,4}-[0-9]{3,6}$'),
    CONSTRAINT ck_access_requests_range CHECK (
        NOT isempty(requested_range)
        AND lower(requested_range) IS NOT NULL
        AND upper(requested_range) IS NOT NULL
    ),
    -- Une demande ouverte n'a pas de décision ; une demande tranchée est datée.
    -- decided_by_admin_id n'est pas exigé : il passe à NULL si le compte disparaît.
    CONSTRAINT ck_access_requests_decision CHECK (
        (status = 'ouvert' AND decided_at IS NULL)
        OR (status <> 'ouvert' AND decided_at IS NOT NULL)
    ),
    -- Une salle ne peut pas être proposée en remplacement d'elle-même.
    CONSTRAINT ck_access_requests_alternative_differs CHECK (
        alternative_room_id IS NULL OR alternative_room_id <> room_id
    )
);

-- File de traitement : les demandes ouvertes d'abord, les plus anciennes en tête.
CREATE INDEX IF NOT EXISTS idx_access_requests_queue
    ON access_requests (status, created_at) WHERE status = 'ouvert';

CREATE INDEX IF NOT EXISTS idx_access_requests_room ON access_requests (room_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_booking
    ON access_requests (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_requests_decided_by
    ON access_requests (decided_by_admin_id) WHERE decided_by_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_requests_alternative
    ON access_requests (alternative_room_id) WHERE alternative_room_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Horodatage automatique des mises à jour
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_recurrence_rules_updated_at
    BEFORE UPDATE ON recurrence_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_booking_participants_updated_at
    BEFORE UPDATE ON booking_participants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_booking_events_updated_at
    BEFORE UPDATE ON booking_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_booking_access_codes_updated_at
    BEFORE UPDATE ON booking_access_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_booking_rules_updated_at
    BEFORE UPDATE ON booking_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_opening_hours_updated_at
    BEFORE UPDATE ON opening_hours FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_closure_periods_updated_at
    BEFORE UPDATE ON closure_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_closure_buildings_updated_at
    BEFORE UPDATE ON closure_buildings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_closure_rooms_updated_at
    BEFORE UPDATE ON closure_rooms FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_access_requests_updated_at
    BEFORE UPDATE ON access_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Socle de configuration — données de structure, pas des seeds de démonstration
-- La résolution salle → bâtiment → global a besoin d'un plancher : sans règle
-- globale ni horaires globaux, aucune réservation ne peut être validée.
-- -----------------------------------------------------------------------------
INSERT INTO booking_rules (scope) VALUES ('global')
ON CONFLICT DO NOTHING;

INSERT INTO opening_hours (scope, weekday, is_open, opens_at, closes_at) VALUES
    ('global', 1, true,  '08:00', '20:00'),
    ('global', 2, true,  '08:00', '20:00'),
    ('global', 3, true,  '08:00', '20:00'),
    ('global', 4, true,  '08:00', '20:00'),
    ('global', 5, true,  '08:00', '20:00'),
    ('global', 6, true,  '09:00', '13:00'),
    ('global', 0, false, '00:00', '23:59')
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- Documentation embarquée
-- -----------------------------------------------------------------------------
COMMENT ON TABLE  bookings IS
    'Réservations. ex_bookings_no_overlap interdit toute double réservation au niveau base.';
COMMENT ON COLUMN bookings.time_range IS
    'Créneau en TSTZRANGE borné [) : indexable en GiST et comparable par && .';
COMMENT ON COLUMN bookings.is_forced IS
    'Créée en ignorant les règles de durée ou de capacité, jamais un conflit.';
COMMENT ON COLUMN bookings.attendee_count IS
    'Instantané de l''effectif annoncé, confronté à la capacité au moment de la réservation.';
COMMENT ON TABLE  booking_rules IS
    'Règles de réservation. Résolution applicative : salle, puis bâtiment, puis global.';
COMMENT ON TABLE  opening_hours IS
    'Jours et horaires d''ouverture. Une fermeture est is_open = false, pas une ligne absente.';
COMMENT ON TABLE  access_requests IS
    'File d''arbitrage unique : conflits, dépassements de capacité et accès hors horaires.';
