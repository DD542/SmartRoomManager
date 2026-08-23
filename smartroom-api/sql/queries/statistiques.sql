-- =============================================================================
-- SmartRoom Manager — requêtes de référence : statistiques d'occupation
--
-- Alimentent le tableau de bord A-01 et les rapports A-02. Toutes lisent la vue
-- matérialisée `mv_room_occupancy_hourly`, rafraîchie toutes les heures ; la
-- file d'arbitrage et le moteur de disponibilité lisent les tables, jamais la vue.
--
-- Paramètres nommés :
--   :jours        profondeur de la fenêtre, en jours
--   :depuis       borne basse de la période d'un rapport
--   :jusqu_a      borne haute
--   :batiment     UUID du bâtiment, ou NULL pour tout le parc
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Quatre chiffres clés du tableau de bord, comparés à la période précédente
-- -----------------------------------------------------------------------------
WITH fenetre AS (
    SELECT (CURRENT_DATE - make_interval(days => :jours))::date  AS debut,
           (CURRENT_DATE + 1)::date                              AS fin,
           (CURRENT_DATE - make_interval(days => :jours * 2))::date AS debut_precedent
),
periode AS (
    SELECT d.*
      FROM v_room_occupancy_daily d, fenetre w
     WHERE d.occupancy_date >= w.debut AND d.occupancy_date < w.fin
),
precedente AS (
    SELECT d.*
      FROM v_room_occupancy_daily d, fenetre w
     WHERE d.occupancy_date >= w.debut_precedent AND d.occupancy_date < w.debut
)
SELECT
    -- Taux d'occupation moyen, pondéré par le temps d'ouverture de chaque salle.
    ROUND(
        COALESCE(SUM(p.booked_minutes) / NULLIF(SUM(p.open_minutes), 0), 0), 4
    ) AS occupancy_rate,
    COALESCE(SUM(p.booking_count), 0)::int AS period_bookings,
    (SELECT COALESCE(SUM(booking_count), 0)::int FROM precedente) AS previous_bookings,
    -- Absence de validation de présence sur les créneaux déjà passés.
    (
        SELECT ROUND(
            1 - COALESCE(
                count(*) FILTER (WHERE b.checked_in_at IS NOT NULL)::numeric
                / NULLIF(count(*), 0), 1
            ), 4
        )
          FROM bookings b, fenetre w
         WHERE b.status <> 'annulee'
           AND b.deleted_at IS NULL
           AND b.source <> 'blocage'
           AND upper(b.time_range) < now()
           AND lower(b.time_range) >= w.debut
    ) AS no_show_rate,
    (SELECT count(*)::int FROM access_requests WHERE status = 'ouvert') AS pending_requests,
    (SELECT count(*)::int FROM access_requests WHERE status <> 'ouvert') AS resolved_requests
  FROM periode p;


-- -----------------------------------------------------------------------------
-- 2. Courbe de tendance : occupation jour par jour sur la fenêtre
--
-- `generate_series` garantit une ligne par jour, y compris les jours sans
-- réservation : une courbe trouée se lit comme une absence de donnée, pas
-- comme un jour creux.
-- -----------------------------------------------------------------------------
SELECT jour::date AS occupancy_date,
       COALESCE(SUM(d.booking_count), 0)::int AS booking_count,
       COALESCE(SUM(d.booked_minutes), 0) AS booked_minutes,
       ROUND(
           COALESCE(SUM(d.booked_minutes) / NULLIF(SUM(d.open_minutes), 0), 0) * 100, 1
       ) AS occupancy_percent
  FROM generate_series(
           CURRENT_DATE - make_interval(days => :jours - 1),
           CURRENT_DATE,
           INTERVAL '1 day'
       ) AS jour
  LEFT JOIN v_room_occupancy_daily d
         ON d.occupancy_date = jour::date
        AND (CAST(:batiment AS uuid) IS NULL OR d.building_id = CAST(:batiment AS uuid))
 GROUP BY jour
 ORDER BY jour;


-- -----------------------------------------------------------------------------
-- 3. Densité horaire : heatmap jour ouvré × heure
-- -----------------------------------------------------------------------------
SELECT EXTRACT(DOW FROM o.occupancy_date)::int AS weekday,
       o.hour_of_day,
       SUM(o.booking_count)::int AS booking_count,
       ROUND(SUM(o.booked_minutes)) AS booked_minutes
  FROM mv_room_occupancy_hourly o
 WHERE o.occupancy_date >= CURRENT_DATE - make_interval(days => :jours)
   AND (CAST(:batiment AS uuid) IS NULL OR o.building_id = CAST(:batiment AS uuid))
   AND EXTRACT(DOW FROM o.occupancy_date) BETWEEN 1 AND 5
   AND o.hour_of_day BETWEEN 8 AND 19
 GROUP BY 1, 2
 ORDER BY 1, 2;


-- -----------------------------------------------------------------------------
-- 4. Rapport par salle sur une période — colonnes de l'export A-02
--
-- Les salles sans réservation sont conservées : c'est précisément l'information
-- qui déclenche l'alerte « salle sous-utilisée » du tableau de bord.
-- -----------------------------------------------------------------------------
-- Les deux sources sont agrégées séparément avant d'être jointes : joindre
-- directement la vue journalière et les réservations multiplierait les lignes
-- (une par jour × une par réservation) et gonflerait tous les totaux.
WITH occupation AS (
    SELECT d.room_id,
           SUM(d.booking_count)::int AS reservations,
           SUM(d.booked_minutes)     AS minutes_reservees,
           SUM(d.open_minutes)       AS minutes_ouverture
      FROM v_room_occupancy_daily d
     WHERE d.occupancy_date BETWEEN CAST(:depuis AS date) AND CAST(:jusqu_a AS date)
     GROUP BY d.room_id
),
presence AS (
    SELECT bk.room_id,
           count(*)                                                   AS passees,
           count(*) FILTER (WHERE bk.checked_in_at IS NOT NULL)        AS honorees
      FROM bookings bk
     WHERE bk.status <> 'annulee'
       AND bk.deleted_at IS NULL
       AND bk.source <> 'blocage'
       AND upper(bk.time_range) < now()
       AND (lower(bk.time_range) AT TIME ZONE smartroom_timezone())::date
           BETWEEN CAST(:depuis AS date) AND CAST(:jusqu_a AS date)
     GROUP BY bk.room_id
)
SELECT r.name                                        AS salle,
       b.name                                        AS batiment,
       COALESCE(o.reservations, 0)                   AS reservations,
       ROUND(COALESCE(o.minutes_reservees, 0) / 60, 1) AS heures,
       ROUND(
           COALESCE(o.minutes_reservees / NULLIF(o.minutes_ouverture, 0), 0), 4
       )                                             AS taux_occupation,
       ROUND(
           1 - COALESCE(p.honorees::numeric / NULLIF(p.passees, 0), 1), 4
       )                                             AS taux_no_show
  FROM rooms r
  JOIN floors f ON f.id = r.floor_id
  JOIN buildings b ON b.id = f.building_id
  LEFT JOIN occupation o ON o.room_id = r.id
  LEFT JOIN presence p ON p.room_id = r.id
 WHERE r.deleted_at IS NULL
   AND (CAST(:batiment AS uuid) IS NULL OR f.building_id = CAST(:batiment AS uuid))
 ORDER BY reservations DESC, r.name;


-- -----------------------------------------------------------------------------
-- 5. Alertes du tableau de bord, dérivées de l'état réel du parc
--
-- Aucune n'est écrite en dur : une salle en maintenance, une salle sous-utilisée
-- sur trente jours, une file d'arbitrage non vide.
-- -----------------------------------------------------------------------------
SELECT 'maintenance' AS kind,
       r.id AS target_id,
       r.name || ' en maintenance' AS message
  FROM rooms r
 WHERE r.deleted_at IS NULL AND r.status = 'maintenance'
UNION ALL
SELECT 'sous_utilisation',
       r.id,
       r.name || ' sous-utilisée : '
         || ROUND(COALESCE(AVG(d.occupancy_rate), 0) * 100)::text || ' % en moyenne'
  FROM rooms r
  LEFT JOIN v_room_occupancy_daily d
         ON d.room_id = r.id AND d.occupancy_date >= CURRENT_DATE - 30
 WHERE r.deleted_at IS NULL AND r.status = 'disponible'
 GROUP BY r.id, r.name
HAVING COALESCE(AVG(d.occupancy_rate), 0) < 0.30
UNION ALL
SELECT 'arbitrage',
       NULL::uuid,
       count(*)::text || ' demande(s) en attente d''arbitrage'
  FROM access_requests
 WHERE status = 'ouvert'
HAVING count(*) > 0;


-- -----------------------------------------------------------------------------
-- 6. Rafraîchissement de la vue matérialisée
--
-- CONCURRENTLY : les lectures du tableau de bord ne sont pas bloquées pendant le
-- recalcul. Planifié toutes les heures côté application, ou par pg_cron :
--   SELECT cron.schedule('occupation', '0 * * * *', 'SELECT refresh_room_occupancy()');
-- -----------------------------------------------------------------------------
SELECT refresh_room_occupancy();
