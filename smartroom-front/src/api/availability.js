// src/api/availability.js
// Endpoints FastAPI cibles :
//   GET /api/rooms/{id}/availability?date=            créneaux d'une journée
//   GET /api/rooms/{id}/availability?from=&to=        réservations d'une plage
//   GET /api/rooms/{id}/rules                         règles d'ouverture

import { roomById } from '../mocks/rooms';
import { isSameDay, mergeDateAndTime, timeSlots, toDate } from '../utils/dates';
import { detectConflicts } from '../utils/conflicts';
import { isVisitDay, validateSlot } from '../utils/openingRules';
import { clone, delay, notFound } from './client';
import { bookingStore } from './bookings';

const activeBookings = (roomId) =>
  bookingStore.filter((b) => b.roomId === roomId && b.status !== 'annulee');

/** Règles d'ouverture d'une salle, affichées en U-04 et U-17. */
export async function getRules(roomId) {
  await delay(150);
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');
  return clone(room.rules);
}

/**
 * Créneaux d'une journée, pas de 30 min, avec l'état de chacun.
 * `state` vaut 'libre' | 'occupe' | 'ferme'.
 */
export async function getDayAvailability(roomId, date) {
  await delay();
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');

  const day = toDate(date);
  const closed = !isVisitDay(day, room.rules);
  const bookings = activeBookings(roomId).filter((b) => isSameDay(toDate(b.start), day));

  const slots = timeSlots(room.rules.openTime, room.rules.closeTime, 30)
    .slice(0, -1)
    .map((time, index, all) => {
      const start = mergeDateAndTime(day, time);
      const end = mergeDateAndTime(day, all[index + 1] ?? room.rules.closeTime);
      const taken = bookings.find(
        (b) => toDate(b.start) < end && start < toDate(b.end),
      );
      return {
        time,
        start,
        end,
        state: closed ? 'ferme' : taken ? 'occupe' : 'libre',
        booking: taken ? { id: taken.id, title: taken.title } : null,
      };
    });

  return { roomId, date: day, closed, rules: clone(room.rules), bookings, slots };
}

/**
 * Réservations d'une plage quelconque : la vue du calendrier (jour, semaine,
 * mois ou année) pilote les bornes, l'API ne connaît que `from` et `to`.
 */
export async function getAvailabilityRange(roomId, from, to) {
  await delay();
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');

  const bookings = activeBookings(roomId).filter(
    (booking) => toDate(booking.end) >= toDate(from) && toDate(booking.start) <= toDate(to),
  );

  return {
    roomId,
    from: toDate(from),
    to: toDate(to),
    rules: clone(room.rules),
    hours: timeSlots(room.rules.openTime, room.rules.closeTime, 60).slice(0, -1),
    bookings,
  };
}

/** Prochain créneau libre d'une salle, affiché sur la fiche salle (U-17). */
export async function getNextFreeSlot(roomId, from) {
  await delay(200);
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');

  const day = toDate(from);
  const candidates = timeSlots(room.rules.openTime, room.rules.closeTime, 30).slice(0, -2);
  for (const time of candidates) {
    const start = mergeDateAndTime(day, time);
    if (start < day) continue;
    const end = new Date(start.getTime() + 60 * 60000);
    const rules = validateSlot({ start, end }, room.rules);
    if (!rules.ok) continue;
    const conflicts = detectConflicts({ roomId, start, end }, activeBookings(roomId), {
      bufferMin: room.rules.bufferMin,
    });
    if (conflicts.length === 0) return { start, end };
  }
  return null;
}
