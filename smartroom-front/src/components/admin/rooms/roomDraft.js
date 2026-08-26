/**
 * Brouillon d'édition d'une salle (A-06).
 *
 * Le formulaire ne manipule que les champs saisissables : occupation, nombre de
 * réservations et bâtiment décoré sont calculés côté API et repartiraient faux
 * s'ils étaient renvoyés tels quels.
 */

export const SALLE_VIERGE = {
  name: '',
  buildingId: '',
  // `floorId` et non `floor` : une salle se rattache à un étage identifié, pas
  // à une étiquette. Le champ était un texte libre, et la création échouait
  // systématiquement sur « L'étage est obligatoire » — aucune saisie ne pouvait
  // produire l'identifiant que l'API attend.
  floorId: '',
  floor: '',
  capacity: 8,
  area: 20,
  description: '',
  status: 'disponible',
  equipmentIds: [],
  accessible: false,
  badgeRequired: true,
  photos: [],
  locationPlanUrl: null,
  rules: {
    visitDays: [1, 2, 3, 4, 5],
    openTime: '08:00',
    closeTime: '20:00',
    minDurationMin: 30,
    maxDurationMin: 240,
    bufferMin: 15,
    constraints: [],
  },
};

export function versBrouillon(room) {
  return {
    name: room.name,
    buildingId: room.buildingId,
    floorId: room.floorId ?? '',
    floor: room.floor,
    capacity: room.capacity,
    area: room.area,
    description: room.description ?? '',
    status: room.status,
    equipmentIds: [...room.equipmentIds],
    accessible: room.accessible,
    badgeRequired: room.badgeRequired,
    photos: [...(room.photos ?? [])],
    locationPlanUrl: room.locationPlanUrl ?? null,
    occupancyRate: room.occupancyRate,
    rules: { ...room.rules, constraints: [...(room.rules?.constraints ?? [])] },
  };
}

/** Champs obligatoires, contrôlés avant l'appel pour éviter un aller-retour. */
export function validerSalle(draft) {
  const erreurs = {};
  if (!draft.name?.trim()) erreurs.name = 'Le nom est obligatoire.';
  if (!draft.buildingId) erreurs.buildingId = 'Le bâtiment est obligatoire.';
  if (!draft.floorId) erreurs.floorId = 'L’étage est obligatoire.';
  if (Number(draft.capacity) < 1) erreurs.capacity = 'Au moins une place.';
  if (Number(draft.area) < 1) erreurs.area = 'Surface obligatoire.';
  return erreurs;
}
