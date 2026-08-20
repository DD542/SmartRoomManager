/** Fil de notifications (U-20) et pastille de la topbar. */
export const notifications = [
  {
    id: 'n-01',
    category: 'rappel',
    title: 'Rappel : Salle Vinci dans 30 minutes',
    body: "N'oubliez pas votre réunion « Revue de sprint ».",
    at: '2026-03-26T11:40:00',
    read: false,
    action: { label: 'Voir la réservation', to: '/app/reservations/bk-1001' },
  },
  {
    id: 'n-02',
    category: 'reservation',
    title: 'Réservation confirmée — Salle Curie',
    body: 'Votre réservation pour demain à 09:00 est validée.',
    at: '2026-03-26T09:45:00',
    read: false,
    action: { label: 'Voir la réservation', to: '/app/reservations/bk-1002' },
  },
  {
    id: 'n-03',
    category: 'aide',
    title: 'Le support a répondu à votre ticket #148',
    body: 'Une solution a été apportée à votre demande d’accès.',
    at: '2026-03-25T15:10:00',
    read: true,
    action: { label: 'Ouvrir le ticket', to: '/app/aide?ticket=148' },
  },
  {
    id: 'n-04',
    category: 'conflit',
    title: 'Conflit résolu : votre créneau a été maintenu',
    body: 'Le conflit avec la salle Ampère a été réglé par l’administration.',
    at: '2026-03-25T11:02:00',
    read: true,
    action: null,
  },
];

export const notificationTabs = [
  { id: 'toutes', label: 'Toutes' },
  { id: 'reservation', label: 'Réservations' },
  { id: 'rappel', label: 'Rappels' },
  { id: 'aide', label: 'Aide' },
];
