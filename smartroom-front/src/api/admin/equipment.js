// src/api/admin/equipment.js
// Endpoints réels :
//   GET    /api/v1/equipments          référentiel, avec le nombre de salles équipées
//   POST   /api/v1/equipments          création
//   PATCH  /api/v1/equipments/{id}     modification
//   DELETE /api/v1/equipments/{id}     retrait, refusé si des salles l'utilisent
//   GET    /api/v1/rooms?equipment_ids= salles équipées, pour la fiche

import { EQUIPMENT_ICONS } from '../../components/rooms/equipmentIcons';
import * as adapt from '../adapters';
import { ApiError, abortable, collect, del, get, items, patch, post } from '../client';

const CATEGORIES = [
  { id: 'audiovisuel', label: 'Audiovisuel' },
  { id: 'mobilier', label: 'Mobilier' },
  { id: 'amenagement', label: 'Aménagement' },
];

export async function listEquipmentCatalog({ signal } = {}) {
  const lignes = await collect('/equipments', {
    signal: signal ?? abortable('admin:equipments'),
  });
  return lignes.map((item) => ({ ...adapt.equipment(item), roomCount: item.room_count }));
}

/** Fiche d'un équipement, avec les salles qui en disposent. */
export async function getEquipmentDetail(id, { signal } = {}) {
  const [catalogue, salles] = await Promise.all([
    listEquipmentCatalog({ signal }),
    get('/rooms', { params: { equipment_ids: [id], size: 100 }, signal }),
  ]);

  const item = catalogue.find((entree) => entree.id === id);
  if (!item) throw new ApiError('Équipement introuvable.', 404, 'introuvable');

  return {
    ...item,
    rooms: items(salles).map((salle) => ({
      id: salle.id,
      name: salle.name,
      status: salle.status,
    })),
  };
}

/** Icônes proposées par le sélecteur, tirées de la table utilisée par l'app. */
export async function listIcons() {
  return Object.keys(EQUIPMENT_ICONS);
}

/**
 * Le code sert de clé stable et n'est pas modifiable après création : il est
 * référencé par les filtres et les règles, et le changer casserait ces liens.
 */
const codeDepuis = (libelle) =>
  String(libelle)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

export async function saveEquipment(payload) {
  if (!payload.label?.trim()) {
    throw new ApiError('Le nom de l’équipement est obligatoire.', 422, 'nom_requis');
  }

  const commun = {
    label: payload.label.trim(),
    category: payload.category ?? 'audiovisuel',
    icon: payload.icon ?? 'Monitor',
    description: payload.description || null,
    is_filterable: Boolean(payload.filterable ?? true),
  };

  const data = payload.id
    ? await patch(`/equipments/${payload.id}`, commun)
    : await post('/equipments', { ...commun, code: codeDepuis(payload.label) });

  return { ...adapt.equipment(data), roomCount: data.room_count };
}

export async function toggleFilterable(id, filterable) {
  const data = await patch(`/equipments/${id}`, { is_filterable: Boolean(filterable) });
  return { ...adapt.equipment(data), roomCount: data.room_count };
}

/**
 * Retrait d'un équipement.
 *
 * Refusé par l'API tant qu'une salle le déclare : le supprimer sous les pieds
 * des salles équipées rendrait leur fiche fausse sans prévenir personne.
 */
export async function deleteEquipment(id) {
  await del(`/equipments/${id}`);
  return { id, deleted: true };
}

export const equipmentCategories = () => CATEGORIES.map((item) => ({ ...item }));
