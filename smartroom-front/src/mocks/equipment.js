/** Référentiel des équipements. `icon` désigne un composant lucide-react. */
export const equipment = [
  { id: 'eq-visio', label: 'Visio-conférence', icon: 'Video', category: 'av' },
  { id: 'eq-screen4k', label: 'Écran 4K', icon: 'Monitor', category: 'av' },
  { id: 'eq-whiteboard', label: 'Tableau blanc', icon: 'PenLine', category: 'mobilier' },
  { id: 'eq-projector', label: 'Vidéoprojecteur', icon: 'Projector', category: 'av' },
  { id: 'eq-mic', label: 'Micro', icon: 'Mic', category: 'av' },
  { id: 'eq-sockets', label: '6 prises', icon: 'Plug', category: 'confort' },
  { id: 'eq-ac', label: 'Climatisation', icon: 'Snowflake', category: 'confort' },
];

export const equipmentById = Object.fromEntries(equipment.map((e) => [e.id, e]));
