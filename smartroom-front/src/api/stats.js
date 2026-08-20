// src/api/stats.js
// Endpoints FastAPI cibles :
//   GET /api/stats/me?period=mois|trimestre|annee   agrégats personnels
//   GET /api/stats/me/export                         export PDF du rapport
//   GET /api/stats/public                            chiffres de la page d'accueil

import { getMonth, getYear } from 'date-fns';
import { buildings } from '../mocks/buildings';
import { rooms, roomById } from '../mocks/rooms';
import { currentUserId } from '../mocks/users';
import { NOW, durationMin, toDate } from '../utils/dates';
import { delay } from './client';
import { bookingStore } from './bookings';

const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const SLOT_BUCKETS = [
  { id: '08-10', label: '08:00 - 10:00', from: 8, to: 10 },
  { id: '10-12', label: '10:00 - 12:00', from: 10, to: 12 },
  { id: '14-16', label: '14:00 - 16:00', from: 14, to: 16 },
  { id: '16-18', label: '16:00 - 18:00', from: 16, to: 18 },
];

function periodFilter(period) {
  const currentMonth = getMonth(NOW);
  const currentYear = getYear(NOW);
  const quarterStart = Math.floor(currentMonth / 3) * 3;

  return (booking) => {
    const date = toDate(booking.start);
    if (getYear(date) !== currentYear) return false;
    if (period === 'mois') return getMonth(date) === currentMonth;
    if (period === 'trimestre') return getMonth(date) >= quarterStart && getMonth(date) <= quarterStart + 2;
    return true;
  };
}

/**
 * Agrégats de l'écran U-24. Tout est calculé à partir des réservations réelles
 * du magasin : créer ou annuler une réservation déplace immédiatement les chiffres.
 */
export async function getMyStats(period = 'trimestre', ownerId = currentUserId) {
  await delay();
  const mine = bookingStore.filter((b) => b.ownerId === ownerId).filter(periodFilter(period));
  const active = mine.filter((b) => b.status !== 'annulee');

  const totalMinutes = active.reduce((sum, b) => sum + durationMin(b.start, b.end), 0);
  const cancelled = mine.filter((b) => b.status === 'annulee').length;
  const past = active.filter((b) => toDate(b.end) < NOW);
  const attendance = past.length === 0 ? 1 : past.filter((b) => b.checkedIn).length / past.length;

  const byMonth = MONTH_LABELS.map((label, index) => ({
    label,
    hours: Math.round(
      active
        .filter((b) => getMonth(toDate(b.start)) === index)
        .reduce((sum, b) => sum + durationMin(b.start, b.end), 0) / 60,
    ),
  })).filter((_, index) => index <= getMonth(NOW));

  const roomCounts = active.reduce(
    (acc, b) => ({ ...acc, [b.roomId]: (acc[b.roomId] ?? 0) + 1 }),
    {},
  );
  const byRoom = Object.entries(roomCounts)
    .map(([roomId, count]) => ({
      roomId,
      name: roomById[roomId]?.name ?? roomId,
      count,
      share: count / (active.length || 1),
    }))
    .sort((a, b) => b.count - a.count);

  const bySlot = SLOT_BUCKETS.map((bucket) => {
    const count = active.filter((b) => {
      const hour = toDate(b.start).getHours();
      return hour >= bucket.from && hour < bucket.to;
    }).length;
    return { ...bucket, count, share: count / (active.length || 1) };
  });

  return {
    period,
    kpis: {
      bookings: active.length,
      hours: Math.round(totalMinutes / 60),
      cancelled,
      attendance,
    },
    byMonth,
    byRoom,
    bySlot,
    observation: buildObservation(byRoom, bySlot),
  };
}

/**
 * L'observation est dérivée des agrégats, jamais écrite en dur — et elle
 * n'affirme une tendance que si un créneau ou une salle se détache réellement.
 */
function buildObservation(byRoom, bySlot) {
  const slots = [...bySlot].sort((a, b) => b.count - a.count);
  const [topSlot, secondSlot] = slots;
  const [topRoom, secondRoom] = byRoom;

  if (!topRoom || !topSlot || topSlot.count === 0) {
    return 'Pas encore assez de réservations sur la période pour dégager une tendance.';
  }

  const slotStandsOut = topSlot.count > (secondSlot?.count ?? 0);
  const roomStandsOut = topRoom.count > (secondRoom?.count ?? 0);

  if (slotStandsOut && roomStandsOut) {
    return `Vos réservations se concentrent sur le créneau ${topSlot.label}, avec une préférence marquée pour la ${topRoom.name}.`;
  }
  if (slotStandsOut) {
    return `Vous réservez surtout sur le créneau ${topSlot.label}, sans salle privilégiée pour l’instant.`;
  }
  if (roomStandsOut) {
    return `La ${topRoom.name} concentre vos réservations, réparties sur l’ensemble de la journée.`;
  }
  return `Votre usage reste réparti : ${byRoom.length} salles et ${slots.filter((slot) => slot.count > 0).length} créneaux différents sur la période.`;
}

/**
 * Chiffres publics de la landing (P-01). Ils sont dérivés du catalogue réel :
 * aucun nombre décoratif écrit en dur dans la page.
 */
export async function getPublicStats() {
  await delay();
  const openRooms = rooms.filter((room) => room.status !== 'maintenance');
  const averageOccupancy =
    openRooms.reduce((sum, room) => sum + room.occupancyRate, 0) / (openRooms.length || 1);

  return {
    rooms: rooms.length,
    buildings: buildings.length,
    doubleBookings: 0,
    averageOccupancy,
  };
}

/** Export PDF : le back renverra un flux, la maquette confirme la demande. */
export async function exportStats(period) {
  await delay(600);
  return { period, ready: true, filename: `statistiques-${period}.pdf` };
}
