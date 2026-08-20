// src/api/bookings.js
// Endpoints FastAPI cibles :
//   GET    /api/bookings?owner=&status=&from=&to=   mes réservations
//   GET    /api/bookings/{id}                        détail
//   POST   /api/bookings                             création
//   POST   /api/bookings/series                      série récurrente
//   PATCH  /api/bookings/{id}                        modification
//   POST   /api/bookings/{id}/cancel                 annulation motivée
//   POST   /api/bookings/{id}/participants/respond   réponse à une invitation
//   POST   /api/bookings/{id}/checkin                validation de présence

import { bookings as seed, cancelReasons } from '../mocks/bookings';
import { roomById } from '../mocks/rooms';
import { buildings } from '../mocks/buildings';
import { equipmentById } from '../mocks/equipment';
import { currentUserId } from '../mocks/users';
import { detectConflicts, hasBlockingConflict, suggestAlternatives } from '../utils/conflicts';
import { validateSlot } from '../utils/openingRules';
import { generateOccurrences } from '../utils/recurrence';
import { NOW, toDate } from '../utils/dates';
import { ApiError, clone, createStore, delay, generateAccessCode, nextId, notFound } from './client';

/** Magasin partagé : availability, stats, search et checkin le réutilisent. */
export const bookingStore = createStore(seed);

const buildingCodeOf = (roomId) =>
  buildings.find((b) => b.id === roomById[roomId]?.buildingId)?.code ?? 'A';

/**
 * Décoration commune : la réservation embarque sa salle, elle-même complétée de
 * son bâtiment et de ses équipements, comme le fera la jointure côté FastAPI.
 */
function withRoom(booking) {
  const room = roomById[booking.roomId];
  if (!room) return { ...booking, room: null };
  return {
    ...booking,
    room: {
      ...clone(room),
      building: clone(buildings.find((b) => b.id === room.buildingId)) ?? null,
      equipment: room.equipmentIds.map((id) => clone(equipmentById[id])).filter(Boolean),
    },
  };
}

/** Statut recalculé à l'instant de référence : une réservation passée est terminée. */
function resolveStatus(booking) {
  if (booking.status === 'annulee') return 'annulee';
  if (toDate(booking.end) < NOW) return 'terminee';
  return booking.status;
}

export async function listBookings(filters = {}) {
  await delay();
  const { ownerId = currentUserId, status, roomId, from, to, includeOthers = false } = filters;

  return bookingStore
    .all()
    .filter((b) => (includeOthers ? true : b.ownerId === ownerId))
    .filter((b) => (roomId ? b.roomId === roomId : true))
    .filter((b) => (status ? resolveStatus(b) === status : true))
    .filter((b) => (from ? toDate(b.end) >= toDate(from) : true))
    .filter((b) => (to ? toDate(b.start) <= toDate(to) : true))
    .map((b) => withRoom({ ...b, status: resolveStatus(b) }))
    .sort((a, b) => toDate(a.start) - toDate(b.start));
}

/** Toutes les réservations actives d'une salle, y compris celles des autres. */
export async function listRoomBookings(roomId) {
  await delay();
  return bookingStore.filter((b) => b.roomId === roomId && b.status !== 'annulee');
}

export async function getBooking(id) {
  await delay();
  const booking = bookingStore.find((b) => b.id === id);
  if (!booking) throw notFound('Réservation');
  return withRoom({ ...booking, status: resolveStatus(booking) });
}

/** Prochaine réservation à venir de l'utilisateur (dashboard U-01). */
export async function getNextBooking(ownerId = currentUserId) {
  await delay();
  const next = bookingStore
    .filter((b) => b.ownerId === ownerId && b.status === 'confirmee' && toDate(b.end) >= NOW)
    .sort((a, b) => toDate(a.start) - toDate(b.start))[0];
  return next ? withRoom(next) : null;
}

/**
 * Vérification de créneau : règles d'ouverture + conflits + alternatives.
 * Version synchrone, réutilisée par les écritures pour ne pas cumuler les délais.
 */
export function evaluateSlot({ roomId, start, end, ignoreBookingId }) {
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');

  const rules = validateSlot({ start, end }, room.rules);
  const others = bookingStore.filter((b) => b.status !== 'annulee');
  const conflicts = detectConflicts({ roomId, start, end, ignoreBookingId }, others, {
    bufferMin: room.rules.bufferMin,
  });
  const alternatives =
    conflicts.length > 0
      ? suggestAlternatives({ roomId, start, end, ignoreBookingId }, others, {
          bufferMin: room.rules.bufferMin,
          limit: 3,
        })
      : [];

  return {
    ok: rules.ok && !hasBlockingConflict(conflicts) && conflicts.length === 0,
    rules,
    conflicts,
    alternatives,
  };
}

/** Version exposée aux écrans : même résultat, avec le délai réseau simulé. */
export async function checkSlot(candidate) {
  await delay();
  return evaluateSlot(candidate);
}

function createBookingSync(payload) {
  const { roomId, start, end } = payload;
  const check = evaluateSlot({ roomId, start, end });
  if (!check.rules.ok) {
    throw new ApiError(check.rules.errors[0].message, 422, check.rules.errors[0].code);
  }
  if (check.conflicts.length > 0) {
    throw new ApiError(check.conflicts[0].message, 409, 'conflit');
  }

  const booking = {
    id: nextId('bk'),
    roomId,
    ownerId: payload.ownerId ?? currentUserId,
    title: payload.title?.trim() || 'Réunion',
    start: toDate(start).toISOString(),
    end: toDate(end).toISOString(),
    attendees: payload.attendees ?? 1,
    requiredEquipmentIds: payload.requiredEquipmentIds ?? [],
    status: 'confirmee',
    accessCode: generateAccessCode(buildingCodeOf(roomId)),
    checkedIn: false,
    participants: payload.participants ?? [],
    recurrence: payload.recurrence ?? null,
    seriesId: payload.seriesId ?? null,
    cancelReason: null,
    history: [
      { type: 'creee', at: NOW.toISOString(), label: 'Réservation créée' },
      { type: 'confirmee', at: NOW.toISOString(), label: 'Confirmée' },
    ],
  };
  return withRoom(bookingStore.insert(booking));
}

export async function createBooking(payload) {
  await delay();
  return createBookingSync(payload);
}

/** Série récurrente (U-14) : les occurrences en conflit sont ignorées. */
export async function createSeries({ roomId, date, startTime, endTime, rule, ...rest }) {
  await delay();
  const occurrences = generateOccurrences(rule, { date, startTime, endTime });
  const seriesId = nextId('srs');
  const created = [];
  const skipped = [];

  for (const occurrence of occurrences) {
    const check = evaluateSlot({ roomId, start: occurrence.start, end: occurrence.end });
    if (check.conflicts.length > 0 || !check.rules.ok) {
      skipped.push({
        occurrence,
        reason: check.conflicts[0]?.message ?? check.rules.errors[0]?.message,
      });
      continue;
    }
    created.push(
      createBookingSync({
        ...rest,
        roomId,
        start: occurrence.start,
        end: occurrence.end,
        recurrence: rule,
        seriesId,
      }),
    );
  }
  return { seriesId, created, skipped };
}

/**
 * Aperçu d'une série sans écriture : alimente la colonne « dates générées »
 * de U-14, avec le statut disponible/conflit de chaque occurrence.
 */
export async function previewSeries({ roomId, date, startTime, endTime, rule }) {
  await delay();
  return generateOccurrences(rule, { date, startTime, endTime }).map((occurrence) => {
    const check = evaluateSlot({ roomId, start: occurrence.start, end: occurrence.end });
    return {
      ...occurrence,
      available: check.conflicts.length === 0 && check.rules.ok,
      reason: check.conflicts[0]?.message ?? check.rules.errors[0]?.message ?? null,
    };
  });
}

export async function updateBooking(id, patch) {
  await delay();
  const current = bookingStore.find((b) => b.id === id);
  if (!current) throw notFound('Réservation');

  const start = patch.start ?? current.start;
  const end = patch.end ?? current.end;
  const roomId = patch.roomId ?? current.roomId;
  const check = evaluateSlot({ roomId, start, end, ignoreBookingId: id });
  if (!check.rules.ok) throw new ApiError(check.rules.errors[0].message, 422, 'regles');
  if (check.conflicts.length > 0) throw new ApiError(check.conflicts[0].message, 409, 'conflit');

  const slotChanged = start !== current.start || end !== current.end || roomId !== current.roomId;
  const updated = bookingStore.update(id, (item) => ({
    ...patch,
    start: toDate(start).toISOString(),
    end: toDate(end).toISOString(),
    roomId,
    // Tout changement d'horaire ou de salle régénère le code d'accès.
    accessCode: slotChanged ? generateAccessCode(buildingCodeOf(roomId)) : item.accessCode,
    history: [
      ...item.history,
      { type: 'modifiee', at: NOW.toISOString(), label: 'Réservation modifiée' },
    ],
  }));
  return withRoom(updated);
}

export async function cancelBooking(id, { reason, comment, notifyParticipants = true }) {
  await delay();
  if (!reason) throw new ApiError("Le motif d'annulation est obligatoire.", 422, 'motif_requis');
  const current = bookingStore.find((b) => b.id === id);
  if (!current) throw notFound('Réservation');
  if (current.status === 'annulee') throw new ApiError('Réservation déjà annulée.', 409, 'deja_annulee');

  const updated = bookingStore.update(id, (item) => ({
    status: 'annulee',
    accessCode: null,
    cancelReason: comment ? `${reason} — ${comment}` : reason,
    history: [
      ...item.history,
      {
        type: 'annulee',
        at: NOW.toISOString(),
        label: notifyParticipants ? 'Annulée, participants prévenus' : 'Annulée',
      },
    ],
  }));
  return withRoom(updated);
}

/** Réponse d'un invité (U-15). */
export async function respondToInvitation(bookingId, { email, response }) {
  await delay();
  const booking = bookingStore.find((b) => b.id === bookingId);
  if (!booking) throw notFound('Invitation');
  const updated = bookingStore.update(bookingId, (item) => ({
    participants: item.participants.map((participant) =>
      participant.email === email ? { ...participant, status: response } : participant,
    ),
  }));
  return withRoom(updated);
}

export async function listCancelReasons() {
  await delay(120);
  return clone(cancelReasons);
}
