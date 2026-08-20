// src/api/checkin.js
// Endpoints FastAPI cibles :
//   GET  /api/bookings/{id}/checkin     fenêtre de validation restante
//   POST /api/bookings/{id}/checkin     { code } -> présence validée
//   POST /api/bookings/{id}/late        signale un retard, prolonge la fenêtre

import { differenceInMinutes } from 'date-fns';
import { NOW, toDate } from '../utils/dates';
import { ApiError, delay, notFound } from './client';
import { bookingStore } from './bookings';

/** Fenêtre de validation : 10 min avant le début, 10 min après. */
const WINDOW_MIN = 10;

export async function getCheckInWindow(bookingId) {
  await delay(150);
  const booking = bookingStore.find((b) => b.id === bookingId);
  if (!booking) throw notFound('Réservation');

  const sinceStart = differenceInMinutes(NOW, toDate(booking.start));
  // Avant l'ouverture de la fenêtre, le compteur reste plein ; une fois ouverte,
  // il décompte les minutes restantes sans jamais dépasser la durée de fenêtre.
  const remainingMin = Math.max(0, Math.min(WINDOW_MIN, WINDOW_MIN - sinceStart));
  const opensInMin = Math.max(0, -sinceStart - WINDOW_MIN);

  return {
    bookingId,
    open: sinceStart >= -WINDOW_MIN && remainingMin > 0,
    opensInMin,
    windowMin: WINDOW_MIN,
    remainingMin,
    checkedIn: booking.checkedIn,
    autoReleaseWarning:
      'La salle sera automatiquement libérée si vous ne validez pas votre présence dans le temps imparti.',
  };
}

export async function checkIn(bookingId, code) {
  await delay();
  const booking = bookingStore.find((b) => b.id === bookingId);
  if (!booking) throw notFound('Réservation');
  if (booking.status !== 'confirmee') {
    throw new ApiError("Cette réservation n'est pas active.", 409, 'inactive');
  }
  if (String(code).replace(/\s|-/g, '').toUpperCase() !==
      String(booking.accessCode).replace(/\s|-/g, '').toUpperCase()) {
    throw new ApiError('Code incorrect. Vérifiez l’écran de la salle.', 422, 'code_invalide');
  }

  const updated = bookingStore.update(bookingId, (item) => ({
    checkedIn: true,
    history: [
      ...item.history,
      { type: 'checkin', at: NOW.toISOString(), label: 'Présence validée sur place' },
    ],
  }));
  return updated;
}

/** « Je suis en retard » : prolonge la fenêtre de 10 minutes. */
export async function declareLate(bookingId) {
  await delay();
  const booking = bookingStore.find((b) => b.id === bookingId);
  if (!booking) throw notFound('Réservation');
  return { bookingId, extendedByMin: WINDOW_MIN };
}
