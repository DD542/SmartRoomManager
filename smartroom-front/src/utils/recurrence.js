import { addDays, addMonths, getDay, isAfter, startOfDay } from 'date-fns';
import { mergeDateAndTime, toDate } from './dates';

/**
 * Génération des occurrences d'une réservation récurrente (écran U-14).
 * La règle est indépendante des salles : elle produit des créneaux, que le
 * moteur de conflits qualifie ensuite un par un.
 */

const MAX_OCCURRENCES = 60; // garde-fou : un semestre de récurrence quotidienne

function nextDate(cursor, rule) {
  if (rule.frequency === 'quotidienne') return addDays(cursor, 1);
  if (rule.frequency === 'mensuelle') return addMonths(cursor, 1);
  return addDays(cursor, 1); // hebdomadaire : on balaie jour par jour et on filtre
}

function matchesRule(date, rule, anchor) {
  if (rule.frequency === 'hebdomadaire') {
    const days = rule.weekDays?.length ? rule.weekDays : [getDay(anchor)];
    return days.includes(getDay(date));
  }
  if (rule.frequency === 'mensuelle') {
    return date.getDate() === anchor.getDate();
  }
  return true;
}

/**
 * @param {{frequency:string, weekDays:number[], end:{type:'count'|'until', value:any}}} rule
 * @param {{date:Date|string, startTime:string, endTime:string}} slot
 * @returns {{index:number, start:Date, end:Date}[]}
 */
export function generateOccurrences(rule, slot) {
  const anchor = startOfDay(toDate(slot.date));
  const limitCount = rule.end?.type === 'count' ? Number(rule.end.value) : MAX_OCCURRENCES;
  const limitDate = rule.end?.type === 'until' ? startOfDay(toDate(rule.end.value)) : null;

  const out = [];
  let cursor = anchor;
  let guard = 0;

  while (out.length < Math.min(limitCount, MAX_OCCURRENCES) && guard < 400) {
    guard += 1;
    if (limitDate && isAfter(cursor, limitDate)) break;
    if (matchesRule(cursor, rule, anchor)) {
      out.push({
        index: out.length + 1,
        start: mergeDateAndTime(cursor, slot.startTime),
        end: mergeDateAndTime(cursor, slot.endTime),
      });
    }
    cursor = nextDate(cursor, rule);
  }

  return out;
}

/** Résumé textuel de la règle, affiché sous l'aperçu des dates générées. */
export function describeRule(rule, occurrences = []) {
  const freq = {
    quotidienne: 'Tous les jours',
    hebdomadaire: 'Toutes les semaines',
    mensuelle: 'Tous les mois',
  }[rule.frequency];

  const fin =
    rule.end?.type === 'count'
      ? `sur ${rule.end.value} occurrences`
      : `jusqu'au ${new Date(rule.end.value).toLocaleDateString('fr-FR')}`;

  return `${freq}, ${fin} — ${occurrences.length} date${occurrences.length > 1 ? 's' : ''} générée${
    occurrences.length > 1 ? 's' : ''
  }.`;
}
