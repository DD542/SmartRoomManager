/**
 * Catalogue des salles. Les visuels sont des SVG encodés en data URI :
 * aucun appel réseau, aucune dépendance, rendu identique hors ligne.
 * Le back FastAPI renverra de vraies URLs sur le même champ `photos`.
 */

const TONES = {
  'r-vinci': ['#1B2436', '#2A3A57'],
  'r-eiffel': ['#1A2430', '#26384A'],
  'r-curie': ['#1D2130', '#333A57'],
  'r-pascal': ['#20222C', '#33384A'],
  'r-ampere': ['#22212A', '#3A3542'],
  'r-turing': ['#1A2632', '#28414F'],
  'r-lovelace': ['#241F2C', '#3C3348'],
  'r-alpha': ['#1B2732', '#2C4152'],
};

function photo(roomId, name, index) {
  const [from, to] = TONES[roomId] ?? ['#1A2231', '#2C3850'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient></defs>
    <rect width="640" height="400" fill="url(#g)"/>
    <rect x="120" y="150" width="400" height="110" rx="10" fill="none" stroke="#5B9BFF" stroke-opacity="0.35" stroke-width="3"/>
    <rect x="230" y="80" width="180" height="46" rx="6" fill="#101623" stroke="#5B9BFF" stroke-opacity="0.3"/>
    <text x="320" y="330" fill="#B4C0D4" font-family="monospace" font-size="22" text-anchor="middle">${name} · vue ${index}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const photosOf = (id, name, count = 4) =>
  Array.from({ length: count }, (_, i) => photo(id, name, i + 1));

const WORK_WEEK = [1, 2, 3, 4, 5];

const baseRules = {
  visitDays: WORK_WEEK,
  openTime: '08:00',
  closeTime: '20:00',
  minDurationMin: 30,
  maxDurationMin: 240,
  bufferMin: 15,
  constraints: [
    'Nourriture interdite, seules les boissons fermées sont autorisées.',
    'Prière d’éteindre les équipements après usage.',
  ],
};

export const rooms = [
  {
    id: 'r-vinci',
    name: 'Salle Vinci',
    buildingId: 'b-a',
    floor: '2e',
    capacity: 12,
    area: 28,
    equipmentIds: ['eq-visio', 'eq-screen4k', 'eq-whiteboard', 'eq-sockets'],
    accessible: false,
    badgeRequired: true,
    status: 'disponible',
    description:
      'Espace de réunion premium orienté ouest, idéal pour les conseils et les sessions de brainstorming prolongées. Excellente isolation phonique et vue dégagée sur le campus.',
    photos: photosOf('r-vinci', 'Salle Vinci', 5),
    occupancyRate: 0.72,
    rules: { ...baseRules, constraints: ['Capacité maximale stricte de 12 personnes.', ...baseRules.constraints] },
    plan: { x: 56, y: 8, w: 36, h: 30 },
  },
  {
    id: 'r-eiffel',
    name: 'Salle Eiffel',
    buildingId: 'b-a',
    floor: 'RDC',
    capacity: 8,
    area: 22,
    equipmentIds: ['eq-visio', 'eq-whiteboard'],
    accessible: false,
    badgeRequired: false,
    status: 'occupee',
    description:
      'Salle de travail compacte au rez-de-chaussée, adaptée aux points d’équipe courts et aux entretiens à distance.',
    photos: photosOf('r-eiffel', 'Salle Eiffel'),
    occupancyRate: 0.45,
    rules: baseRules,
    plan: { x: 8, y: 8, w: 36, h: 30 },
  },
  {
    id: 'r-curie',
    name: 'Salle Curie',
    buildingId: 'b-b',
    floor: '3e',
    capacity: 20,
    area: 46,
    equipmentIds: ['eq-visio', 'eq-projector', 'eq-mic', 'eq-ac'],
    accessible: true,
    badgeRequired: false,
    status: 'disponible',
    description:
      'Grande salle équipée pour les ateliers et les cours, avec sonorisation et vidéoprojecteur récent.',
    photos: photosOf('r-curie', 'Salle Curie'),
    occupancyRate: 0.61,
    rules: { ...baseRules, maxDurationMin: 300 },
    plan: { x: 56, y: 8, w: 36, h: 30 },
  },
  {
    id: 'r-pascal',
    name: 'Salle Pascal',
    buildingId: 'b-c',
    floor: 'RDC',
    capacity: 6,
    area: 16,
    equipmentIds: ['eq-screen4k'],
    accessible: false,
    badgeRequired: false,
    status: 'disponible',
    description: 'Petite salle de l’annexe, parfaite pour un binôme ou une revue de code.',
    photos: photosOf('r-pascal', 'Salle Pascal', 3),
    occupancyRate: 0.28,
    rules: { ...baseRules, visitDays: [1, 2, 4], closeTime: '18:00' },
    plan: { x: 30, y: 26, w: 40, h: 34 },
  },
  {
    id: 'r-ampere',
    name: 'Salle Ampère',
    buildingId: 'b-b',
    floor: '1er',
    capacity: 30,
    area: 64,
    equipmentIds: ['eq-projector', 'eq-mic'],
    accessible: true,
    badgeRequired: false,
    status: 'maintenance',
    description:
      'Amphithéâtre secondaire. Climatisation en cours de remplacement, indisponible à la réservation.',
    photos: photosOf('r-ampere', 'Salle Ampère', 3),
    occupancyRate: 0.12,
    rules: baseRules,
    plan: { x: 8, y: 8, w: 36, h: 30 },
  },
  {
    id: 'r-turing',
    name: 'Salle Turing',
    buildingId: 'b-a',
    floor: '1er',
    capacity: 8,
    area: 20,
    equipmentIds: ['eq-visio', 'eq-whiteboard', 'eq-ac'],
    accessible: true,
    badgeRequired: false,
    status: 'disponible',
    description: 'Salle lumineuse en angle, très demandée pour les ateliers de conception.',
    photos: photosOf('r-turing', 'Salle Turing'),
    occupancyRate: 0.38,
    rules: baseRules,
    plan: { x: 56, y: 56, w: 36, h: 30 },
  },
  {
    id: 'r-lovelace',
    name: 'Salle Lovelace',
    buildingId: 'b-a',
    floor: '1er',
    capacity: 8,
    area: 21,
    equipmentIds: ['eq-screen4k'],
    accessible: false,
    badgeRequired: false,
    status: 'occupee',
    description: 'Salle de projet ouverte sur la mezzanine, mobilier modulable.',
    photos: photosOf('r-lovelace', 'Salle Lovelace', 3),
    occupancyRate: 0.36,
    rules: { ...baseRules, visitDays: [2, 3, 5] },
    plan: { x: 8, y: 56, w: 36, h: 30 },
  },
  {
    id: 'r-alpha',
    name: 'Salle Conseil Alpha',
    buildingId: 'b-b',
    floor: '2e',
    capacity: 12,
    area: 30,
    equipmentIds: ['eq-visio', 'eq-screen4k', 'eq-whiteboard', 'eq-ac'],
    accessible: false,
    badgeRequired: true,
    status: 'disponible',
    description:
      'Salle de conseil réservée aux comités hebdomadaires. Accès par badge, jour de visite unique.',
    photos: photosOf('r-alpha', 'Conseil Alpha', 3),
    occupancyRate: 0.54,
    rules: { ...baseRules, visitDays: [4] },
    plan: { x: 8, y: 56, w: 36, h: 30 },
  },
];

export const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]));
