// src/api/checkin.js
// Endpoints réels :
//   POST /api/v1/bookings/{id}/check-in   { code } -> présence validée
//   POST /api/v1/bookings/{id}/late       le créneau reste réservé malgré le retard
//
// La fenêtre elle-même n'est pas une route : elle se déduit du début du créneau
// et de `checkinWindowMin`, deux valeurs déjà chargées par l'écran. Un appel de
// plus n'apporterait qu'une horloge serveur, que le décompte local suit déjà.

import { differenceInMinutes } from 'date-fns';
import * as adapt from './adapters';
import { post } from './client';
import { getBooking } from './bookings';
import { getRoomRules } from './rooms';

export async function getCheckInWindow(bookingId) {
  const reservation = await getBooking(bookingId);
  const regles = await getRoomRules(reservation.roomId);
  const fenetre = regles.checkinWindowMin ?? 10;

  const depuisDebut = differenceInMinutes(new Date(), reservation.start);
  // Avant l'ouverture, le compteur reste plein ; une fois ouverte, il décompte
  // les minutes restantes sans jamais dépasser la durée de fenêtre.
  const restantes = Math.max(0, Math.min(fenetre, fenetre - depuisDebut));

  return {
    bookingId,
    open: depuisDebut >= -fenetre && restantes > 0,
    opensInMin: Math.max(0, -depuisDebut - fenetre),
    windowMin: fenetre,
    remainingMin: restantes,
    checkedIn: Boolean(reservation.checkedInAt),
    autoReleaseWarning:
      'La salle sera automatiquement libérée si vous ne validez pas votre présence dans le temps imparti.',
  };
}

export async function checkIn(bookingId, code) {
  const data = await post(`/bookings/${bookingId}/check-in`, {
    code: String(code ?? '').replace(/\s|-/g, '').toUpperCase(),
  });
  return adapt.booking(data);
}

/**
 * « Je suis en retard » : le créneau reste réservé au-delà de la fenêtre.
 *
 * La marque vaut validation de présence — sans cela, la tâche de libération
 * rendrait la salle à quelqu'un qui arrive avec dix minutes de retard.
 */
export async function declareLate(bookingId) {
  const data = await post(`/bookings/${bookingId}/late`);
  return { bookingId, extendedByMin: 0, booking: adapt.booking(data) };
}
