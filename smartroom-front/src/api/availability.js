// src/api/availability.js
// Endpoints réels :
//   GET  /api/v1/rooms/{id}/booking-rules            contraintes appliquées
//   GET  /api/v1/rooms/{id}/opening-hours            amplitude appliquée
//   GET  /api/v1/availability/rooms/{id}/free-slots  trous réservables
//   GET  /api/v1/availability/calendar               réservations d'une plage
//   POST /api/v1/availability/search                 recherche multicritère

import { addDays, isSameDay, mergeDateAndTime, timeSlots, toDate } from '../utils/dates';
import * as adapt from './adapters';
import { abortable, get, post } from './client';
import { getRoomRules } from './rooms';

const jour = (date) => toDate(date).toISOString().slice(0, 10);

/**
 * Règles d'une salle : contraintes de réservation et amplitude d'ouverture.
 *
 * Deux appels parce que le back tient deux référentiels distincts ; ils partent
 * ensemble et la couture est faite par l'adaptateur.
 */
export const getRules = (roomId, options) => getRoomRules(roomId, options);

/**
 * Grille d'une journée, pas de 30 min, avec l'état de chaque case.
 *
 * `state` vaut 'libre' | 'occupe' | 'ferme'. Les trous libres viennent du
 * moteur — battement déduit, fermetures appliquées — et non d'une soustraction
 * refaite ici : deux calculs de disponibilité finiraient par diverger.
 */
export async function getDayAvailability(roomId, date) {
  const day = toDate(date);
  const [regles, libres, reservations] = await Promise.all([
    getRules(roomId, { signal: abortable(`avail:rules:${roomId}`) }),
    get(`/availability/rooms/${roomId}/free-slots`, {
      params: { first_day: jour(day), last_day: jour(day) },
      signal: abortable(`avail:free:${roomId}`),
    }),
    listeReservations(roomId, day, addDays(day, 1)),
  ]);

  const trous = libres.slots.map(adapt.slotOut);
  const closed = trous.length === 0 && !regles.visitDays.includes(day.getDay());
  const bookings = reservations.filter((item) => isSameDay(item.start, day));

  const slots = timeSlots(regles.openTime, regles.closeTime, 30)
    .slice(0, -1)
    .map((time, index, all) => {
      const start = mergeDateAndTime(day, time);
      const end = mergeDateAndTime(day, all[index + 1] ?? regles.closeTime);
      const pris = bookings.find((item) => item.start < end && start < item.end);
      const libre = trous.some((trou) => trou.start <= start && end <= trou.end);
      return {
        time,
        start,
        end,
        state: pris ? 'occupe' : libre ? 'libre' : 'ferme',
        booking: pris ? { id: pris.id, title: pris.title } : null,
      };
    });

  return { roomId, date: day, closed, rules: regles, bookings, slots };
}

/**
 * Réservations d'une plage quelconque : la vue du calendrier — jour, semaine,
 * mois — pilote les bornes, et seules les lignes visibles sont chargées.
 */
export async function getAvailabilityRange(roomId, from, to) {
  const [regles, bookings] = await Promise.all([
    getRules(roomId, { signal: abortable(`avail:rules:${roomId}`) }),
    listeReservations(roomId, from, to),
  ]);

  return {
    roomId,
    from: toDate(from),
    to: toDate(to),
    rules: regles,
    hours: timeSlots(regles.openTime, regles.closeTime, 60).slice(0, -1),
    bookings,
  };
}

async function listeReservations(roomId, from, to) {
  const data = await get('/availability/calendar', {
    params: {
      from_date: toDate(from).toISOString(),
      to_date: toDate(to).toISOString(),
      room_ids: [roomId],
    },
    signal: abortable(`avail:cal:${roomId}`),
  });
  return data.events.map((item) => ({
    id: item.id,
    roomId: item.room_id,
    title: item.title,
    start: new Date(item.start),
    end: new Date(item.end),
    status: item.status,
    isMine: item.is_mine,
    isBlocking: item.is_blocking,
  }));
}

/**
 * Prochain créneau libre, affiché sur la fiche salle.
 *
 * Cherche sur sept jours : au-delà, « prochain créneau dans onze jours » ne
 * répond plus à la question posée.
 */
export async function getNextFreeSlot(roomId, from) {
  const debut = toDate(from);
  const data = await get(`/availability/rooms/${roomId}/free-slots`, {
    params: { first_day: jour(debut), last_day: jour(addDays(debut, 6)) },
    signal: abortable(`avail:next:${roomId}`),
  });

  const suivant = data.slots.map(adapt.slotOut).find((item) => item.end > debut);
  if (!suivant) return null;

  const start = suivant.start > debut ? suivant.start : debut;
  const fin = new Date(start.getTime() + 3_600_000);
  return { start, end: fin < suivant.end ? fin : suivant.end };
}

/**
 * Recherche multicritère.
 *
 * Les salles occupées sur le créneau restent dans la réponse, marquées
 * `eligible: false` : leur absence pure et simple laisserait l'utilisateur
 * croire que la salle qu'il visait n'existe pas.
 */
export async function searchRooms({
  start,
  end,
  attendees = 1,
  buildingId,
  equipmentIds = [],
  accessibleOnly = false,
  strictEquipment = true,
  limit = 20,
} = {}) {
  const data = await post(
    '/availability/search',
    {
      slot: start && end ? adapt.slotIn(start, end) : null,
      attendees,
      building_id: buildingId ?? null,
      equipment_ids: equipmentIds,
      accessible_only: accessibleOnly,
      equipment_strict: strictEquipment,
      limit,
    },
    { signal: abortable('avail:search') },
  );
  return data.map(adapt.suggestion);
}
