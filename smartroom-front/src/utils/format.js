/** Formatages métier partagés par les écrans. */

export const fmtPercent = (ratio, digits = 0) =>
  `${(Number(ratio) * 100).toFixed(digits).replace('.', ',')} %`;

export const fmtCapacity = (n) => `${n} pers.`;

export const fmtArea = (n) => `${n} m²`;

/** 'A-4821' -> 'A-****' pour le dashboard. */
export const maskAccessCode = (code) => {
  if (!code) return '—';
  const [prefix, digits = ''] = code.split('-');
  return `${prefix}-${'*'.repeat(digits.length)}`;
};

export const initials = (firstName = '', lastName = '') =>
  `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

export const fullName = (user) => (user ? `${user.firstName} ${user.lastName}` : 'Utilisateur');

/** Libellés affichables des statuts de réservation. */
export const BOOKING_STATUS_LABEL = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  terminee: 'Terminée',
  annulee: 'Annulée',
};

export const ROOM_STATUS_LABEL = {
  disponible: 'Disponible',
  occupee: 'Occupée',
  maintenance: 'Maintenance',
};

export const TICKET_STATUS_LABEL = {
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  resolu: 'Résolu',
};

export const PARTICIPANT_STATUS_LABEL = {
  accepte: 'Accepté',
  en_attente: 'En attente',
  decline: 'Décliné',
};

/** '1 salle' / '4 salles' */
export const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${count} ${count > 1 ? pluralForm : singular}`;

/** Normalise pour la recherche : minuscules, sans accents. */
export const normalize = (value = '') =>
  String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
