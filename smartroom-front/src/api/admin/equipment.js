// src/api/admin/equipment.js
// Endpoints FastAPI cibles :
//   GET   /api/admin/equipment          catalogue avec le nombre de salles équipées
//   POST  /api/admin/equipment          création
//   PATCH /api/admin/equipment/{id}     modification, dont l'icône et le filtrage

import { equipment as seedEquipment } from '../../mocks/equipment';
import { EQUIPMENT_ICONS } from '../../components/rooms/equipmentIcons';
import { ApiError, clone, createStore, delay, nextId } from '../client';
import { roomStore } from './rooms';

/** Le référentiel s'enrichit d'un descriptif et d'un indicateur de filtrage. */
const store = createStore(
  seedEquipment.map((item) => ({
    ...item,
    description: '',
    filterable: ['eq-visio', 'eq-screen4k', 'eq-whiteboard', 'eq-projector'].includes(item.id),
  })),
);

const equipees = (equipmentId) =>
  roomStore.filter((room) => room.equipmentIds.includes(equipmentId));

export async function listEquipmentCatalog() {
  await delay();
  return store.all().map((item) => ({
    ...item,
    roomCount: equipees(item.id).length,
  }));
}

export async function getEquipmentDetail(id) {
  await delay(200);
  const item = store.find((entry) => entry.id === id);
  if (!item) throw new ApiError('Équipement introuvable.', 404, 'introuvable');
  return {
    ...item,
    rooms: equipees(id).map((room) => ({ id: room.id, name: room.name, status: room.status })),
  };
}

/** Icônes proposées par le sélecteur, tirées de la table déjà utilisée par l'app. */
export async function listIcons() {
  await delay(100);
  return Object.keys(EQUIPMENT_ICONS);
}

export async function saveEquipment(payload) {
  await delay();
  if (!payload.label?.trim()) {
    throw new ApiError('Le nom de l’équipement est obligatoire.', 422, 'nom_requis');
  }

  if (payload.id) {
    const updated = store.update(payload.id, {
      label: payload.label.trim(),
      category: payload.category,
      icon: payload.icon,
      description: payload.description ?? '',
      filterable: Boolean(payload.filterable),
    });
    if (!updated) throw new ApiError('Équipement introuvable.', 404, 'introuvable');
    return updated;
  }

  return store.insert({
    id: nextId('eq'),
    label: payload.label.trim(),
    category: payload.category ?? 'av',
    icon: payload.icon ?? 'Monitor',
    description: payload.description ?? '',
    filterable: Boolean(payload.filterable),
  });
}

export async function toggleFilterable(id, filterable) {
  await delay(200);
  const updated = store.update(id, { filterable });
  if (!updated) throw new ApiError('Équipement introuvable.', 404, 'introuvable');
  return updated;
}

export const equipmentCategories = () =>
  clone([
    { id: 'av', label: 'Audiovisuel' },
    { id: 'mobilier', label: 'Mobilier' },
    { id: 'confort', label: 'Aménagement' },
  ]);
