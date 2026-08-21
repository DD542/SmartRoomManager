/**
 * Journal d'audit (A-16). Cinq entrées détaillées, complétées par des entrées
 * générées pour donner au tableau sa pagination réelle : 128 lignes.
 */

const metadonnees = (browser, os, location) => ({
  browser,
  os,
  location,
  sessionId: `sess_${Math.random().toString(16).slice(2, 12)}`,
});

export const auditEntries = [
  {
    id: '4028',
    at: '2026-03-26T09:12:45',
    authorId: 'adm-01',
    authorName: 'D. Menga',
    action: 'modification',
    target: 'Règles de réservation',
    targetId: 'rules-global',
    ip: '192.168.1.42',
    diff: {
      before: { 'Durée max': '3 h', 'Quota hebdo': '10 h' },
      after: { 'Durée max': '4 h', 'Quota hebdo': '12 h' },
    },
    metadata: {
      browser: 'Chrome 122.0.0.0',
      os: 'macOS 14.3',
      location: 'Paris, FR',
      sessionId: 'sess_8f92a3b1c4',
    },
  },
  {
    id: '4027',
    at: '2026-03-26T08:47:10',
    authorId: 'adm-02',
    authorName: 'A. Boukehila',
    action: 'maintenance',
    target: 'Salle Ampère',
    targetId: 'r-ampere',
    ip: '192.168.1.15',
    diff: {
      before: { Statut: 'Active' },
      after: { Statut: 'Maintenance', Motif: 'Remplacement de la climatisation' },
    },
    metadata: metadonnees('Firefox 124.0', 'Windows 11', 'Paris, FR'),
  },
  {
    id: '4026',
    at: '2026-03-25T17:30:00',
    authorId: 'adm-01',
    authorName: 'D. Menga',
    action: 'permission',
    target: 'C. Nkoulou',
    targetId: 'adm-03',
    ip: '192.168.1.42',
    diff: {
      before: { Permissions: 'support.handle' },
      after: { Permissions: 'support.handle, conflicts.arbitrate' },
    },
    metadata: metadonnees('Chrome 122.0.0.0', 'macOS 14.3', 'Paris, FR'),
  },
  {
    id: '4025',
    at: '2026-03-25T16:02:00',
    authorId: 'adm-03',
    authorName: 'C. Nkoulou',
    action: 'suppression',
    target: 'Article FAQ',
    targetId: 'ha-99',
    ip: '10.0.0.5',
    diff: {
      before: { Titre: 'Ancienne procédure de badge', Statut: 'Brouillon' },
      after: {},
    },
    metadata: metadonnees('Safari 17.4', 'macOS 14.4', 'Lyon, FR'),
  },
  {
    id: '4024',
    at: '2026-03-25T14:20:00',
    authorId: null,
    authorName: '(Système)',
    action: 'connexion',
    target: 'Login admin',
    targetId: 'adm-01',
    ip: '81.194.12.8',
    diff: null,
    metadata: metadonnees('Chrome 122.0.0.0', 'macOS 14.3', 'Paris, FR'),
  },
];

const ACTIONS = ['modification', 'maintenance', 'permission', 'suppression', 'connexion'];
const AUTEURS = [
  { id: 'adm-01', name: 'D. Menga', ip: '192.168.1.42' },
  { id: 'adm-02', name: 'A. Boukehila', ip: '192.168.1.15' },
  { id: 'adm-03', name: 'C. Nkoulou', ip: '10.0.0.5' },
];
const CIBLES = ['Salle Vinci', 'Salle Curie', 'Modèle de confirmation', 'Compte utilisateur', 'Fermeture exceptionnelle'];

/** Historique plus ancien, sans diff : il alimente la pagination du tableau. */
export const auditHistory = Array.from({ length: 123 }, (_, index) => {
  const auteur = AUTEURS[index % AUTEURS.length];
  const jour = 24 - Math.floor(index / 6);
  const heure = 8 + (index % 9);
  return {
    id: String(4023 - index),
    at: `2026-03-${String(Math.max(1, jour)).padStart(2, '0')}T${String(heure).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}:00`,
    authorId: auteur.id,
    authorName: auteur.name,
    action: ACTIONS[index % ACTIONS.length],
    target: CIBLES[index % CIBLES.length],
    targetId: `obj-${index}`,
    ip: auteur.ip,
    diff: null,
    metadata: metadonnees('Chrome 122.0.0.0', 'Windows 11', 'Paris, FR'),
  };
});
