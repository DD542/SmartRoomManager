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
import { ApiError, abortable, del, enBase64, get, items, patch, post, put } from '../client';
import { TAILLE_MAX_MO } from '../buildings';

/**
 * Salle telle que l'attend l'écran d'administration.
 *
 * Le décompte de réservations vient désormais de la fiche elle-même. Il était
 * auparavant lu par un appel à `/admin/bookings` **par salle** : une requête
 * par ligne affichée, et un 403 pour l'administrateur qui n'a que la
 * permission du parc — cette route exigeant celle d'arbitrage.
 */
function decorer(salle) {
  const moisCourant = new Date().getMonth();
  return {
    ...salle,
    building: { id: salle.buildingId, name: salle.buildingName },
    bookingCount: salle.bookingCount,
    // Le détail par mois n'est pas servi par la fiche : la colonne du tableau
    // n'affiche que le total, et inventer un sous-total serait pire que de ne
    // pas l'afficher.
    monthlyBookings: null,
    mois: moisCourant,
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

  return parLibelle.map(decorer);
}

export async function getManagedRoom(id, { signal } = {}) {
  return decorer(adapt.room(await get(`/rooms/${id}`, { signal })));
}

/** Référentiels de la barre de filtres, mesurés sur le catalogue réel. */
export async function listRoomFilters({ signal } = {}) {
  const [donnees, salles] = await Promise.all([
    get('/rooms/filters', { signal }),
    get('/rooms', { params: { size: 100 }, signal }),
  ]);

  const nomBatiment = new Map(donnees.buildings.map((item) => [item.id, item.name]));

  return {
    // Le catalogue lui-même sert de référentiel aux écrans qui ciblent une
    // salle précise : portée d'une règle, périmètre d'une fermeture.
    rooms: items(salles)
      .map((item) => ({ value: item.id, label: item.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    buildings: donnees.buildings.map((item) => ({ value: item.id, label: item.name })),
    // Chaque bâtiment a son « 1er étage » : la seule étiquette d'étage produit
    // autant d'entrées homonymes que de bâtiments, indiscernables au choix. Le
    // bâtiment porteur les sépare, et l'ordre suit la hiérarchie réelle du parc
    // plutôt que celui, arbitraire, du référentiel.
    floors: donnees.floors
      .map((item) => ({
        value: item.id,
        label: `${nomBatiment.get(item.building_id) ?? 'Bâtiment inconnu'} — ${item.label}`,
        // Le libellé nu, pour les écrans où le bâtiment est déjà choisi : y
        // répéter son nom sur chaque option n'apprend rien et allonge la liste.
        shortLabel: item.label,
        buildingId: item.building_id,
        level: item.level,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr') || a.level - b.level),
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
 * Types acceptés pour un plan de localisation.
 *
 * Plus étroit que pour un plan d'étage, qui accepte le PDF : celui-ci
 * s'affiche dans une vignette, là où un lecteur de PDF n'a pas sa place. Le
 * SVG est écarté parce qu'il porte du script, et serait servi depuis le
 * domaine de l'application. Le serveur applique la même liste ; celle-ci
 * répond sans aller-retour.
 */
export const TYPES_PLAN_LOCALISATION = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Dépôt du plan portant le repère de la salle.
 *
 * Distinct des photos, qui montrent la salle, et du plan de l'étage, qui vaut
 * pour tout un niveau : une salle peut être située sans que son étage ait reçu
 * de plan, et l'inverse.
 */
export async function uploadRoomLocationPlan(id, file) {
  if (!file) throw new ApiError('Aucun fichier sélectionné.', 422, 'fichier_manquant');
  if (!TYPES_PLAN_LOCALISATION.includes(file.type)) {
    throw new ApiError(
      'Format refusé : déposez une image PNG, JPEG ou WebP.',
      422,
      'format_invalide',
    );
  }
  if (file.size > TAILLE_MAX_MO * 1024 * 1024) {
    throw new ApiError(`Fichier trop lourd : ${TAILLE_MAX_MO} Mo maximum.`, 422, 'trop_lourd');
  }

  await put(`/rooms/${id}/location-plan`, {
    content_type: file.type,
    content: await enBase64(file),
  });
  return getManagedRoom(id);
}

export async function removeRoomLocationPlan(id) {
  await del(`/rooms/${id}/location-plan`);
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
