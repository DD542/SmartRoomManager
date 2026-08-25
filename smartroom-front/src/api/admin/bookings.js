// src/api/admin/bookings.js
// Endpoints réels :
//   GET  /api/v1/admin/bookings                réservations, tous comptes confondus
//   POST /api/v1/admin/bookings                réserver pour un utilisateur
//   POST /api/v1/admin/bookings/{id}/cancel    annuler la réservation d'un tiers
//   POST /api/v1/admin/blockings               bloquer une salle
//   POST /api/v1/availability/rooms/{id}/check vérifier un créneau avant d'écrire
//   GET  /api/v1/admin/users                   organisateurs sélectionnables

import * as adapt from '../adapters';
import { abortable, collect, get, items, post } from '../client';

const iso = (valeur) => (valeur instanceof Date ? valeur.toISOString() : valeur);

export async function listAllBookings(filters = {}) {
  // `collect` et non une page unique : l'écran pagine côté client sur
  // l'ensemble chargé, et demander une seule page de cent lignes en cacherait
  // silencieusement le reste — l'utilisateur croirait voir tout le parc.
  // Le plafond de `collect` borne la dépense ; la taille de page maximale est
  // de cent, la demander plus grande rend 422.
  const lignes = (
    await collect('/admin/bookings', {
      params: {
        room_id: filters.roomId,
        building_id: filters.buildingId,
        owner_id: filters.ownerId,
        status: filters.status,
        from_date: iso(filters.from),
        to_date: iso(filters.to),
      },
      signal: abortable('admin:bookings'),
      max: filters.max ?? 500,
    })
  ).map(adapt.booking);
  const q = (filters.query ?? '').trim().toLowerCase();
  // Le terme libre est appliqué ici : la route filtre sur des identifiants, et
  // ajouter une recherche plein texte sur un titre saisi libre n'apporterait
  // rien qu'un filtre côté écran ne fasse aussi bien sur deux cents lignes.
  return q
    ? lignes.filter((item) =>
        `${item.title} ${item.roomName ?? ''} ${item.owner?.firstName ?? ''}`
          .toLowerCase()
          .includes(q),
      )
    : lignes;
}

export async function getAdminBooking(id, { signal } = {}) {
  return adapt.booking(await get(`/bookings/${id}`, { signal }));
}

/** Valeurs proposées par les filtres de l'écran, mesurées sur le parc réel. */
export async function listBookingFilters({ signal } = {}) {
  const [batiments, salles] = await Promise.all([
    get('/buildings', { signal }),
    get('/rooms', { params: { size: 100 }, signal }),
  ]);

  // `{ value, label }` et non `{ id, name }` : ces listes alimentent
  // directement `FilterBar`, qui lit `option.value` pour la valeur du
  // `<option>` **et** pour sa clé React. Une clé absente rend toutes les
  // options indistinguables et les sélecteurs inutilisables.
  return {
    buildings: batiments.map((item) => ({ value: item.id, label: item.name })),
    rooms: items(salles).map((item) => ({ value: item.id, label: item.name })),
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

export async function cancelAdminBooking(id, { reason, notifyOwner = true } = {}) {
  const data = await post(`/admin/bookings/${id}/cancel`, {
    reason: reason?.trim() || 'Annulation par l’administration',
  });
  // `notifyOwner` reste un choix d'écran : le serveur notifie toujours le
  // titulaire, et lui retirer sa salle sans le prévenir n'est pas une option
  // qu'une API devrait offrir.
  return { ...adapt.booking(data), notified: notifyOwner };
}

/**
 * Annulation groupée.
 *
 * Chaque réservation est traitée séparément : une seule en échec — déjà
 * annulée, déjà écoulée — ne doit pas retenir les autres, et la réponse dit
 * laquelle a échoué.
 */
export async function cancelBookings(ids = [], { reason, notifyOwner = true } = {}) {
  const resultats = await Promise.allSettled(
    ids.map((id) => cancelAdminBooking(id, { reason, notifyOwner })),
  );

  return {
    succeeded: resultats.filter((item) => item.status === 'fulfilled').map((item) => item.value),
    failed: resultats
      .map((item, index) => ({ item, id: ids[index] }))
      .filter(({ item }) => item.status === 'rejected')
      .map(({ item, id }) => ({ id, reason: item.reason?.message ?? 'Échec' })),
  };
}

export async function checkAdminSlot({ roomId, start, end, attendees = 1 }) {
  const data = await post(`/availability/rooms/${roomId}/check`, {
    slot: adapt.slotIn(start, end),
    attendees,
  });
  const verdict = adapt.slotCheck(data);
  return {
    ...verdict,
    ok: verdict.available,
    // Un administrateur peut lever les règles, jamais un chevauchement : la
    // contrainte d'exclusion le refuse au niveau base, quelle que soit la
    // permission de l'appelant.
    blocking: verdict.conflicts.filter((item) => item.blocking),
  };
}

/** Organisateurs sélectionnables : l'annuaire, filtré aux comptes actifs. */
export async function listBookableUsers({ query, signal } = {}) {
  const page = await get('/admin/users', {
    params: { q: query, status: 'actif', size: 100 },
    signal: signal ?? abortable('admin:bookable-users'),
  });
  return items(page).map((item) => ({
    id: item.id,
    firstName: item.first_name,
    lastName: item.last_name,
    email: item.email,
    department: item.department,
  }));
}

export async function createAdminBooking(payload) {
  const data = await post('/admin/bookings', {
    room_id: payload.roomId,
    owner_id: payload.ownerId,
    slot: adapt.slotIn(payload.start, payload.end),
    title: payload.title?.trim() || 'Réservation administrative',
    attendees: payload.attendees ?? 1,
    ignore_rules: Boolean(payload.ignoreRules ?? payload.force),
  });
  return adapt.booking(data);
}

/**
 * Blocage d'une salle.
 *
 * C'est une réservation sans organisateur, exemptée des bornes de durée —
 * fermer une salle pour travaux dure la journée — mais pas du conflit.
 */
export async function createBlocking({ roomId, start, end, reason }) {
  const data = await post('/admin/blockings', {
    room_id: roomId,
    slot: adapt.slotIn(start, end),
    reason: reason?.trim() || 'Salle indisponible',
  });
  return adapt.booking(data);
}
