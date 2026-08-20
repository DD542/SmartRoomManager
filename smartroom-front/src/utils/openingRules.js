import { getDay } from 'date-fns';
import { WEEK_DAYS, durationMin, fmtDuration, mergeDateAndTime, toDate } from './dates';

/**
 * Règles d'ouverture d'une salle : jours de visite autorisés, plage horaire,
 * durée minimale et maximale d'un créneau. Toute demande passe par validateSlot,
 * côté front comme côté FastAPI plus tard.
 */

export const dayLabel = (value) => WEEK_DAYS.find((d) => d.value === value)?.label ?? '';

/** « Lundi au vendredi » ou « Mardi, mercredi et vendredi » selon la salle. */
export function visitDaysLabel(visitDays = []) {
  const sorted = [...visitDays].sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
  const isWorkWeek = sorted.length === 5 && sorted.every((d, i) => d === i + 1);
  if (isWorkWeek) return 'Lundi au vendredi';
  if (sorted.length === 0) return 'Aucun jour autorisé';
  if (sorted.length === 1) return dayLabel(sorted[0]);
  const labels = sorted.map(dayLabel);
  const joined = `${labels.slice(0, -1).join(', ')} et ${labels[labels.length - 1]}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1).toLowerCase();
}

export const isVisitDay = (date, rules) => rules.visitDays.includes(getDay(toDate(date)));

export function isWithinOpening(start, end, rules) {
  const day = toDate(start);
  const open = mergeDateAndTime(day, rules.openTime);
  const close = mergeDateAndTime(day, rules.closeTime);
  return toDate(start) >= open && toDate(end) <= close;
}

/**
 * Valide un créneau contre les règles de la salle.
 * @returns {{ok:boolean, errors:{code:string,message:string}[], warnings:string[]}}
 */
export function validateSlot({ start, end }, rules) {
  const errors = [];
  const warnings = [];
  const minutes = durationMin(start, end);

  if (minutes <= 0) {
    errors.push({ code: 'ordre', message: "L'heure de fin doit suivre l'heure de début." });
  }
  if (minutes > 0 && minutes < rules.minDurationMin) {
    errors.push({
      code: 'duree_min',
      message: `Durée minimale de ${fmtDuration(rules.minDurationMin)} pour cette salle.`,
    });
  }
  if (minutes > rules.maxDurationMin) {
    errors.push({
      code: 'duree_max',
      message: `Durée maximale de ${fmtDuration(rules.maxDurationMin)} pour cette salle.`,
    });
  }
  if (!isVisitDay(start, rules)) {
    errors.push({
      code: 'jour_ferme',
      message: `Salle accessible uniquement : ${visitDaysLabel(rules.visitDays).toLowerCase()}.`,
    });
  }
  if (minutes > 0 && !isWithinOpening(start, end, rules)) {
    errors.push({
      code: 'hors_plage',
      message: `Ouverture de ${rules.openTime} à ${rules.closeTime}.`,
    });
  }
  if (minutes >= rules.maxDurationMin * 0.75 && minutes <= rules.maxDurationMin) {
    warnings.push(
      `Créneau long (${fmtDuration(minutes)}) : pensez à libérer la salle à l'heure.`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Phrase d'ouverture affichée sur la fiche salle et le calendrier. */
export const openingLabel = (rules) =>
  `${visitDaysLabel(rules.visitDays)} • ${rules.openTime} - ${rules.closeTime}`;

/** Le créneau est-il passé par rapport à l'horloge de référence ? */
export const isPast = (end, now) => toDate(end) < now;
