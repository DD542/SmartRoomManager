// src/api/equipment.js
// Endpoint réel :
//   GET /api/v1/equipments   référentiel, avec le nombre de salles équipées

import * as adapt from './adapters';
import { collect } from './client';

export async function listEquipment({ signal } = {}) {
  return (await collect('/equipments', { signal })).map(adapt.equipment);
}
