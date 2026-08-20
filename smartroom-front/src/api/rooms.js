// src/api/rooms.js
// Endpoints FastAPI cibles :
//   GET /api/rooms?capacity=&building=&equipment=&floor=&available=   liste filtrée
//   GET /api/rooms/{id}                                               détail
//   GET /api/rooms/{id}/occupancy                                     taux d'occupation

import { rooms as seed, roomById } from '../mocks/rooms';
import { equipmentById } from '../mocks/equipment';
import { buildings } from '../mocks/buildings';
import { NOW, toDate } from '../utils/dates';
import { normalize } from '../utils/format';
import { clone, delay, notFound } from './client';
import { bookingStore } from './bookings';

/** Statut instantané : la maintenance prime, sinon on regarde les réservations. */
function liveStatus(room, at = NOW) {
  if (room.status === 'maintenance') return 'maintenance';
  const busy = bookingStore
    .filter((b) => b.roomId === room.id && b.status === 'confirmee')
    .some((b) => toDate(b.start) <= at && at < toDate(b.end));
  return busy ? 'occupee' : 'disponible';
}

const decorate = (room) => ({
  ...room,
  status: liveStatus(room),
  building: buildings.find((b) => b.id === room.buildingId) ?? null,
  equipment: room.equipmentIds.map((id) => equipmentById[id]).filter(Boolean),
});

export async function listRooms(filters = {}) {
  await delay();
  const { capacity, building, buildings: buildingIds, equipment = [], floors = [], accessible, query, availableNow } =
    filters;

  return seed
    .filter((room) => {
      if (capacity && room.capacity < capacity) return false;
      if (building && room.buildingId !== building) return false;
      if (buildingIds?.length && !buildingIds.includes(room.buildingId)) return false;
      if (floors.length && !floors.includes(room.floor)) return false;
      if (accessible && !room.accessible) return false;
      if (equipment.length && !equipment.every((id) => room.equipmentIds.includes(id))) return false;
      if (query && !normalize(room.name).includes(normalize(query))) return false;
      if (availableNow && liveStatus(room) !== 'disponible') return false;
      return true;
    })
    .map(decorate);
}

export async function getRoom(id) {
  await delay();
  const room = roomById[id];
  if (!room) throw notFound('Salle');
  return decorate(clone(room));
}

/** Occupation hebdomadaire, en pourcentage, pour la barre des cartes de salle. */
export async function getOccupancy(id) {
  await delay(200);
  const room = roomById[id];
  if (!room) throw notFound('Salle');
  return { roomId: id, rate: room.occupancyRate };
}

/** Salles favorites du dashboard : les plus réservées par l'utilisateur. */
export async function listFavoriteRooms(ownerId) {
  await delay();
  const counts = bookingStore
    .filter((b) => b.ownerId === ownerId && b.status !== 'annulee')
    .reduce((acc, b) => ({ ...acc, [b.roomId]: (acc[b.roomId] ?? 0) + 1 }), {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([roomId]) => decorate(clone(roomById[roomId])));
}
