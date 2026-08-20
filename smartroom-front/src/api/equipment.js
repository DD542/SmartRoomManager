// src/api/equipment.js
// Endpoint FastAPI cible :
//   GET /api/equipment   référentiel des équipements réservables

import { equipment } from '../mocks/equipment';
import { clone, delay } from './client';

export async function listEquipment() {
  await delay(150);
  return clone(equipment);
}
