-- =============================================================================
-- SmartRoom Manager — 05 : domaine support et traçabilité
-- Tickets, base de connaissances, chatbot, notifications, modèles d'e-mails,
-- journal d'audit.
-- Prérequis : 00 → 04
-- =============================================================================


-- -----------------------------------------------------------------------------
-- tickets
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
    id                  UUID          NOT NULL DEFAULT gen_random_uuid(),
    -- Référence courte communiquée au demandeur : « #152 ».
    reference           VARCHAR(16)   NOT NULL,
    requester_id        UUID          NOT NULL,
    room_id             UUID,
    booking_id          UUID,
    subject             VARCHAR(180)  NOT NULL,
    category            VARCHAR(40)   NOT NULL,
    status              ticket_status NOT NULL DEFAULT 'ouvert',
    assigned_admin_id   UUID,
    first_response_at   TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_tickets PRIMARY KEY (id),
    CONSTRAINT uq_tickets_reference UNIQUE (reference),
    -- RESTRICT : l'historique du support reste attribuable à son demandeur.
    CONSTRAINT fk_tickets_requester FOREIGN KEY (requester_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_tickets_room FOREIGN KEY (room_id)
        REFERENCES rooms (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_tickets_booking FOREIGN KEY (booking_id)
        REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_tickets_assigned_admin FOREIGN KEY (assigned_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_tickets_reference_format CHECK (reference ~ '^#?[0-9]{1,10}$'),
    CONSTRAINT ck_tickets_subject_not_blank CHECK (btrim(subject) <> ''),
    -- Un ticket résolu porte sa date de résolution, et lui seul.
    CONSTRAINT ck_tickets_resolved CHECK ((status IN ('resolu', 'ferme')) = (resolved_at IS NOT NULL))
);

-- File de traitement de l'écran A-13 : onglets par statut, plus récent en tête.
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_room ON tickets (room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_booking ON tickets (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_admin
    ON tickets (assigned_admin_id) WHERE assigned_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- ticket_messages
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_messages (
    id                UUID        NOT NULL DEFAULT gen_random_uuid(),
    ticket_id         UUID        NOT NULL,
    author_user_id    UUID,
    is_from_support   BOOLEAN     NOT NULL DEFAULT false,
    -- Une note interne reste dans le fil mais n'est jamais envoyée au demandeur :
    -- l'API filtre dessus, la colonne est donc indexée.
    is_internal       BOOLEAN     NOT NULL DEFAULT false,
    body              TEXT        NOT NULL,
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_ticket_messages PRIMARY KEY (id),
    CONSTRAINT fk_ticket_messages_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_ticket_messages_author FOREIGN KEY (author_user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_ticket_messages_body_not_blank CHECK (btrim(body) <> ''),
    -- Seul le support prend des notes internes.
    CONSTRAINT ck_ticket_messages_internal_is_support CHECK (NOT is_internal OR is_from_support)
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket
    ON ticket_messages (ticket_id, sent_at);

-- Fil visible par le demandeur : les notes internes en sont exclues.
CREATE INDEX IF NOT EXISTS idx_ticket_messages_public
    ON ticket_messages (ticket_id, sent_at) WHERE NOT is_internal;


-- -----------------------------------------------------------------------------
-- ticket_response_templates — réponses types insérables dans le fil
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_response_templates (
    id          UUID         NOT NULL DEFAULT gen_random_uuid(),
    code        VARCHAR(40)  NOT NULL,
    category    VARCHAR(40)  NOT NULL,
    label       VARCHAR(120) NOT NULL,
    body        TEXT         NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_ticket_response_templates PRIMARY KEY (id),
    CONSTRAINT uq_ticket_response_templates_code UNIQUE (code),
    CONSTRAINT ck_ticket_response_templates_body_not_blank CHECK (btrim(body) <> '')
);

-- Réponses proposées pour la catégorie du ticket ouvert.
CREATE INDEX IF NOT EXISTS idx_ticket_response_templates_category
    ON ticket_response_templates (category, label) WHERE is_active;


-- -----------------------------------------------------------------------------
-- faq_categories
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faq_categories (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    code        VARCHAR(40) NOT NULL,
    label       VARCHAR(80) NOT NULL,
    icon        VARCHAR(40),
    sort_order  SMALLINT    NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_faq_categories PRIMARY KEY (id),
    CONSTRAINT uq_faq_categories_code UNIQUE (code),
    CONSTRAINT ck_faq_categories_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);


-- -----------------------------------------------------------------------------
-- faq_articles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faq_articles (
    id            UUID           NOT NULL DEFAULT gen_random_uuid(),
    category_id   UUID           NOT NULL,
    slug          VARCHAR(160)   NOT NULL,
    title         VARCHAR(180)   NOT NULL,
    excerpt       VARCHAR(255)   NOT NULL,
    body          TEXT           NOT NULL,
    status        article_status NOT NULL DEFAULT 'brouillon',
    -- Compteur dénormalisé : un COUNT sur une table de vues serait recalculé à
    -- chaque affichage du centre d'aide pour une information indicative.
    view_count    INTEGER        NOT NULL DEFAULT 0,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT pk_faq_articles PRIMARY KEY (id),
    -- RESTRICT : une catégorie encore peuplée ne se supprime pas.
    CONSTRAINT fk_faq_articles_category FOREIGN KEY (category_id)
        REFERENCES faq_categories (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_faq_articles_slug UNIQUE (slug),
    CONSTRAINT ck_faq_articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT ck_faq_articles_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT ck_faq_articles_views CHECK (view_count >= 0),
    -- Un article publié a une date de publication et un contenu réel.
    CONSTRAINT ck_faq_articles_published CHECK (
        (status = 'publie') = (published_at IS NOT NULL)
    ),
    CONSTRAINT ck_faq_articles_publishable CHECK (
        status <> 'publie' OR length(btrim(body)) >= 40
    )
);

-- Centre d'aide : articles publiés d'une catégorie, les plus consultés en tête.
CREATE INDEX IF NOT EXISTS idx_faq_articles_published
    ON faq_articles (category_id, view_count DESC) WHERE status = 'publie';

CREATE INDEX IF NOT EXISTS idx_faq_articles_category ON faq_articles (category_id);

-- Recherche plein texte de la barre du centre d'aide.
CREATE INDEX IF NOT EXISTS idx_faq_articles_search_trgm
    ON faq_articles USING gin ((title || ' ' || excerpt) gin_trgm_ops);


-- -----------------------------------------------------------------------------
-- faq_article_links — articles liés, auto-relation M–N
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faq_article_links (
    article_id          UUID        NOT NULL,
    related_article_id  UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_faq_article_links PRIMARY KEY (article_id, related_article_id),
    CONSTRAINT fk_faq_article_links_article FOREIGN KEY (article_id)
        REFERENCES faq_articles (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_faq_article_links_related FOREIGN KEY (related_article_id)
        REFERENCES faq_articles (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT ck_faq_article_links_not_self CHECK (article_id <> related_article_id)
);

CREATE INDEX IF NOT EXISTS idx_faq_article_links_related
    ON faq_article_links (related_article_id);


-- -----------------------------------------------------------------------------
-- chatbot_intents
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chatbot_intents (
    id                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    code                   VARCHAR(40)  NOT NULL,
    label                  VARCHAR(120) NOT NULL,
    answer                 TEXT         NOT NULL,
    -- Suggestions affichées sous la réponse. Tableau et non table fille : elles
    -- sont rendues d'un bloc et jamais recherchées, contrairement aux mots-clés.
    quick_replies          TEXT[]       NOT NULL DEFAULT '{}',
    escalates_to_ticket    BOOLEAN      NOT NULL DEFAULT false,
    faq_article_id         UUID,
    is_active              BOOLEAN      NOT NULL DEFAULT true,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_chatbot_intents PRIMARY KEY (id),
    CONSTRAINT uq_chatbot_intents_code UNIQUE (code),
    -- SET NULL : l'intention survit à la dépublication de l'article qu'elle cite.
    CONSTRAINT fk_chatbot_intents_article FOREIGN KEY (faq_article_id)
        REFERENCES faq_articles (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_chatbot_intents_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT ck_chatbot_intents_answer_not_blank CHECK (btrim(answer) <> ''),
    CONSTRAINT ck_chatbot_intents_quick_replies CHECK (
        array_length(quick_replies, 1) IS NULL OR array_length(quick_replies, 1) <= 5
    )
);

CREATE INDEX IF NOT EXISTS idx_chatbot_intents_article
    ON chatbot_intents (faq_article_id) WHERE faq_article_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- chatbot_intent_keywords
-- Table fille et non tableau : un mot-clé se recherche, se compte et s'indexe.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chatbot_intent_keywords (
    id          UUID        NOT NULL DEFAULT gen_random_uuid(),
    intent_id   UUID        NOT NULL,
    keyword     CITEXT      NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_chatbot_intent_keywords PRIMARY KEY (id),
    CONSTRAINT fk_chatbot_intent_keywords_intent FOREIGN KEY (intent_id)
        REFERENCES chatbot_intents (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_chatbot_intent_keywords UNIQUE (intent_id, keyword),
    CONSTRAINT ck_chatbot_intent_keywords_not_blank CHECK (btrim(keyword) <> '')
);

-- Reconnaissance d'intention : recherche par mot-clé, toutes intentions confondues.
CREATE INDEX IF NOT EXISTS idx_chatbot_intent_keywords_keyword
    ON chatbot_intent_keywords (keyword);


-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID                 NOT NULL DEFAULT gen_random_uuid(),
    user_id     UUID                 NOT NULL,
    channel     notification_channel NOT NULL DEFAULT 'in_app',
    title       VARCHAR(180)         NOT NULL,
    body        TEXT,
    booking_id  UUID,
    ticket_id   UUID,
    read_at     TIMESTAMPTZ,
    sent_at     TIMESTAMPTZ          NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ          NOT NULL DEFAULT now(),

    CONSTRAINT pk_notifications PRIMARY KEY (id),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_notifications_booking FOREIGN KEY (booking_id)
        REFERENCES bookings (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_notifications_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_notifications_title_not_blank CHECK (btrim(title) <> '')
);

-- Compteur de la barre supérieure : notifications non lues d'un utilisateur.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications (user_id, sent_at DESC) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON notifications (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_booking
    ON notifications (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_ticket
    ON notifications (ticket_id) WHERE ticket_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- email_template_variables — référentiel des variables autorisées
-- Il permet de refuser un modèle citant une variable inconnue, qui resterait
-- non remplacée dans l'e-mail envoyé à l'utilisateur.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_template_variables (
    id            UUID         NOT NULL DEFAULT gen_random_uuid(),
    code          VARCHAR(40)  NOT NULL,
    label         VARCHAR(120) NOT NULL,
    sample_value  VARCHAR(180) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_email_template_variables PRIMARY KEY (id),
    CONSTRAINT uq_email_template_variables_code UNIQUE (code),
    CONSTRAINT ck_email_template_variables_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);


-- -----------------------------------------------------------------------------
-- email_templates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_templates (
    id                     UUID         NOT NULL DEFAULT gen_random_uuid(),
    code                   VARCHAR(40)  NOT NULL,
    name                   VARCHAR(120) NOT NULL,
    trigger_label          VARCHAR(180) NOT NULL,
    subject                VARCHAR(255) NOT NULL,
    body                   TEXT         NOT NULL,
    -- Un modèle désactivé n'envoie plus rien pour l'événement correspondant.
    is_enabled             BOOLEAN      NOT NULL DEFAULT true,
    updated_by_admin_id    UUID,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_email_templates PRIMARY KEY (id),
    CONSTRAINT uq_email_templates_code UNIQUE (code),
    CONSTRAINT fk_email_templates_updated_by FOREIGN KEY (updated_by_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_email_templates_subject_not_blank CHECK (btrim(subject) <> ''),
    CONSTRAINT ck_email_templates_body_not_blank CHECK (btrim(body) <> '')
);

CREATE INDEX IF NOT EXISTS idx_email_templates_updated_by
    ON email_templates (updated_by_admin_id) WHERE updated_by_admin_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- audit_logs — journal immuable
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    actor_admin_id   UUID,
    -- Nom figé : le journal doit rester lisible après suppression du compte,
    -- ce qu'une simple jointure ne garantirait plus.
    actor_label      VARCHAR(120) NOT NULL,
    action           audit_action NOT NULL,
    target_type      VARCHAR(60)  NOT NULL,
    -- Pas de clé étrangère : la cible est polymorphe et peut avoir disparu ;
    -- une FK empêcherait précisément de journaliser une suppression.
    target_id        UUID,
    target_label     VARCHAR(160) NOT NULL,
    diff_before      JSONB,
    diff_after       JSONB,
    ip_address       INET,
    user_agent       VARCHAR(255),
    session_id       VARCHAR(64),
    flagged_at       TIMESTAMPTZ,
    flag_reason      VARCHAR(255),
    occurred_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_audit_logs PRIMARY KEY (id),
    CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_admin_id)
        REFERENCES admin_accounts (user_id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT ck_audit_logs_actor_label_not_blank CHECK (btrim(actor_label) <> ''),
    CONSTRAINT ck_audit_logs_target_label_not_blank CHECK (btrim(target_label) <> ''),
    CONSTRAINT ck_audit_logs_flag CHECK (flag_reason IS NULL OR flagged_at IS NOT NULL)
);

-- Journal filtré par période, puis par auteur et par action.
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred ON audit_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs (actor_admin_id, occurred_at DESC) WHERE actor_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_flagged
    ON audit_logs (occurred_at DESC) WHERE flagged_at IS NOT NULL;

-- Recherche sur la cible et l'auteur depuis la barre de l'écran A-16.
CREATE INDEX IF NOT EXISTS idx_audit_logs_search_trgm
    ON audit_logs USING gin ((target_label || ' ' || actor_label) gin_trgm_ops);

-- Immuabilité : ni suppression, ni réécriture. Seul le signalement est modifiable.
CREATE OR REPLACE TRIGGER trg_audit_logs_append_only
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();


-- -----------------------------------------------------------------------------
-- Horodatage automatique des mises à jour
-- audit_logs en est exclue : sa seule mise à jour tolérée est le signalement,
-- et son horodatage doit rester celui du fait, pas celui de la marque.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_tickets_updated_at
    BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_ticket_messages_updated_at
    BEFORE UPDATE ON ticket_messages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_ticket_response_templates_updated_at
    BEFORE UPDATE ON ticket_response_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_faq_categories_updated_at
    BEFORE UPDATE ON faq_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_faq_articles_updated_at
    BEFORE UPDATE ON faq_articles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_faq_article_links_updated_at
    BEFORE UPDATE ON faq_article_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_chatbot_intents_updated_at
    BEFORE UPDATE ON chatbot_intents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_chatbot_intent_keywords_updated_at
    BEFORE UPDATE ON chatbot_intent_keywords FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_notifications_updated_at
    BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_email_template_variables_updated_at
    BEFORE UPDATE ON email_template_variables FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER trg_email_templates_updated_at
    BEFORE UPDATE ON email_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Référentiel des variables d'e-mail — données de structure
-- Le moteur de rendu ne connaît que ces sept variables : elles appartiennent au
-- schéma, pas au jeu de démonstration.
-- -----------------------------------------------------------------------------
INSERT INTO email_template_variables (code, label, sample_value) VALUES
    ('prenom',            'Prénom du destinataire', 'Dylan'),
    ('salle',             'Nom de la salle',        'Salle Vinci'),
    ('batiment',          'Bâtiment et étage',      'Bâtiment A — 2e étage'),
    ('date',              'Date de la réservation', 'jeudi 26 mars 2026'),
    ('creneau',           'Créneau horaire',        '14:00 - 15:30'),
    ('code_acces',        'Code d''accès temporaire', 'A-4821'),
    ('lien_reservation',  'Lien vers la réservation', 'https://smartroom.ece.fr/app/reservations/1')
ON CONFLICT (code) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Documentation embarquée
-- -----------------------------------------------------------------------------
COMMENT ON TABLE  tickets IS 'Demandes d''aide des utilisateurs, de l''ouverture à la résolution.';
COMMENT ON COLUMN ticket_messages.is_internal IS
    'Note interne : visible du support seul, jamais envoyée au demandeur.';
COMMENT ON COLUMN faq_articles.view_count IS
    'Compteur dénormalisé : information indicative, pas une agrégation de table de vues.';
COMMENT ON COLUMN chatbot_intents.quick_replies IS
    'Suggestions rendues d''un bloc ; les mots-clés recherchés vivent dans une table fille.';
COMMENT ON TABLE  audit_logs IS
    'Journal immuable : ni DELETE ni réécriture, seul le signalement est modifiable.';
COMMENT ON COLUMN audit_logs.target_id IS
    'Sans clé étrangère : la cible est polymorphe et peut avoir été supprimée.';
