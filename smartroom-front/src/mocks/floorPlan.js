/**
 * Plans de localisation.
 *
 * Deux niveaux d'information cohabitent :
 *   - le schéma interactif (couloirs, entrée, rectangles de salles), qui reste
 *     cliquable et navigable au clavier ;
 *   - le document déposé par l'administration (image ou PDF), qui fait foi.
 *     Quand c'est une image, elle sert de fond au schéma ; quand c'est un PDF,
 *     il est affiché tel quel et les salles se choisissent dans une liste.
 */

function blueprint(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400">
    <rect width="640" height="400" fill="#0C1421"/>
    <g stroke="#2A4C7A" stroke-width="1">
      ${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="400"/>`).join('')}
      ${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="${i * 40}" x2="640" y2="${i * 40}"/>`).join('')}
    </g>
    <g fill="none" stroke="#5B9BFF" stroke-width="2">
      <rect x="50" y="40" width="230" height="130"/>
      <rect x="360" y="40" width="230" height="130"/>
      <rect x="50" y="230" width="230" height="130"/>
      <rect x="360" y="230" width="230" height="130"/>
      <path d="M0 200 H640"/>
      <path d="M320 0 V400" stroke-dasharray="6 6" stroke-opacity="0.5"/>
    </g>
    <text x="24" y="386" fill="#5B9BFF" font-family="monospace" font-size="15" opacity="0.85">PLAN OFFICIEL — ${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Documents déposés par l'administration, indexés par identifiant de plan. */
export const planDocuments = {
  'plan-a': {
    id: 'doc-plan-a',
    type: 'image',
    name: 'plan-batiment-a.svg',
    url: blueprint('BÂTIMENT A'),
    sizeKo: 48,
    updatedAt: '2026-02-10T09:00:00',
    uploadedBy: 'Direction de site',
  },
  'plan-b': {
    id: 'doc-plan-b',
    type: 'image',
    name: 'plan-batiment-b.svg',
    url: blueprint('BÂTIMENT B'),
    sizeKo: 51,
    updatedAt: '2026-01-22T15:30:00',
    uploadedBy: 'Direction de site',
  },
  // Bâtiment C : aucun plan déposé, l'écran affiche sa zone d'import.
};

export const floorPlans = [
  {
    id: 'plan-a',
    buildingId: 'b-a',
    label: 'Bâtiment A',
    sublabel: 'Campus Eiffel — RDC, 1er et 2e étage',
    corridors: [
      { x: 0, y: 42, w: 100, h: 12 },
      { x: 46, y: 0, w: 8, h: 100 },
    ],
    entrance: { x: 44, y: 92, w: 12, h: 6, label: 'Entrée principale' },
    landmarks: [{ x: 47, y: 46, icon: 'DoorOpen', label: 'Ascenseur B' }],
    roomIds: ['r-eiffel', 'r-vinci', 'r-lovelace', 'r-turing'],
  },
  {
    id: 'plan-b',
    buildingId: 'b-b',
    label: 'Bâtiment B',
    sublabel: 'Campus Newton — 1er, 2e et 3e étage',
    corridors: [
      { x: 0, y: 42, w: 100, h: 12 },
      { x: 46, y: 0, w: 8, h: 100 },
    ],
    entrance: { x: 2, y: 44, w: 8, h: 8, label: 'Accueil Newton' },
    landmarks: [{ x: 50, y: 46, icon: 'DoorOpen', label: 'Escalier central' }],
    roomIds: ['r-ampere', 'r-curie', 'r-alpha'],
  },
  {
    id: 'plan-c',
    buildingId: 'b-c',
    label: 'Bâtiment C',
    sublabel: 'Annexe — RDC',
    corridors: [{ x: 44, y: 0, w: 12, h: 22 }],
    entrance: { x: 44, y: 4, w: 12, h: 6, label: 'Entrée annexe' },
    landmarks: [],
    roomIds: ['r-pascal'],
  },
];

export const planLegend = [
  { key: 'libre', label: 'Libre', tone: 'success' },
  { key: 'occupee', label: 'Occupée', tone: 'muted' },
  { key: 'mienne', label: 'Votre salle', tone: 'accent' },
];
