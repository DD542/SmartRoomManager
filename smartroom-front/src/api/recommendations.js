// src/api/recommendations.js
// Endpoints FastAPI cibles :
//   POST /api/recommendations   corps = besoin (date, capacité, équipements, bâtiment)
//   GET  /api/recommendations/best?attendees=&building=

import { rooms } from '../mocks/rooms';
import { equipmentById } from '../mocks/equipment';
import { buildings } from '../mocks/buildings';
import { bestRoom, rankRooms } from '../utils/recommendation';
import { delay } from './client';

const decorate = (entry) => ({
  ...entry,
  room: {
    ...entry.room,
    building: buildings.find((b) => b.id === entry.room.buildingId) ?? null,
    equipment: entry.room.equipmentIds.map((id) => equipmentById[id]).filter(Boolean),
  },
});

/**
 * Classement des salles pour un besoin. Le score et sa justification sont
 * calculés par utils/recommendation.js : aucun texte figé côté écran.
 */
export async function recommendRooms(need = {}) {
  await delay();
  const pool = rooms.filter((room) => room.status !== 'maintenance' || need.includeMaintenance);
  return rankRooms(pool, need).map(decorate);
}

/** Meilleure salle éligible : dashboard, chatbot, résolution de conflit. */
export async function recommendBest(need = {}) {
  await delay();
  const best = bestRoom(rooms.filter((r) => r.status !== 'maintenance'), need);
  return best ? decorate(best) : null;
}
