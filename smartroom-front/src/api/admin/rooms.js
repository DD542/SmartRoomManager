// src/api/admin/rooms.js
// Endpoints réels :
//   GET    /api/v1/rooms                        catalogue filtré et paginé
//   GET    /api/v1/rooms/filters                référentiels de la barre de filtres
//   POST   /api/v1/rooms                        création
//   PATCH  /api/v1/rooms/{id}                   modification partielle
//   POST   /api/v1/rooms/bulk                   action groupée
//   DELETE /api/v1/rooms/{id}                   archivage, jamais de suppression sèche
//   POST   /api/v1/rooms/{id}/photos            ajout d'un visuel
//   DELETE /api/v1/rooms/{id}/photos/{photo_id} retrait d'un visuel

import * as adapt from '../adapters';
import { ApiError, abortable, del, get, items, patch, post, put } from '../client';

/** Salle enrichie du décompte de réservations affiché dans la liste. */
async function decorer(salle, { signal } = {}) {
  const reservations = await get('/admin/bookings', {
    params: { room_id: salle.id, limit: 200 },
    signal,
  }).catch(() => []);

  const actives = reservations.filter((item) => item.status !== 'annulee');
  const moisCourant = new Date().getMonth();

  return {
    ...salle,
    building: { id: salle.buildingId, name: salle.buildingName },
    bookingCount: actives.length,
    monthlyBookings: actives.filter(
      (item) => new Date(item.slot.starts_at).getMonth() === moisCourant,
    ).length,
  };
}

export async function listManagedRooms(filters = {}) {
  const page = await get('/rooms', {
    params: {
      building_id: filters.buildingId || undefined,
      floor_id: filters.floorId || undefined,
      status: filters.status || undefined,
      min_capacity: filters.minCapacity || undefined,
      equipment_ids: filters.equipment?.length ? filters.equipment : undefined,
      q: filters.query || undefined,
      size: 100,
    },
    signal: abortable('admin:rooms'),
  });

  const salles = items(page).map(adapt.room);
  // L'étage est filtré ici quand l'écran passe un libellé plutôt qu'un
  // identifiant : la route ne connaît que l'identifiant, et rien ne garantit
  // que « 2e » désigne le même étage dans deux bâtiments.
  const parLibelle = filters.floor
    ? salles.filter((item) => item.floor === filters.floor)
    : salles;

  // Le décompte est demandé pour l'ensemble affiché, en parallèle : le faire
  // salle par salle à l'ouverture de chaque ligne rendrait le tri illisible.
  return Promise.all(parLibelle.map((salle) => decorer(salle)));
}

export async function getManagedRoom(id, { signal } = {}) {
  const salle = adapt.room(await get(`/rooms/${id}`, { signal }));
  return decorer(salle, { signal });
}

/** Référentiels de la barre de filtres, mesurés sur le catalogue réel. */
export async function listRoomFilters({ signal } = {}) {
  const [donnees, salles] = await Promise.all([
    get('/rooms/filters', { signal }),
    get('/rooms', { params: { size: 100 }, signal }),
  ]);

  return {
    // Le catalogue lui-même sert de référentiel aux écrans qui ciblent une
    // salle précise : portée d'une règle, périmètre d'une fermeture.
    rooms: items(salles)
      .map((item) => ({ value: item.id, label: item.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    buildings: donnees.buildings.map((item) => ({ value: item.id, label: item.name })),
    floors: donnees.floors.map((item) => ({ value: item.id, label: item.label })),
    statuses: [
      { value: 'disponible', label: 'Disponible' },
      { value: 'maintenance', label: 'En maintenance' },
      { value: 'archivee', label: 'Archivée' },
    ],
    capacities: [10, 20, 30].map((seuil) => ({
      value: String(seuil),
      label: `${seuil} places ou +`,
    })),
    equipment: donnees.equipments.map((item) => ({ value: item.id, label: item.label })),
  };
}

/** Le formulaire de l'écran vers le corps attendu par l'API. */
const corps = (form) => ({
  floor_id: form.floorId,
  name: form.name?.trim(),
  capacity: form.capacity === undefined ? undefined : Number(form.capacity),
  area_m2: form.area === undefined ? undefined : String(form.area),
  status: form.status,
  is_accessible: form.accessible,
  badge_required: form.badgeRequired,
  description: form.description,
  equipments: form.equipmentIds?.map((id) => ({ equipment_id: id, quantity: 1 })),
});

const sansIndefinis = (objet) =>
  Object.fromEntries(Object.entries(objet).filter(([, valeur]) => valeur !== undefined));

export async function createRoom(payload) {
  if (!payload.name?.trim()) throw new ApiError('Le nom est obligatoire.', 422, 'nom_requis');
  if (!payload.floorId) throw new ApiError('L’étage est obligatoire.', 422, 'etage_requis');

  const data = await post('/rooms', sansIndefinis(corps(payload)));
  return decorer(adapt.room(data));
}

export async function updateRoom(id, patchBody) {
  const data = await patch(`/rooms/${id}`, sansIndefinis(corps(patchBody)));
  return decorer(adapt.room(data));
}

/**
 * Ajout d'un visuel.
 *
 * L'écran fournit une data URI issue d'un `<input type="file">` ; elle est
 * décomposée ici en type et contenu, la forme qu'attend l'API. Le fichier part
 * encodé en base64 dans le corps JSON — le multipart aurait demandé une
 * dépendance de plus côté serveur.
 */
export async function addRoomPhoto(id, dataUrl, { altText } = {}) {
  const trouve = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl ?? ''));
  if (!trouve) throw new ApiError('Visuel illisible.', 422, 'visuel_invalide');

  await post(`/rooms/${id}/photos`, {
    file_name: 'photo',
    content_type: trouve[1],
    content: trouve[2],
    alt_text: altText ?? null,
  });
  return getManagedRoom(id);
}

export async function removeRoomPhoto(id, index) {
  const photos = await get(`/rooms/${id}/photos`);
  const cible = photos[index];
  if (!cible) throw new ApiError('Visuel introuvable.', 404, 'introuvable');
  if (photos.length <= 1) {
    throw new ApiError('Une salle doit conserver au moins un visuel.', 422, 'photo_requise');
  }

  await del(`/rooms/${id}/photos/${cible.id}`);
  return getManagedRoom(id);
}

/**
 * Ordre des visuels.
 *
 * La liste envoyée est complète : réordonner à partir d'un sous-ensemble
 * laisserait les photos absentes sur des positions arbitraires, et la salle
 * perdrait silencieusement des visuels.
 */
export async function reorderRoomPhotos(id, photoIds) {
  await put(`/rooms/${id}/photos/order`, { photo_ids: [...photoIds] });
  return getManagedRoom(id);
}

/** Le premier visuel est celui des cartes et des listes : il se choisit. */
export async function setCoverPhoto(id, index) {
  const photos = await get(`/rooms/${id}/photos`);
  const choisi = photos[index];
  if (!choisi) throw new ApiError('Visuel introuvable.', 404, 'introuvable');
  if (index === 0) return getManagedRoom(id);

  return reorderRoomPhotos(id, [
    choisi.id,
    ...photos.filter((_, position) => position !== index).map((item) => item.id),
  ]);
}

/**
 * Action groupée.
 *
 * Chaque salle est traitée indépendamment côté serveur : une seule en échec —
 * une salle archivable qui porte encore des réservations — n'annule pas les
 * autres, et la réponse dit laquelle a échoué et pourquoi.
 */
export async function bulkUpdateRooms(ids = [], action, value) {
  if (ids.length === 0) throw new ApiError('Aucune salle sélectionnée.', 422, 'selection_vide');

  const corpsAction = {
    archiver: { action: 'archive' },
    maintenance: { action: 'status', status: 'maintenance' },
    activer: { action: 'status', status: 'disponible' },
    accessible: { action: 'accessible', value: Boolean(value) },
    badge: { action: 'badge', value: Boolean(value) },
  }[action];

  if (!corpsAction) {
    // « Changer de bâtiment » n'est pas une action groupée : une salle
    // appartient à un étage, et deux bâtiments n'ont pas les mêmes.
    throw new ApiError('Action groupée inconnue.', 422, 'action_invalide');
  }

  const data = await post('/rooms/bulk', { room_ids: ids, ...corpsAction });
  return {
    traitees: data.succeeded,
    ignorees: data.failed.map((item) => ({ id: item.room_id, raison: item.message })),
  };
}
