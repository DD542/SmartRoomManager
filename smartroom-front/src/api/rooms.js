// src/api/rooms.js
// Endpoints réels :
//   GET /api/v1/rooms                       parc filtré et paginé
//   GET /api/v1/rooms/filters               valeurs proposées par les filtres
//   GET /api/v1/rooms/{id}                  fiche complète
//   GET /api/v1/rooms/{id}/booking-rules    règles effectivement appliquées
//   GET /api/v1/availability/rooms/{id}/free-slots
//   GET /api/v1/admin/stats/rooms           occupation observée

import * as adapt from './adapters';
import { abortable, collect, get, items } from './client';

/**
 * Parc filtré.
 *
 * `available` était un filtre du temps des données simulées : la disponibilité
 * dépend d'un créneau, pas d'une salle. Les écrans qui la demandent passent par
 * `availability.searchRooms`, qui interroge le moteur.
 */
export async function listRooms({
  capacity,
  building,
  floor,
  equipment = [],
  accessibleOnly = false,
  status,
  query,
  signal,
} = {}) {
  const page = await get('/rooms', {
    params: {
      min_capacity: capacity,
      building_id: building,
      floor_id: floor,
      equipment_ids: equipment,
      accessible_only: accessibleOnly || undefined,
      status,
      q: query,
      size: 100,
    },
    signal: signal ?? abortable('rooms:list'),
  });
  return items(page).map(adapt.room);
}

/**
 * Fiche complète : la salle, son bâtiment et les règles qui s'y appliquent.
 *
 * Trois appels parallèles plutôt qu'un : la salle, le bâtiment et les règles
 * sont trois ressources distinctes côté serveur, et les fusionner dans une
 * réponse unique obligerait tous les autres appelants à charger ce dont ils
 * n'ont pas besoin. L'écran, lui, veut un seul objet — la couture est faite ici.
 */
export async function getRoom(roomId, { signal } = {}) {
  const salle = adapt.room(await get(`/rooms/${roomId}`, { signal }));
  const [batiment, regles] = await Promise.all([
    get(`/buildings/${salle.buildingId}`, { signal }).then(adapt.building),
    getRoomRules(roomId, { signal }),
  ]);
  return { ...salle, building: batiment, rules: regles };
}

/** Valeurs proposées par les filtres, mesurées sur le parc réel. */
export async function getRoomFilters({ signal } = {}) {
  const data = await get('/rooms/filters', { signal });
  return {
    buildings: data.buildings.map(adapt.building),
    floors: data.floors.map(adapt.floor),
    equipment: data.equipments.map(adapt.equipment),
    statuses: data.statuses,
    capacityMin: data.capacity_min,
    capacityMax: data.capacity_max,
  };
}

/**
 * Règles applicables à une salle.
 *
 * Deux référentiels côté serveur — contraintes de réservation et amplitude
 * d'ouverture — recousus en un seul objet, celui dont parlent les écrans.
 */
export async function getRoomRules(roomId, { signal } = {}) {
  const [contraintes, horaires] = await Promise.all([
    get(`/rooms/${roomId}/booking-rules`, { signal }),
    get(`/rooms/${roomId}/opening-hours`, { signal }),
  ]);
  return adapt.roomRules(contraintes, horaires.map(adapt.openingWindow));
}

/**
 * Créneaux libres d'une salle sur une période.
 *
 * Le battement et les fermetures sont déjà déduits côté serveur : ce que
 * l'écran affiche est réservable tel quel, pas « probablement libre ».
 */
export async function getRoomAvailability(roomId, { from, to, signal } = {}) {
  const data = await get(`/availability/rooms/${roomId}/free-slots`, {
    params: {
      first_day: from,
      last_day: to ?? from,
    },
    signal: signal ?? abortable(`rooms:slots:${roomId}`),
  });
  return {
    roomId: data.room_id,
    from: data.first_day,
    to: data.last_day,
    slots: data.slots.map(adapt.slotOut),
  };
}

/** Occupation observée d'une salle, sur les trente derniers jours. */
export async function getRoomOccupancy(roomId, { signal } = {}) {
  const lignes = await get('/admin/stats/rooms', { params: { limit: 200 }, signal });
  const vise = lignes.find((item) => item.room_id === roomId);
  return vise
    ? {
        roomId,
        occupancyRate: vise.occupancy_percent / 100,
        hours: vise.hours,
        bookings: vise.bookings,
        noShows: vise.no_shows,
      }
    : { roomId, occupancyRate: 0, hours: 0, bookings: 0, noShows: 0 };
}

/** Parc complet, pour les écrans qui ont besoin de tout le catalogue. */
export async function allRooms({ signal } = {}) {
  return (await collect('/rooms', { signal })).map(adapt.room);
}

/**
 * Salles les plus réservées par le compte connecté.
 *
 * Déduites de mes réservations plutôt que d'une liste de favoris à cocher : un
 * favori explicite se périme dès que les habitudes changent, alors que l'usage
 * réel, lui, est toujours à jour.
 */
export async function listFavoriteRooms(_ownerId, { limit = 2, signal } = {}) {
  const lignes = await collect('/bookings', { params: { size: 100 }, signal });

  const comptes = new Map();
  lignes
    .filter((item) => item.status !== 'annulee')
    .forEach((item) => comptes.set(item.room_id, (comptes.get(item.room_id) ?? 0) + 1));

  const meilleures = [...comptes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([roomId]) => roomId);

  return Promise.all(meilleures.map((roomId) => getRoom(roomId, { signal })));
}
