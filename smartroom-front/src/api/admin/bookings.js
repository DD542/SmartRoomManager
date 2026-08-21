// src/api/admin/bookings.js
// Endpoints FastAPI cibles :
//   GET  /api/admin/bookings?from=&to=&room=&building=&user=&status=&source=
//   POST /api/admin/bookings           réservation créée au nom d'un utilisateur
//   POST /api/admin/bookings/blocking  blocage administratif d'une salle
//   GET  /api/admin/bookings/{id}      détail d'une réservation
//   POST /api/admin/bookings/{id}/cancel  annulation par l'administration
//   POST /api/admin/bookings/cancel    annulation groupée
//   GET  /api/admin/bookings/filters   référentiels des filtres de la liste

import { bookingStore, evaluateSlot } from '../bookings';
import { roomById, rooms } from '../../mocks/rooms';
import { buildings } from '../../mocks/buildings';
import { userById, users } from '../../mocks/users';
import { NOW, toDate } from '../../utils/dates';
import { normalize } from '../../utils/format';
import { ApiError, clone, delay, generateAccessCode, nextId } from '../client';

/** Origine de la réservation, affichée en colonne « Source ». */
function sourceOf(booking) {
  if (booking.adminCreated) return booking.blocking ? 'blocage' : 'admin';
  return booking.seriesId ? 'recurrente' : 'utilisateur';
}

function decorate(booking) {
  const room = roomById[booking.roomId];
  const owner = userById[booking.ownerId];
  const past = toDate(booking.end) < NOW;
  return {
    ...booking,
    room: room ? clone(room) : null,
    building: room ? clone(buildings.find((b) => b.id === room.buildingId)) : null,
    owner: owner ? { id: owner.id, firstName: owner.firstName, lastName: owner.lastName } : null,
    source: sourceOf(booking),
    // La présence n'a de sens qu'une fois le créneau passé, et jamais pour un
    // blocage administratif : personne n'est censé s'y présenter.
    attendance:
      booking.status === 'annulee' || booking.blocking
        ? null
        : past
          ? booking.checkedIn
            ? 'presente'
            : 'absente'
          : 'attendue',
  };
}

/**
 * Toutes les réservations, toutes salles et tous utilisateurs confondus.
 * Le filtrage reste côté API : l'écran n'a qu'à passer ses critères.
 */
export async function listAllBookings(filters = {}) {
  await delay();
  const { from, to, roomId, buildingId, userId, status, source, query } = filters;

  return bookingStore
    .all()
    .filter((b) => (from ? toDate(b.end) >= toDate(from) : true))
    .filter((b) => (to ? toDate(b.start) <= toDate(to) : true))
    .filter((b) => (roomId ? b.roomId === roomId : true))
    .filter((b) => (buildingId ? roomById[b.roomId]?.buildingId === buildingId : true))
    .filter((b) => (userId ? b.ownerId === userId : true))
    .filter((b) => (status ? b.status === status : true))
    .map(decorate)
    .filter((b) => (source ? b.source === source : true))
    .filter((b) =>
      query
        ? normalize(`${b.title} ${b.room?.name ?? ''} ${b.owner?.lastName ?? ''}`).includes(
            normalize(query),
          )
        : true,
    )
    .sort((a, b) => toDate(b.start) - toDate(a.start));
}

export async function getAdminBooking(id) {
  await delay();
  const booking = bookingStore.find((item) => item.id === id);
  if (!booking) throw new ApiError('Réservation introuvable.', 404, 'introuvable');
  return decorate(booking);
}

/** Référentiels des filtres, pour ne pas les recopier dans l'écran. */
export async function listBookingFilters() {
  await delay(150);
  return {
    // Tout le catalogue, pas seulement les salles déjà réservées : la même
    // liste sert au filtre et au formulaire de création.
    rooms: rooms
      .map((room) => ({ value: room.id, label: room.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    buildings: buildings.map((b) => ({ value: b.id, label: b.name })),
    statuses: [
      { value: 'confirmee', label: 'Confirmée' },
      { value: 'terminee', label: 'Terminée' },
      { value: 'annulee', label: 'Annulée' },
    ],
    sources: [
      { value: 'utilisateur', label: 'Utilisateur' },
      { value: 'admin', label: 'Administration' },
      { value: 'recurrente', label: 'Récurrente' },
      { value: 'blocage', label: 'Blocage' },
    ],
  };
}

/**
 * Annulation par l'administration. Le motif est obligatoire, comme côté
 * utilisateur : une réservation annulée sans raison est ingérable au support.
 */
export async function cancelAdminBooking(id, { reason, notifyOwner = true } = {}) {
  await delay();
  if (!reason?.trim()) {
    throw new ApiError('Le motif d’annulation est obligatoire.', 422, 'motif_requis');
  }
  const current = bookingStore.find((item) => item.id === id);
  if (!current) throw new ApiError('Réservation introuvable.', 404, 'introuvable');
  if (current.status === 'annulee') {
    throw new ApiError('Réservation déjà annulée.', 409, 'deja_annulee');
  }
  if (toDate(current.end) < NOW) {
    throw new ApiError('Une réservation passée ne peut plus être annulée.', 409, 'deja_passee');
  }

  const updated = bookingStore.update(id, (item) => ({
    status: 'annulee',
    accessCode: null,
    cancelReason: reason.trim(),
    history: [
      ...item.history,
      {
        type: 'annulee',
        at: NOW.toISOString(),
        label: notifyOwner
          ? 'Annulée par l’administration, organisateur prévenu'
          : 'Annulée par l’administration',
      },
    ],
  }));
  return decorate(updated);
}

/**
 * Annulation groupée. Les lignes déjà annulées ou passées sont ignorées plutôt
 * que de faire échouer tout le lot : le retour dit précisément ce qui a été fait.
 */
export async function cancelBookings(ids = [], { reason, notifyOwner = true } = {}) {
  if (!reason?.trim()) {
    throw new ApiError('Le motif d’annulation est obligatoire.', 422, 'motif_requis');
  }
  await delay();

  const annulees = [];
  const ignorees = [];
  for (const id of ids) {
    const item = bookingStore.find((b) => b.id === id);
    if (!item) continue;
    if (item.status === 'annulee' || toDate(item.end) < NOW) {
      ignorees.push({ id, motif: item.status === 'annulee' ? 'déjà annulée' : 'déjà passée' });
      continue;
    }
    bookingStore.update(id, (current) => ({
      status: 'annulee',
      accessCode: null,
      cancelReason: reason.trim(),
      history: [
        ...current.history,
        {
          type: 'annulee',
          at: NOW.toISOString(),
          label: notifyOwner
            ? 'Annulée par l’administration, organisateur prévenu'
            : 'Annulée par l’administration',
        },
      ],
    }));
    annulees.push(id);
  }
  return { annulees, ignorees };
}

/**
 * Vérification d'un créneau avant création, pour que le formulaire annonce le
 * conflit avant l'envoi plutôt qu'après le refus. Même moteur que le tunnel
 * utilisateur : les deux écrans ne peuvent pas diverger.
 */
export async function checkAdminSlot({ roomId, start, end, attendees = 1 }) {
  await delay();
  const room = roomById[roomId];
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');

  const verdict = evaluateSlot({ roomId, start, end });
  const capacite =
    attendees > room.capacity
      ? `Capacité dépassée : ${room.capacity} places pour ${attendees} personnes.`
      : null;

  return {
    conflicts: verdict.conflicts,
    // Un conflit ne se force jamais ; les règles et la capacité, si.
    blocking: verdict.conflicts.some((conflict) => conflict.blocking),
    ruleErrors: verdict.rules.ok ? [] : verdict.rules.errors,
    capacityError: capacite,
    forcable: !verdict.conflicts.some((conflict) => conflict.blocking),
    alternatives: verdict.alternatives,
  };
}

export async function listBookableUsers() {
  await delay(150);
  return users
    .filter((user) => user.role !== 'gestionnaire')
    .map((user) => ({
      id: user.id,
      // La promotion n'est pas renseignée pour le personnel : inutile d'afficher
      // un tiret orphelin derrière leur nom.
      label:
        user.promotion && user.promotion !== '—'
          ? `${user.firstName} ${user.lastName} — ${user.promotion}`
          : `${user.firstName} ${user.lastName}`,
    }));
}

/**
 * Création par un administrateur, pour le compte d'un utilisateur.
 * `ignoreRules` force la réservation malgré les règles de durée ou de quota,
 * mais jamais malgré un conflit : deux réunions ne peuvent pas se superposer.
 */
export async function createAdminBooking(payload) {
  await delay();
  const { roomId, start, end, ownerId, title, attendees, ignoreRules = false } = payload;
  const room = roomById[roomId];
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');

  const verdict = evaluateSlot({ roomId, start, end });
  if (verdict.conflicts.some((conflict) => conflict.blocking)) {
    throw new ApiError(verdict.conflicts[0].message, 409, 'conflit');
  }
  if (!verdict.rules.ok && !ignoreRules) {
    throw new ApiError(
      `${verdict.rules.errors[0].message} Cochez « ignorer les règles » pour forcer.`,
      422,
      'regles',
    );
  }
  if (attendees > room.capacity && !ignoreRules) {
    throw new ApiError(
      `Capacité dépassée : ${room.capacity} places pour ${attendees} personnes.`,
      422,
      'capacite',
    );
  }

  const booking = {
    id: nextId('bk'),
    roomId,
    ownerId,
    title: title?.trim() || 'Réservation administrative',
    start: toDate(start).toISOString(),
    end: toDate(end).toISOString(),
    attendees: Number(attendees) || 1,
    requiredEquipmentIds: [],
    status: 'confirmee',
    accessCode: generateAccessCode(buildings.find((b) => b.id === room.buildingId)?.code ?? 'A'),
    checkedIn: false,
    participants: [],
    recurrence: null,
    seriesId: null,
    cancelReason: null,
    adminCreated: true,
    blocking: false,
    forced: ignoreRules,
    history: [
      { type: 'creee', at: NOW.toISOString(), label: 'Créée par l’administration' },
      { type: 'confirmee', at: NOW.toISOString(), label: 'Confirmée' },
    ],
  };
  return decorate(bookingStore.insert(booking));
}

/** Blocage administratif : la salle est rendue indisponible, sans utilisateur. */
export async function createBlocking({ roomId, start, end, reason }) {
  await delay();
  if (!reason?.trim()) {
    throw new ApiError('Le motif du blocage est obligatoire.', 422, 'motif_requis');
  }
  const verdict = evaluateSlot({ roomId, start, end });
  if (verdict.conflicts.some((conflict) => conflict.blocking)) {
    throw new ApiError(verdict.conflicts[0].message, 409, 'conflit');
  }

  const blocage = {
    id: nextId('blk'),
    roomId,
    ownerId: null,
    title: reason.trim(),
    start: toDate(start).toISOString(),
    end: toDate(end).toISOString(),
    attendees: 0,
    requiredEquipmentIds: [],
    status: 'confirmee',
    accessCode: null,
    checkedIn: false,
    participants: [],
    recurrence: null,
    seriesId: null,
    cancelReason: null,
    adminCreated: true,
    blocking: true,
    history: [{ type: 'creee', at: NOW.toISOString(), label: 'Blocage administratif' }],
  };
  return decorate(bookingStore.insert(blocage));
}
