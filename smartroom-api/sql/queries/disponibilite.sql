-- =============================================================================
-- SmartRoom Manager — requêtes de référence : disponibilité et conflits
--
-- Ces requêtes sont celles que la phase 3 portera dans le service métier. Elles
-- sont écrites en SQL pur pour être exécutables et mesurables telles quelles :
--     psql -f sql/queries/disponibilite.sql
--
-- Paramètres nommés, à substituer par l'API :
--   :creneau          TSTZRANGE du créneau demandé
--   :effectif         nombre de participants annoncé
--   :batiment         UUID du bâtiment souhaité, ou NULL
--   :equipements      UUID[] des équipements exigés, ou '{}'
--   :salle            UUID de la salle visée
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Salles disponibles sur un créneau, avec filtres de capacité et d'équipement
--
-- Chemin d'accès attendu :
--   - idx_rooms_search (status, capacity, floor_id) WHERE deleted_at IS NULL
--   - ex_bookings_no_overlap, dont l'index GiST (room_id, time_range) filtré sur
--     les réservations actives sert le NOT EXISTS
--   - idx_room_equipments_equipment (equipment_id, room_id) pour le filtre matériel
--
-- Le battement est appliqué en élargissant le créneau testé : une salle occupée
-- jusqu'à 13:55 n'est pas libre pour 14:00 si la règle exige quinze minutes.
-- -----------------------------------------------------------------------------
WITH regle AS (
    -- Résolution salle → bâtiment → global : la première ligne trouvée gagne.
    SELECT DISTINCT ON (r.id)
           r.id AS room_id,
           br.buffer_min,
           br.min_duration_min,
           br.max_duration_min,
           br.max_advance_days
      FROM rooms r
      JOIN floors f ON f.id = r.floor_id
      LEFT JOIN booking_rules br
             ON (br.scope = 'salle'    AND br.room_id = r.id)
             OR (br.scope = 'batiment' AND br.building_id = f.building_id)
             OR (br.scope = 'global')
     WHERE r.deleted_at IS NULL
     ORDER BY r.id,
              CASE br.scope WHEN 'salle' THEN 1 WHEN 'batiment' THEN 2 ELSE 3 END
)
SELECT r.id,
       r.name,
       r.capacity,
       r.area_m2,
       b.name AS building_name,
       f.label AS floor_label,
       rg.buffer_min
  FROM rooms r
  JOIN floors f ON f.id = r.floor_id
  JOIN buildings b ON b.id = f.building_id
  JOIN regle rg ON rg.room_id = r.id
 WHERE r.deleted_at IS NULL
   AND r.status = 'disponible'
   AND r.capacity >= :effectif
   AND (CAST(:batiment AS uuid) IS NULL OR f.building_id = CAST(:batiment AS uuid))

   -- Tous les équipements exigés sont présents, aucun ne manque.
   AND (
        cardinality(CAST(:equipements AS uuid[])) = 0
        OR NOT EXISTS (
            SELECT 1
              FROM unnest(CAST(:equipements AS uuid[])) AS exige(equipment_id)
             WHERE NOT EXISTS (
                   SELECT 1 FROM room_equipments re
                    WHERE re.room_id = r.id AND re.equipment_id = exige.equipment_id
             )
        )
   )

   -- Aucune réservation active ne recouvre le créneau élargi du battement.
   AND NOT EXISTS (
        SELECT 1
          FROM bookings bk
         WHERE bk.room_id = r.id
           AND bk.status <> 'annulee'
           AND bk.deleted_at IS NULL
           AND bk.time_range && tstzrange(
                   lower(CAST(:creneau AS tstzrange)) - make_interval(mins => rg.buffer_min),
                   upper(CAST(:creneau AS tstzrange)) + make_interval(mins => rg.buffer_min),
                   '[)'
               )
   )

   -- La salle est ouverte ce jour-là, sur toute l'amplitude demandée.
   AND resolve_opening_minutes(
           r.id, f.building_id,
           EXTRACT(DOW FROM lower(CAST(:creneau AS tstzrange)) AT TIME ZONE smartroom_timezone())::SMALLINT
       ) > 0

   -- Aucune fermeture exceptionnelle ne couvre la date.
   AND NOT EXISTS (
        SELECT 1
          FROM closure_periods cp
          LEFT JOIN closure_buildings cb ON cb.closure_id = cp.id
          LEFT JOIN closure_rooms cr ON cr.closure_id = cp.id
         WHERE cp.kind = 'fermeture'
           AND cp.date_span @> (lower(CAST(:creneau AS tstzrange)) AT TIME ZONE smartroom_timezone())::date
           AND (cp.is_global OR cb.building_id = f.building_id OR cr.room_id = r.id)
   )
 ORDER BY r.capacity, r.name;


-- -----------------------------------------------------------------------------
-- 2. Conflits d'une salle sur un créneau, qualifiés
--
-- Distingue le recouvrement total, le recouvrement partiel et le simple
-- battement insuffisant. Le dernier cas échappe à la contrainte EXCLUDE : les
-- créneaux ne se touchent pas, seule la règle métier les oppose.
-- -----------------------------------------------------------------------------
SELECT bk.id AS booking_id,
       bk.title,
       lower(bk.time_range) AS starts_at,
       upper(bk.time_range) AS ends_at,
       CASE
           WHEN bk.time_range @> CAST(:creneau AS tstzrange) THEN 'total'
           WHEN bk.time_range && CAST(:creneau AS tstzrange)  THEN 'partiel'
           ELSE 'adjacent'
       END AS kind,
       GREATEST(
           0,
           EXTRACT(EPOCH FROM (
               LEAST(upper(bk.time_range), upper(CAST(:creneau AS tstzrange)))
               - GREATEST(lower(bk.time_range), lower(CAST(:creneau AS tstzrange)))
           )) / 60
       )::int AS overlap_minutes,
       CASE
           WHEN bk.time_range && CAST(:creneau AS tstzrange) THEN 0
           WHEN upper(bk.time_range) <= lower(CAST(:creneau AS tstzrange))
                THEN (EXTRACT(EPOCH FROM (lower(CAST(:creneau AS tstzrange)) - upper(bk.time_range))) / 60)::int
           ELSE (EXTRACT(EPOCH FROM (lower(bk.time_range) - upper(CAST(:creneau AS tstzrange)))) / 60)::int
       END AS gap_minutes,
       -- Un recouvrement est bloquant sans appel ; un battement court se force
       -- avec « ignorer les règles ».
       bk.time_range && CAST(:creneau AS tstzrange) AS blocking
  FROM bookings bk
 WHERE bk.room_id = CAST(:salle AS uuid)
   AND bk.status <> 'annulee'
   AND bk.deleted_at IS NULL
   AND bk.time_range && tstzrange(
           lower(CAST(:creneau AS tstzrange)) - INTERVAL '30 minutes',
           upper(CAST(:creneau AS tstzrange)) + INTERVAL '30 minutes',
           '[)'
       )
 ORDER BY lower(bk.time_range);


-- -----------------------------------------------------------------------------
-- 3. Recommandation : score sur 100 des salles libres
--
-- Quatre critères pondérés, identiques à ceux du front :
--   capacité 35 — l'ajustement compte, le surdimensionnement est pénalisé
--   équipements 30 — proportion des équipements demandés réellement présents
--   bâtiment 15 — bâtiment de préférence de l'utilisateur
--   occupation 20 — plus la salle est libre sur la période, mieux elle est notée
--
-- Formule identique à app/services/recommendation.py, qui fait foi : les deux
-- doivent noter une même salle pareil, sans quoi la démonstration SQL dirait
-- autre chose que l'application.
-- -----------------------------------------------------------------------------
WITH candidates AS (
    SELECT r.id, r.name, r.capacity, f.building_id
      FROM rooms r
      JOIN floors f ON f.id = r.floor_id
     WHERE r.deleted_at IS NULL
       AND r.status = 'disponible'
       AND r.capacity >= :effectif
       AND NOT EXISTS (
            SELECT 1 FROM bookings bk
             WHERE bk.room_id = r.id
               AND bk.status <> 'annulee'
               AND bk.deleted_at IS NULL
               AND bk.time_range && CAST(:creneau AS tstzrange)
       )
),
occupation AS (
    SELECT c.id,
           COALESCE(AVG(d.occupancy_rate), 0) AS taux_moyen
      FROM candidates c
      LEFT JOIN v_room_occupancy_daily d
             ON d.room_id = c.id
            AND d.occupancy_date >= CURRENT_DATE - 30
     GROUP BY c.id
)
SELECT c.id,
       c.name,
       c.capacity,
       ROUND(
           -- Capacité : 35 points si l'effectif remplit la salle, décroissant
           -- avec le surdimensionnement. Le facteur 1,15 tolère un léger écart :
           -- douze places pour dix personnes reste un bon ajustement.
           35 * LEAST(1, (:effectif::numeric / GREATEST(c.capacity, 1)) * 1.15)
           -- Équipements : proportion réellement présente.
         + 30 * CASE
                    WHEN cardinality(CAST(:equipements AS uuid[])) = 0 THEN 1
                    ELSE (
                        SELECT count(*)::numeric / cardinality(CAST(:equipements AS uuid[]))
                          FROM room_equipments re
                         WHERE re.room_id = c.id
                           AND re.equipment_id = ANY(CAST(:equipements AS uuid[]))
                    )
                END
           -- Bâtiment de préférence.
         + 15 * CASE WHEN c.building_id = CAST(:batiment AS uuid) THEN 1 ELSE 0 END
           -- Occupation : une salle peu sollicitée est mieux notée.
         + 20 * (1 - o.taux_moyen)
       )::int AS score,
       ROUND(o.taux_moyen * 100)::int AS occupancy_percent
  FROM candidates c
  JOIN occupation o ON o.id = c.id
 ORDER BY score DESC, c.capacity
 LIMIT 5;
