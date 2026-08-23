-- =============================================================================
-- SmartRoom Manager — 00 : extensions, types énumérés, utilitaires communs
-- PostgreSQL 16. Fichier idempotent : rejouable sans erreur.
-- Ordre d'exécution : 00 → 01 → 02 → 03 → 04 → 05.
-- =============================================================================

-- gen_random_uuid() est natif depuis PostgreSQL 13 ; l'extension est conservée
-- pour rester exécutable sur une instance 12 et pour crypt() côté seeds.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Indispensable à la contrainte EXCLUDE anti-chevauchement : seul btree_gist
-- permet de combiner un opérateur d'égalité sur uuid et && sur un range.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Adresses e-mail comparées sans distinction de casse, sans index fonctionnel.
CREATE EXTENSION IF NOT EXISTS citext;

-- Recherche plein texte tolérante sur les noms de salle et les articles d'aide.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- -----------------------------------------------------------------------------
-- Types énumérés
-- CREATE TYPE n'accepte pas IF NOT EXISTS : la boucle rend le fichier rejouable.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    definition record;
    labels     text;
BEGIN
    FOR definition IN
        SELECT * FROM (VALUES
            ('booking_status',      ARRAY['en_attente', 'confirmee', 'terminee', 'annulee']),
            ('room_status',         ARRAY['disponible', 'maintenance', 'archivee']),
            ('ticket_status',       ARRAY['ouvert', 'en_cours', 'resolu', 'ferme']),
            ('access_type',         ARRAY['hors_jour_ouverture', 'hors_horaire',
                                          'depassement_capacite', 'equipement_indisponible',
                                          'conflit_reservation']),
            ('notification_channel', ARRAY['email', 'in_app']),
            ('booking_source',      ARRAY['utilisateur', 'admin', 'recurrente', 'blocage']),
            ('booking_event_type',  ARRAY['creation', 'confirmation', 'modification', 'rappel',
                                          'checkin', 'annulation', 'liberation_auto']),
            ('participant_response', ARRAY['en_attente', 'accepte', 'decline']),
            ('user_status',         ARRAY['actif', 'suspendu']),
            ('request_status',      ARRAY['ouvert', 'accorde', 'refuse', 'reoriente']),
            ('rule_scope',          ARRAY['global', 'batiment', 'salle']),
            ('closure_kind',        ARRAY['fermeture', 'exception']),
            ('recurrence_freq',     ARRAY['hebdomadaire', 'bihebdomadaire', 'mensuelle']),
            ('equipment_category',  ARRAY['audiovisuel', 'mobilier', 'amenagement']),
            ('article_status',      ARRAY['brouillon', 'publie']),
            ('audit_action',        ARRAY['creation', 'modification', 'suppression',
                                          'permission', 'maintenance', 'connexion']),
            ('plan_document_kind',  ARRAY['image', 'pdf'])
        ) AS v(type_name, type_labels)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = definition.type_name) THEN
            SELECT string_agg(quote_literal(label), ', ')
              INTO labels
              FROM unnest(definition.type_labels) AS label;

            EXECUTE format('CREATE TYPE %I AS ENUM (%s)', definition.type_name, labels);
        END IF;
    END LOOP;
END
$$;


-- -----------------------------------------------------------------------------
-- Horodatage de modification
-- Porté par un trigger et non par l'application : une mise à jour lancée depuis
-- psql ou une migration doit dater la ligne aussi sûrement qu'un appel de l'API.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- Journal d'audit : interdiction physique du DELETE et de la réécriture
-- Le signalement (flagged_at, flag_reason) reste la seule mise à jour tolérée.
-- La fonction est définie ici, le trigger est posé en 05 avec la table.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;
