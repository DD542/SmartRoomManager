// src/api/admin/buildings.js
// Endpoints réels :
//   GET    /api/v1/buildings                        parc, avec décomptes
//   POST   /api/v1/buildings                        déclarer un bâtiment
//   PATCH  /api/v1/buildings/{id}                   nom, adresse, ordre
//   DELETE /api/v1/buildings/{id}                   suppression, si vide
//   PUT    /api/v1/buildings/{id}/image             photographie
//   DELETE /api/v1/buildings/{id}/image             retrait
//   GET    /api/v1/buildings/{id}/floors            étages, du bas vers le haut
//   POST   /api/v1/buildings/{id}/floors            ajouter un niveau
//   PATCH  /api/v1/floors/{id}                      renommer, renuméroter
//   DELETE /api/v1/floors/{id}                      suppression, si vide
//   GET    /api/v1/rooms?floor_id=                  salles d'un niveau
//
// L'API ne savait que *lire* le parc : les bâtiments et les étages venaient du
// jeu de démonstration, donc de nulle part une fois l'application déployée. Ce
// module sert les écritures ajoutées pour y remédier.

import * as adapt from '../adapters';
import { ApiError, del, enBase64, get, items, patch, post, put } from '../client';

/**
 * Types acceptés pour la photographie d'un bâtiment.
 *
 * Ni PDF ni SVG, bien que le magasin de médias les prenne pour les plans
 * d'étage : l'image s'affiche dans une carte, et le SVG porte du script qui
 * s'exécuterait avec les droits de l'application. Le serveur applique la même
 * liste ; celle-ci répond sans aller-retour.
 */
export const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/webp'];
const TAILLE_MAX_MO = 5;

const batiment = (data) => ({
  ...adapt.building(data),
  floorCount: data.floor_count ?? 0,
  roomCount: data.room_count ?? 0,
});

/** Le parc, du premier bâtiment au dernier selon l'ordre choisi. */
export async function listManagedBuildings({ signal } = {}) {
  const data = await get('/buildings', { signal });
  return data.map(batiment);
}

export async function getManagedBuilding(id, { signal } = {}) {
  return batiment(await get(`/buildings/${id}`, { signal }));
}

/**
 * Déclare un bâtiment.
 *
 * Le code est court, en majuscules, et sert d'identifiant lisible dans les
 * exports et le journal d'audit. Il est normalisé ici plutôt que refusé : la
 * casse n'est pas une décision de l'utilisateur.
 */
export async function createBuilding({ code, name, address, sortOrder = 0 }) {
  const identifiant = code?.trim().toUpperCase();
  if (!identifiant) throw new ApiError('Le code est obligatoire.', 422, 'code_requis');
  if (!/^[A-Z0-9]{1,4}$/.test(identifiant)) {
    throw new ApiError(
      'Le code tient en quatre caractères, lettres majuscules ou chiffres.',
      422,
      'code_invalide',
    );
  }
  if (!name?.trim()) throw new ApiError('Le nom est obligatoire.', 422, 'nom_requis');

  return batiment(
    await post('/buildings', {
      code: identifiant,
      name: name.trim(),
      address: address?.trim() || null,
      sort_order: Number(sortOrder) || 0,
    }),
  );
}

/**
 * Modifie un bâtiment.
 *
 * Le code n'y figure pas : il est cité dans les exports déjà produits et dans
 * le journal d'audit, et le changer réécrirait le passé.
 */
export async function updateBuilding(id, { name, address, sortOrder }) {
  const corps = {};
  if (name !== undefined) corps.name = name.trim();
  if (address !== undefined) corps.address = address?.trim() || null;
  if (sortOrder !== undefined) corps.sort_order = Number(sortOrder) || 0;
  return batiment(await patch(`/buildings/${id}`, corps));
}

/** Suppression, refusée par le serveur tant qu'une salle y subsiste. */
export async function deleteBuilding(id) {
  await del(`/buildings/${id}`);
  return { id, deleted: true };
}

export async function uploadBuildingImage(id, file) {
  if (!file) throw new ApiError('Aucun fichier sélectionné.', 422, 'fichier_manquant');
  if (!TYPES_IMAGE.includes(file.type)) {
    throw new ApiError(
      'Format refusé : déposez une image PNG, JPEG ou WebP.',
      422,
      'format_invalide',
    );
  }
  if (file.size > TAILLE_MAX_MO * 1024 * 1024) {
    throw new ApiError(`Fichier trop lourd : ${TAILLE_MAX_MO} Mo maximum.`, 422, 'trop_lourd');
  }

  return batiment(
    await put(`/buildings/${id}/image`, {
      content_type: file.type,
      content: await enBase64(file),
    }),
  );
}

export async function removeBuildingImage(id) {
  return batiment(await del(`/buildings/${id}/image`));
}

/**
 * Étages d'un bâtiment, chacun avec les salles qu'il porte.
 *
 * Les salles accompagnent l'étage plutôt que d'être chargées au clic : la
 * question que l'écran répond est « que contient ce bâtiment », et y répondre
 * en deux temps ferait clignoter la réponse.
 */
export async function listFloorsWithRooms(buildingId, { signal } = {}) {
  const etages = await get(`/buildings/${buildingId}/floors`, { signal });

  const salles = await Promise.all(
    etages.map((etage) =>
      get('/rooms', { params: { floor_id: etage.id, size: 100 }, signal })
        .then((page) => items(page).map(adapt.room))
        .catch(() => []),
    ),
  );

  return etages.map((etage, index) => ({
    id: etage.id,
    buildingId: etage.building_id,
    code: etage.code,
    label: etage.label,
    level: etage.level,
    roomCount: etage.room_count ?? 0,
    rooms: salles[index],
  }));
}

/**
 * Ajoute un niveau.
 *
 * `level` est un entier de tri distinct du code : « RDC », « 1er » et « 2e »
 * ne s'ordonnent pas comme du texte, et une liste triée alphabétiquement
 * placerait le rez-de-chaussée entre le premier et le deuxième.
 */
export async function createFloor(buildingId, { code, label, level }) {
  if (!code?.trim()) throw new ApiError('Le code de l’étage est obligatoire.', 422, 'code_requis');
  if (!label?.trim()) throw new ApiError('Le libellé est obligatoire.', 422, 'libelle_requis');
  const niveau = Number(level);
  if (!Number.isInteger(niveau)) {
    throw new ApiError('Le niveau est un nombre entier.', 422, 'niveau_invalide');
  }

  const data = await post(`/buildings/${buildingId}/floors`, {
    code: code.trim(),
    label: label.trim(),
    level: niveau,
  });
  return { id: data.id, code: data.code, label: data.label, level: data.level, rooms: [] };
}

export async function updateFloor(floorId, { code, label, level }) {
  const corps = {};
  if (code !== undefined) corps.code = code.trim();
  if (label !== undefined) corps.label = label.trim();
  if (level !== undefined) corps.level = Number(level);
  const data = await patch(`/floors/${floorId}`, corps);
  return { id: data.id, code: data.code, label: data.label, level: data.level };
}

export async function deleteFloor(floorId) {
  await del(`/floors/${floorId}`);
  return { id: floorId, deleted: true };
}
