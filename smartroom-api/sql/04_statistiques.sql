-- =============================================================================
-- SmartRoom Manager — 04 : statistiques d'occupation
-- Vue matérialisée horaire, vue dérivée journalière, résolution des horaires
-- d'ouverture et fonction de rafraîchissement.
-- Prérequis : 00 → 03
--
-- Stratégie de rafraîchissement
--   - REFRESH MATERIALIZED VIEW CONCURRENTLY toutes les heures, déclenché par le
--     planificateur applicatif (APScheduler côté FastAPI) ou par pg_cron.
--   - CONCURRENTLY exige un index unique : uq_mv_room_occupancy_hourly le fournit,
--     et laisse les lectures du tableau de bord se poursuivre pendant le calcul.
--   - Une heure de retard est acceptable pour un indicateur ; la file d'arbitrage
--     et le moteur de disponibilité lisent toujours les tables, jamais la vue.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Fuseau de référence
-- Les créneaux sont stockés en TIMESTAMPTZ, donc en UTC. Un tableau de bord
-- raisonne en heure locale : « 14 h » doit désigner 14 h à Paris, été comme hiver.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smartroom_timezone() RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT 'Europe/Paris'::text;
$$;


-- -----------------------------------------------------------------------------
-- Résolution des horaires d'ouverture : salle, puis bâtiment, puis global.
-- Renvoie l'amplitude d'ouverture en minutes pour un jour de semaine donné,
-- 0 si l'entité est fermée ce jour-là.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_opening_minutes(
    p_room_id     UUID,
    p_building_id UUID,
    p_weekday     SMALLINT
) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT CASE WHEN is_open
                     THEN EXTRACT(EPOCH FROM (closes_at - opens_at)) / 60
                     ELSE 0 END
           FROM opening_hours
          WHERE scope = 'salle' AND room_id = p_room_id AND weekday = p_weekday),
        (SELECT CASE WHEN is_open
                     THEN EXTRACT(EPOCH FROM (closes_at - opens_at)) / 60
                     ELSE 0 END
           FROM opening_hours
          WHERE scope = 'batiment' AND building_id = p_building_id AND weekday = p_weekday),
        (SELECT CASE WHEN is_open
                     THEN EXTRACT(EPOCH FROM (closes_at - opens_at)) / 60
                     ELSE 0 END
           FROM opening_hours
          WHERE scope = 'global' AND weekday = p_weekday),
        0
    );
$$;


-- -----------------------------------------------------------------------------
-- mv_room_occupancy_hourly
-- Une ligne par salle, par date et par heure locale. Chaque réservation est
-- découpée en tranches horaires : une réunion de 14 h à 15 h 30 alimente l'heure
-- 14 pour 60 minutes et l'heure 15 pour 30 minutes.
-- -----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_room_occupancy_hourly CASCADE;

CREATE MATERIALIZED VIEW mv_room_occupancy_hourly AS
SELECT
    r.id                                                          AS room_id,
    f.building_id                                                 AS building_id,
    (tranche AT TIME ZONE smartroom_timezone())::date             AS occupancy_date,
    EXTRACT(HOUR FROM tranche AT TIME ZONE smartroom_timezone())::SMALLINT
                                                                  AS hour_of_day,
    count(*)::INTEGER                                             AS booking_count,
    -- Minutes réellement occupées dans la tranche : l'intersection du créneau
    -- et de l'heure, pas l'heure entière.
    ROUND(SUM(
        EXTRACT(EPOCH FROM (
            LEAST(upper(b.time_range), tranche + INTERVAL '1 hour')
            - GREATEST(lower(b.time_range), tranche)
        )) / 60
    )::numeric, 2)                                                AS booked_minutes,
    count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::INTEGER   AS checked_in_count,
    count(*) FILTER (WHERE b.source = 'blocage')::INTEGER          AS blocking_count
FROM bookings b
JOIN rooms  r ON r.id = b.room_id
JOIN floors f ON f.id = r.floor_id
CROSS JOIN LATERAL generate_series(
    date_trunc('hour', lower(b.time_range)),
    upper(b.time_range) - INTERVAL '1 microsecond',
    INTERVAL '1 hour'
) AS tranche
WHERE b.status <> 'annulee'
  AND b.deleted_at IS NULL
GROUP BY r.id, f.building_id, 3, 4;

-- Index unique obligatoire pour REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_room_occupancy_hourly
    ON mv_room_occupancy_hourly (room_id, occupancy_date, hour_of_day);

-- Heatmap horaire du tableau de bord, tous bâtiments ou un seul.
CREATE INDEX IF NOT EXISTS idx_mv_occupancy_building_date
    ON mv_room_occupancy_hourly (building_id, occupancy_date, hour_of_day);

-- Courbe de tendance : agrégation par date sur une fenêtre glissante.
CREATE INDEX IF NOT EXISTS idx_mv_occupancy_date
    ON mv_room_occupancy_hourly (occupancy_date);


-- -----------------------------------------------------------------------------
-- v_room_occupancy_daily
-- Vue simple posée sur la vue matérialisée : le taux d'occupation rapporte les
-- minutes réservées à l'amplitude d'ouverture réelle du jour, et non à une
-- journée de 24 h qui écraserait tous les taux.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_room_occupancy_daily AS
SELECT
    o.room_id,
    o.building_id,
    o.occupancy_date,
    SUM(o.booking_count)::INTEGER    AS booking_count,
    SUM(o.booked_minutes)            AS booked_minutes,
    SUM(o.checked_in_count)::INTEGER AS checked_in_count,
    h.open_minutes,
    CASE
        WHEN h.open_minutes > 0
        THEN ROUND(LEAST(SUM(o.booked_minutes) / h.open_minutes, 1), 4)
        ELSE NULL
    END AS occupancy_rate
FROM mv_room_occupancy_hourly o
CROSS JOIN LATERAL (
    SELECT resolve_opening_minutes(
        o.room_id,
        o.building_id,
        EXTRACT(DOW FROM o.occupancy_date)::SMALLINT
    ) AS open_minutes
) AS h
GROUP BY o.room_id, o.building_id, o.occupancy_date, h.open_minutes;


-- -----------------------------------------------------------------------------
-- v_building_occupancy_daily
-- Agrégat par bâtiment : les minutes se somment, les amplitudes aussi, ce qui
-- pondère naturellement chaque salle par son temps d'ouverture.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_building_occupancy_daily AS
SELECT
    d.building_id,
    d.occupancy_date,
    COUNT(DISTINCT d.room_id)::INTEGER AS room_count,
    SUM(d.booking_count)::INTEGER      AS booking_count,
    SUM(d.booked_minutes)              AS booked_minutes,
    SUM(d.open_minutes)                AS open_minutes,
    CASE
        WHEN SUM(d.open_minutes) > 0
        THEN ROUND(SUM(d.booked_minutes) / SUM(d.open_minutes), 4)
        ELSE NULL
    END AS occupancy_rate
FROM v_room_occupancy_daily d
GROUP BY d.building_id, d.occupancy_date;


-- -----------------------------------------------------------------------------
-- Rafraîchissement
-- CONCURRENTLY par défaut : les lectures du tableau de bord ne sont pas bloquées.
-- Le premier rafraîchissement après création doit être non concurrent, la vue
-- n'étant pas encore peuplée — le paramètre permet de le forcer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_room_occupancy(p_concurrently BOOLEAN DEFAULT true)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF p_concurrently THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_room_occupancy_hourly;
    ELSE
        REFRESH MATERIALIZED VIEW mv_room_occupancy_hourly;
    END IF;
END;
$$;

-- Peuplement initial, non concurrent puisque la vue vient d'être créée.
SELECT refresh_room_occupancy(false);


-- -----------------------------------------------------------------------------
-- Documentation embarquée
-- -----------------------------------------------------------------------------
COMMENT ON MATERIALIZED VIEW mv_room_occupancy_hourly IS
    'Occupation par salle, date et heure locale. Rafraîchie CONCURRENTLY toutes les heures.';
COMMENT ON VIEW v_room_occupancy_daily IS
    'Taux d''occupation journalier par salle, rapporté à l''amplitude d''ouverture du jour.';
COMMENT ON VIEW v_building_occupancy_daily IS
    'Taux d''occupation journalier par bâtiment, pondéré par le temps d''ouverture de chaque salle.';
COMMENT ON FUNCTION resolve_opening_minutes(UUID, UUID, SMALLINT) IS
    'Amplitude d''ouverture en minutes, résolue salle puis bâtiment puis global.';
