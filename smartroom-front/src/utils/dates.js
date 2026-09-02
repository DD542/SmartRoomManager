import {
  addDays,
  addMinutes,
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Horloge de référence des écrans.
 *
 * Elle était figée au 26 mars 2026 tant que les données venaient d'un jeu
 * simulé : les états relatifs — « dans 2 h 15 », « à venir » — devaient rester
 * stables d'une exécution à l'autre. Les réservations viennent désormais de la
 * base, avec de vraies dates ; une horloge arrêtée afficherait « dans 3 649 h »
 * pour une réunion de demain.
 */
export const NOW = new Date();

export const WEEK_DAYS = [
  { value: 1, short: 'L', label: 'Lundi' },
  { value: 2, short: 'M', label: 'Mardi' },
  { value: 3, short: 'M', label: 'Mercredi' },
  { value: 4, short: 'J', label: 'Jeudi' },
  { value: 5, short: 'V', label: 'Vendredi' },
  { value: 6, short: 'S', label: 'Samedi' },
  { value: 0, short: 'D', label: 'Dimanche' },
];

export const toDate = (value) => (value instanceof Date ? value : parseISO(String(value)));

export const isValidDate = (value) => {
  const date = toDate(value);
  return date instanceof Date && isValid(date);
};

/** Marque d'une date absente. Un tiret se lit ; une page blanche non. */
export const SANS_DATE = '—';

/**
 * Applique un format, sauf quand il n'y a rien à formater.
 *
 * Plusieurs colonnes sont nullables et le resteront : une dernière connexion
 * qui n'a jamais eu lieu, une résolution qui n'est pas venue. `toDate(null)`
 * rend une date invalide, dont `format` lève — et l'exception remontait
 * jusqu'à la frontière d'erreur, emportant l'écran entier. Un compte
 * d'administration jamais connecté suffisait à rendre la page des rôles
 * inaccessible.
 *
 * Une valeur *malformée* reste une erreur et lève : c'est un défaut, pas un
 * état. Seule l'absence est traitée comme ce qu'elle est.
 */
const formater = (value, rendu) =>
  value === null || value === undefined || value === '' ? SANS_DATE : rendu(toDate(value));

/** '14:00' */
export const fmtTime = (value) => formater(value, (date) => format(date, 'HH:mm'));

/** '26/03' */
export const fmtDayMonth = (value) => formater(value, (date) => format(date, 'dd/MM'));

/** '26/03/2026' */
export const fmtDate = (value) => formater(value, (date) => format(date, 'dd/MM/yyyy'));

/** 'jeudi 26 mars 2026' */
export const fmtDateLong = (value) =>
  formater(value, (date) => format(date, 'EEEE d MMMM yyyy', { locale: fr }));

/** 'Jeu. 26 Mars' */
export const fmtDateShort = (value) =>
  formater(value, (date) => {
    const raw = format(date, 'EEE d MMM', { locale: fr });
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  });

/** '2026-03-26' pour les <input type="date"> */
export const toDateInput = (value) => format(toDate(value), 'yyyy-MM-dd');

/** Assemble '2026-03-26' + '14:00' en Date locale. */
export const mergeDateAndTime = (dateInput, timeInput) => {
  const [h, m] = String(timeInput || '00:00').split(':').map(Number);
  const base = startOfDay(toDate(dateInput));
  return addMinutes(base, h * 60 + m);
};

/**
 * Fuseau de l'établissement.
 *
 * Les tranches d'ouverture — 08-10, 10-12, 14-16, 16-18 — sont celles du
 * campus, pas celles du poste qui affiche la page.
 */
export const FUSEAU_CAMPUS = 'Europe/Paris';

//: `en-GB` et `h23` plutôt que `fr-FR` : la locale française rend minuit
//: « 24 » dans certains moteurs, ce qui sortirait de toute tranche.
const LECTEUR_HEURE = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU_CAMPUS,
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * Heure d'un instant, lue dans le fuseau du campus.
 *
 * `Date.getHours()` rend l'heure du poste. Sur un navigateur réglé ailleurs
 * — ou dans une chaîne d'intégration, qui tourne en UTC — une réservation de
 * 9 h devient 7 h et ne tombe plus dans aucune tranche : la répartition
 * s'affiche vide sans que rien ne signale l'erreur.
 */
export const heureCampus = (value) => Number(LECTEUR_HEURE.format(toDate(value)));

export const durationMin = (start, end) => differenceInMinutes(toDate(end), toDate(start));

/** 90 -> '1 h 30' ; 60 -> '1 h' ; 45 -> '45 min' */
export const fmtDuration = (minutes) => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
};

/** Compte à rebours du dashboard : 'Dans 2 h 15', 'En cours', 'Terminée'. */
export const fmtCountdown = (start, end, now = NOW) => {
  const toStart = differenceInMinutes(toDate(start), now);
  if (toStart > 0) return `Dans ${fmtDuration(toStart)}`;
  const toEnd = differenceInMinutes(toDate(end), now);
  if (toEnd >= 0) return 'En cours';
  return 'Terminée';
};

/** Horodatage relatif des notifications : 'il y a 5 min', 'hier'. */
export const fmtRelative = (value, now = NOW) => {
  if (value === null || value === undefined || value === '') return SANS_DATE;
  const diff = differenceInMinutes(now, toDate(value));
  if (diff < 1) return "à l'instant";
  if (diff < 60) return `il y a ${diff} min`;
  if (diff < 60 * 24 && isSameDay(toDate(value), now)) return `il y a ${Math.floor(diff / 60)} h`;
  if (diff < 60 * 48) return 'hier';
  return fmtDate(value);
};

/** Regroupe une liste par jour : AUJOURD'HUI, HIER, puis date longue. */
export const dayBucket = (value, now = NOW) => {
  const date = toDate(value);
  if (isSameDay(date, now)) return "Aujourd'hui";
  if (isSameDay(date, addDays(now, -1))) return 'Hier';
  return fmtDateLong(date);
};

/** Semaine ouvrée lundi → vendredi contenant `value`. */
export const workWeek = (value) => {
  const start = startOfWeek(toDate(value), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end: addDays(start, 4) });
};

/** Grille mensuelle complète (lundi → dimanche), 35 ou 42 cases. */
export const monthGrid = (value) => {
  const start = startOfWeek(startOfMonth(toDate(value)), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(toDate(value)), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
};

/** Créneaux d'une plage horaire, pas de 30 min par défaut. */
export const timeSlots = (openTime = '08:00', closeTime = '20:00', stepMin = 30) => {
  const slots = [];
  let cursor = mergeDateAndTime(NOW, openTime);
  const limit = mergeDateAndTime(NOW, closeTime);
  while (cursor <= limit) {
    slots.push(format(cursor, 'HH:mm'));
    cursor = addMinutes(cursor, stepMin);
  }
  return slots;
};

export { addDays, addMinutes, differenceInMinutes, isSameDay, startOfDay, startOfMonth };
