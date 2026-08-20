import { differenceInMinutes } from 'date-fns';
import { fmtTime, toDate } from './dates';

/**
 * Moteur de détection de conflits.
 *
 * Trois natures de collision sont distinguées :
 *   - 'total'    : le créneau demandé englobe ou est englobé par l'existant ;
 *   - 'partiel'  : les créneaux se chevauchent sans inclusion ;
 *   - 'adjacent' : aucun chevauchement, mais l'écart est inférieur au battement
 *                  exigé par la salle (aération, transition, ménage).
 *
 * Le moteur ne connaît ni React ni les mocks : il prend des créneaux et rend
 * des objets Conflict, réutilisables côté FastAPI sans réécriture.
 */

const ACTIVE_STATUSES = ['confirmee', 'en_attente'];

/** Deux intervalles [aStart, aEnd[ et [bStart, bEnd[ se chevauchent-ils ? */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return toDate(aStart) < toDate(bEnd) && toDate(bStart) < toDate(aEnd);
}

/** Minutes de chevauchement, 0 si les créneaux sont disjoints. */
export function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(toDate(aStart).getTime(), toDate(bStart).getTime());
  const end = Math.min(toDate(aEnd).getTime(), toDate(bEnd).getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

/** Minutes séparant deux créneaux disjoints ; null s'ils se chevauchent. */
export function gapMinutes(aStart, aEnd, bStart, bEnd) {
  if (overlaps(aStart, aEnd, bStart, bEnd)) return null;
  if (toDate(aStart) >= toDate(bEnd)) return differenceInMinutes(toDate(aStart), toDate(bEnd));
  return differenceInMinutes(toDate(bStart), toDate(aEnd));
}

function classify(candidate, booking, bufferMin) {
  const { start: cs, end: ce } = candidate;
  const { start: bs, end: be } = booking;

  if (overlaps(cs, ce, bs, be)) {
    const contained = toDate(cs) >= toDate(bs) && toDate(ce) <= toDate(be);
    const contains = toDate(cs) <= toDate(bs) && toDate(ce) >= toDate(be);
    return {
      kind: contained || contains ? 'total' : 'partiel',
      overlapMin: overlapMinutes(cs, ce, bs, be),
      gap: 0,
    };
  }

  const gap = gapMinutes(cs, ce, bs, be);
  if (bufferMin > 0 && gap !== null && gap < bufferMin) {
    return { kind: 'adjacent', overlapMin: 0, gap };
  }
  return null;
}

function describe(kind, booking, detail, bufferMin) {
  const plage = `${fmtTime(booking.start)}-${fmtTime(booking.end)}`;
  if (kind === 'total') {
    return `Créneau déjà entièrement pris par « ${booking.title} » (${plage}).`;
  }
  if (kind === 'partiel') {
    return `Chevauchement de ${detail.overlapMin} min avec « ${booking.title} » (${plage}).`;
  }
  return `« ${booking.title} » se termine à ${fmtTime(booking.end)} : il ne reste que ${detail.gap} min de battement au lieu des ${bufferMin} min exigées.`;
}

/**
 * @param {{roomId:string,start:Date|string,end:Date|string,ignoreBookingId?:string}} candidate
 * @param {Array} bookings  Toutes les réservations connues, toutes salles confondues.
 * @param {{bufferMin?:number}} options
 * @returns {Array} Conflits triés du plus bloquant au plus souple.
 */
export function detectConflicts(candidate, bookings = [], options = {}) {
  const bufferMin = options.bufferMin ?? 0;
  const order = { total: 0, partiel: 1, adjacent: 2 };

  return bookings
    .filter(
      (b) =>
        b.roomId === candidate.roomId &&
        b.id !== candidate.ignoreBookingId &&
        ACTIVE_STATUSES.includes(b.status),
    )
    .map((booking) => {
      const detail = classify(candidate, booking, bufferMin);
      if (!detail) return null;
      return {
        booking,
        kind: detail.kind,
        overlapMin: detail.overlapMin,
        gapMin: detail.gap,
        blocking: detail.kind !== 'adjacent',
        message: describe(detail.kind, booking, detail, bufferMin),
      };
    })
    .filter(Boolean)
    .sort((a, b) => order[a.kind] - order[b.kind]);
}

export const hasBlockingConflict = (conflicts = []) => conflicts.some((c) => c.blocking);

/**
 * Premiers créneaux libres de même durée après le créneau demandé.
 * Alimente les « créneaux alternatifs » de l'écran U-12.
 */
export function suggestAlternatives(candidate, bookings, options = {}) {
  const { bufferMin = 0, stepMin = 15, limit = 3, latest } = options;
  const duration = differenceInMinutes(toDate(candidate.end), toDate(candidate.start));
  const out = [];
  let cursor = toDate(candidate.start).getTime();
  const hardStop = latest ? toDate(latest).getTime() : cursor + 8 * 3600000;

  while (out.length < limit && cursor <= hardStop) {
    cursor += stepMin * 60000;
    const start = new Date(cursor);
    const end = new Date(cursor + duration * 60000);
    const conflicts = detectConflicts({ ...candidate, start, end }, bookings, { bufferMin });
    if (conflicts.length === 0) out.push({ start, end });
  }
  return out;
}
