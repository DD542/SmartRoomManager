/**
 * Calendriers d'ouverture et fermetures exceptionnelles (A-09), et règles de
 * réservation (A-10). Les valeurs par défaut sont celles déjà appliquées par
 * utils/openingRules.js et api/checkin.js : l'administration les pilote.
 */

export const openingSchedule = {
  scope: 'global',
  days: [
    { day: 1, label: 'Lundi', openTime: '08:00', closeTime: '20:00', open: true },
    { day: 2, label: 'Mardi', openTime: '08:00', closeTime: '20:00', open: true },
    { day: 3, label: 'Mercredi', openTime: '08:00', closeTime: '20:00', open: true },
    { day: 4, label: 'Jeudi', openTime: '08:00', closeTime: '20:00', open: true },
    { day: 5, label: 'Vendredi', openTime: '08:00', closeTime: '20:00', open: true },
    { day: 6, label: 'Samedi', openTime: '09:00', closeTime: '13:00', open: true },
    { day: 0, label: 'Dimanche', openTime: '00:00', closeTime: '00:00', open: false },
  ],
};

export const closures = [
  {
    id: 'clo-01',
    label: 'Vacances de printemps',
    from: '2026-04-22',
    to: '2026-04-30',
    scopeType: 'global',
    scopeIds: [],
    kind: 'ferme',
  },
  {
    id: 'clo-02',
    label: 'Jour férié 1er mai',
    from: '2026-05-01',
    to: '2026-05-01',
    scopeType: 'global',
    scopeIds: [],
    kind: 'ferme',
  },
  {
    id: 'clo-03',
    label: 'Maintenance Bâtiment C',
    from: '2026-05-15',
    to: '2026-05-15',
    scopeType: 'batiment',
    scopeIds: ['b-c'],
    kind: 'exception',
  },
  {
    id: 'clo-04',
    label: 'Journée portes ouvertes',
    from: '2026-06-10',
    to: '2026-06-10',
    scopeType: 'salles',
    scopeIds: ['r-curie', 'r-alpha'],
    kind: 'exception',
  },
];

export const bookingRules = {
  scope: 'global',
  minDurationMin: 30,
  maxDurationMin: 240,
  maxConcurrentSlots: 10,
  weeklyQuotaHours: 12,
  checkInWindowMin: 10,
  bufferMin: 15,
};
