/** Formatages métier partagés par les écrans. */

export const fmtPercent = (ratio, digits = 0) =>
  `${(Number(ratio) * 100).toFixed(digits).replace('.', ',')} %`;

export const fmtCapacity = (n) => `${n} pers.`;

// `undefined m²` s'affichait tel quel sous chaque salle du tunnel de
// réservation : le formateur rendait la chaîne sans regarder ce qu'il
// formatait.
export const fmtArea = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : `${n} m²`);

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

/**
 * Libellés des rôles réellement portés par les données.
 *
 * Deux vocabulaires coexistent, et c'est voulu : l'annuaire d'administration
 * classe par droits (`is_admin` de l'API donne `admin` ou `utilisateur`), le
 * profil utilisateur classe par appartenance (`etudiant` ou `personnel`, déduit
 * de la promotion). Les clés `enseignant` et `gestionnaire` figuraient encore
 * ici sans qu'aucune source ne les produise : le filtre « Rôle » retombait donc
 * sur la clé technique et affichait « utilisateur » en minuscules.
 */
export const USER_ROLE_LABEL = {
  admin: 'Administrateur',
  utilisateur: 'Utilisateur',
  etudiant: 'Étudiant',
  personnel: 'Personnel',
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
