// src/api/admin/rooms.js
// Endpoints FastAPI cibles :
//   GET    /api/admin/rooms            catalogue administrable
//   POST   /api/admin/rooms            création
//   PATCH  /api/admin/rooms/{id}       modification
//   POST   /api/admin/rooms/bulk       action groupée sur une sélection
//   DELETE /api/admin/rooms/{id}       archivage (jamais de suppression sèche)
//   GET    /api/admin/rooms/filters    référentiels de la barre de filtres
//   POST   /api/admin/rooms/{id}/photos    ajout d'un visuel
//   DELETE /api/admin/rooms/{id}/photos/{index}

import { rooms as seedRooms } from '../../mocks/rooms';
import { buildings } from '../../mocks/buildings';
import { equipmentById } from '../../mocks/equipment';
import { NOW, toDate } from '../../utils/dates';
import { normalize } from '../../utils/format';
import { ApiError, clone, createStore, delay, nextId } from '../client';
import { bookingStore } from '../bookings';

export const roomStore = createStore(seedRooms);

function decorate(room) {
  const reservations = bookingStore.filter(
    (booking) => booking.roomId === room.id && booking.status !== 'annulee',
  );
  return {
    ...room,
    building: clone(buildings.find((b) => b.id === room.buildingId)) ?? null,
    equipment: room.equipmentIds.map((id) => clone(equipmentById[id])).filter(Boolean),
    bookingCount: reservations.length,
    monthlyBookings: reservations.filter(
      (booking) => toDate(booking.start).getMonth() === NOW.getMonth(),
    ).length,
  };
}

export async function listManagedRooms(filters = {}) {
  await delay();
  const { buildingId, floor, status, minCapacity, equipment = [], query } = filters;

  return roomStore
    .all()
    .filter((room) => (buildingId ? room.buildingId === buildingId : true))
    .filter((room) => (floor ? room.floor === floor : true))
    .filter((room) => (status ? room.status === status : true))
    .filter((room) => (minCapacity ? room.capacity >= Number(minCapacity) : true))
    .filter((room) => equipment.every((id) => room.equipmentIds.includes(id)))
    .filter((room) => (query ? normalize(room.name).includes(normalize(query)) : true))
    .map(decorate);
}

export async function getManagedRoom(id) {
  await delay(200);
  const room = roomStore.find((item) => item.id === id);
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  return decorate(room);
}

/** Référentiels de la barre de filtres, dérivés du catalogue réel. */
export async function listRoomFilters() {
  await delay(150);
  const toutes = roomStore.all();
  return {
    // Le catalogue lui-même sert de référentiel aux écrans qui ciblent une
    // salle précise : portée d'une règle, périmètre d'une fermeture.
    rooms: toutes
      .map((room) => ({ value: room.id, label: room.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    buildings: buildings.map((batiment) => ({ value: batiment.id, label: batiment.name })),
    floors: [...new Set(toutes.map((room) => room.floor))]
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((etage) => ({ value: etage, label: etage })),
    statuses: [
      { value: 'disponible', label: 'Disponible' },
      { value: 'maintenance', label: 'En maintenance' },
      { value: 'archivee', label: 'Archivée' },
    ],
    capacities: [10, 20, 30].map((seuil) => ({ value: String(seuil), label: `${seuil} places ou +` })),
    equipment: Object.values(equipmentById).map((item) => ({
      value: item.id,
      label: item.label,
    })),
  };
}

function valider(payload, { partiel = false } = {}) {
  if (!partiel || payload.name !== undefined) {
    if (!payload.name?.trim()) throw new ApiError('Le nom est obligatoire.', 422, 'nom_requis');
  }
  if (payload.capacity !== undefined && Number(payload.capacity) < 1) {
    throw new ApiError('La capacité doit être d’au moins une personne.', 422, 'capacite');
  }
  if (payload.area !== undefined && Number(payload.area) < 1) {
    throw new ApiError('La surface doit être renseignée.', 422, 'surface');
  }
}

export async function createRoom(payload) {
  await delay();
  valider(payload);
  const room = {
    id: nextId('r'),
    name: payload.name.trim(),
    buildingId: payload.buildingId,
    floor: payload.floor,
    capacity: Number(payload.capacity),
    area: Number(payload.area),
    equipmentIds: payload.equipmentIds ?? [],
    accessible: Boolean(payload.accessible),
    badgeRequired: Boolean(payload.badgeRequired),
    status: payload.status ?? 'disponible',
    description: payload.description ?? '',
    photos: [],
    occupancyRate: 0,
    rules: payload.rules,
    plan: payload.plan ?? { x: 8, y: 8, w: 36, h: 30 },
  };
  return decorate(roomStore.insert(room));
}

export async function updateRoom(id, patch) {
  await delay();
  valider(patch, { partiel: true });
  const updated = roomStore.update(id, patch);
  if (!updated) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  return decorate(updated);
}

/**
 * Visuels de la salle. Les photos sont des data URI dans la maquette ; le back
 * renverra des URLs sur le même champ, la signature ne bouge pas.
 */
export async function addRoomPhoto(id, dataUrl) {
  await delay(400);
  const room = roomStore.find((item) => item.id === id);
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  if (room.photos.length >= 6) {
    throw new ApiError('Six visuels au maximum par salle.', 422, 'trop_de_photos');
  }
  return decorate(roomStore.update(id, { photos: [...room.photos, dataUrl] }));
}

export async function removeRoomPhoto(id, index) {
  await delay(200);
  const room = roomStore.find((item) => item.id === id);
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  if (room.photos.length <= 1) {
    throw new ApiError('Une salle doit conserver au moins un visuel.', 422, 'photo_requise');
  }
  return decorate(
    roomStore.update(id, { photos: room.photos.filter((_, position) => position !== index) }),
  );
}

/** Le premier visuel est celui des cartes et des listes : il se choisit. */
export async function setCoverPhoto(id, index) {
  await delay(200);
  const room = roomStore.find((item) => item.id === id);
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  const choisie = room.photos[index];
  if (!choisie) throw new ApiError('Visuel introuvable.', 404, 'introuvable');
  return decorate(
    roomStore.update(id, {
      photos: [choisie, ...room.photos.filter((_, position) => position !== index)],
    }),
  );
}

/**
 * Action groupée depuis la barre de sélection : mise en maintenance, changement
 * de bâtiment ou archivage. Une salle occupée ne peut pas être archivée.
 */
export async function bulkUpdateRooms(ids = [], action, value) {
  await delay();
  if (ids.length === 0) throw new ApiError('Aucune salle sélectionnée.', 422, 'selection_vide');

  const resultats = { traitees: [], ignorees: [] };
  for (const id of ids) {
    const room = roomStore.find((item) => item.id === id);
    if (!room) continue;

    if (action === 'archiver') {
      const aVenir = bookingStore.filter(
        (booking) =>
          booking.roomId === id && booking.status === 'confirmee' && toDate(booking.start) >= NOW,
      );
      if (aVenir.length > 0) {
        resultats.ignorees.push({ id, raison: `${aVenir.length} réservation(s) à venir` });
        continue;
      }
      roomStore.update(id, { status: 'archivee' });
    }
    if (action === 'maintenance') roomStore.update(id, { status: 'maintenance' });
    if (action === 'activer') roomStore.update(id, { status: 'disponible' });
    if (action === 'batiment') roomStore.update(id, { buildingId: value });

    resultats.traitees.push(id);
  }
  return resultats;
}
