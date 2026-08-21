import { fmtPercent, normalize } from './format';

/**
 * Moteur de recommandation.
 *
 * Score sur 100, réparti en quatre critères pondérés :
 *   capacité 35  — l'ajustement compte, le surdimensionnement est pénalisé ;
 *   équipements 30 — proportion des équipements demandés réellement présents ;
 *   bâtiment 15  — bâtiment de préférence de l'utilisateur ;
 *   occupation 20 — plus la salle est libre sur la semaine, mieux elle est notée.
 *
 * La justification affichée à l'utilisateur est CONSTRUITE à partir du détail
 * du score : elle change avec les données, aucun texte figé.
 */

export const WEIGHTS = { capacity: 35, equipment: 30, building: 15, occupancy: 20 };

/**
 * Ajustement de capacité : 1 quand la salle colle au besoin, décroît quand elle
 * est trop grande. 12 places pour 8 personnes -> 0,67 ; 30 places -> 0,27.
 */
function capacityFit(need, capacity) {
  if (!need) return 0.8;
  if (capacity < need) return 0;
  const ratio = need / capacity;
  return Math.min(1, ratio * 1.15); // tolère un léger surdimensionnement
}

function equipmentFit(required = [], available = []) {
  if (required.length === 0) return 1;
  const matched = required.filter((id) => available.includes(id));
  return matched.length / required.length;
}

/**
 * @param {Object} room
 * @param {{attendees:number, equipmentIds:string[], buildingId?:string, accessible?:boolean}} need
 * @returns {{room:Object, score:number, breakdown:Array, justification:string, eligible:boolean}}
 */
export function scoreRoom(room, need = {}) {
  const required = need.equipmentIds ?? [];
  const capacity = capacityFit(need.attendees, room.capacity);
  const equipment = equipmentFit(required, room.equipmentIds);
  const building = need.buildingId && room.buildingId === need.buildingId ? 1 : 0;
  const occupancy = 1 - (room.occupancyRate ?? 0);

  const breakdown = [
    {
      key: 'capacity',
      label: 'Capacité',
      points: Math.round(capacity * WEIGHTS.capacity),
      max: WEIGHTS.capacity,
      detail: `${room.capacity} places pour ${need.attendees ?? '—'} personnes`,
    },
    {
      key: 'equipment',
      label: 'Équipements',
      points: Math.round(equipment * WEIGHTS.equipment),
      max: WEIGHTS.equipment,
      detail:
        required.length === 0
          ? 'aucun équipement imposé'
          : `${required.filter((id) => room.equipmentIds.includes(id)).length}/${required.length} demandés présents`,
    },
    {
      key: 'building',
      label: 'Bâtiment',
      points: Math.round(building * WEIGHTS.building),
      max: WEIGHTS.building,
      detail: building ? 'bâtiment de préférence' : 'autre bâtiment',
    },
    {
      key: 'occupancy',
      label: 'Disponibilité',
      points: Math.round(occupancy * WEIGHTS.occupancy),
      max: WEIGHTS.occupancy,
      detail: `occupée à ${fmtPercent(room.occupancyRate ?? 0)}`,
    },
  ];

  const score = breakdown.reduce((sum, item) => sum + item.points, 0);
  const eligible =
    room.capacity >= (need.attendees ?? 0) &&
    room.status !== 'maintenance' &&
    equipment === 1 &&
    (!need.accessible || room.accessible);

  return { room, score, breakdown, eligible, justification: buildJustification(breakdown, need) };
}

/** Assemble une phrase à partir des deux critères les mieux notés. */
function buildJustification(breakdown, need) {
  const ranked = [...breakdown].sort((a, b) => b.points / b.max - a.points / a.max);
  const strong = ranked.filter((item) => item.points / item.max >= 0.6).slice(0, 2);
  const weak = ranked[ranked.length - 1];

  const phrases = strong.map((item) => {
    if (item.key === 'capacity') return `capacité ajustée (${item.detail})`;
    if (item.key === 'equipment')
      return need.equipmentIds?.length ? 'tous les équipements demandés' : 'sans contrainte matérielle';
    if (item.key === 'building') return 'dans votre bâtiment habituel';
    return `peu sollicitée (${item.detail})`;
  });

  if (phrases.length === 0) return `Compromis : ${weak.label.toLowerCase()} ${weak.detail}.`;

  const base = phrases.join(', ');
  // « réserve : bâtiment, autre bâtiment » : quand le détail reprend déjà le
  // critère, le rappeler devant produit une répétition.
  const redondant = normalize(weak.detail).includes(normalize(weak.label));
  const reserve =
    weak.points / weak.max < 0.4
      ? ` — réserve : ${redondant ? weak.detail : `${weak.label.toLowerCase()}, ${weak.detail}`}.`
      : '.';
  return base.charAt(0).toUpperCase() + base.slice(1) + reserve;
}

/**
 * Classe les salles d'un besoin. Les salles inéligibles sont conservées mais
 * marquées, afin que l'écran U-03 puisse afficher « à capacité juste » plutôt
 * que de les faire disparaître sans explication.
 */
export function rankRooms(rooms = [], need = {}) {
  return rooms
    .map((room) => scoreRoom(room, need))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });
}

/** Meilleure salle éligible, ou null. Utilisée par le dashboard et le chatbot. */
export function bestRoom(rooms, need) {
  const ranked = rankRooms(rooms, need);
  return ranked.find((item) => item.eligible) ?? null;
}
