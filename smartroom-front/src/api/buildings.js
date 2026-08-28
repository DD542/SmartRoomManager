// src/api/buildings.js
// Endpoints réels :
//   GET    /api/v1/buildings                   bâtiments et leurs décomptes
//   GET    /api/v1/buildings/{id}/floors       étages, du sous-sol au sommet
//   GET    /api/v1/floors/{id}/plan            document déposé
//   PUT    /api/v1/floors/{id}/plan            dépôt, base64 dans le corps JSON
//   DELETE /api/v1/floors/{id}/plan            retrait
//   GET    /api/v1/rooms?floor_id=             salles placées sur l'étage
//
// Un « plan » côté écran est un étage côté modèle : `planId` vaut `floorId`.
// Regrouper les plans par bâtiment aurait mélangé le rez-de-chaussée et le
// troisième dans une même image.

import { plural } from '../utils/format';
import * as adapt from './adapters';
import { ApiError, collect, del, enBase64, get, items, put } from './client';

export async function listBuildings({ signal } = {}) {
  return (await get('/buildings', { signal })).map(adapt.building);
}

export async function getBuilding(id, { signal } = {}) {
  return adapt.building(await get(`/buildings/${id}`, { signal }));
}

export async function listFloors(buildingId, { signal } = {}) {
  return (await get(`/buildings/${buildingId}/floors`, { signal })).map(adapt.floor);
}

/** Plans disponibles : un par étage, libellés par leur bâtiment. */
export async function listFloorPlans({ signal } = {}) {
  const batiments = await listBuildings({ signal });
  const parBatiment = await Promise.all(
    batiments.map((batiment) => listFloors(batiment.id, { signal })),
  );

  return batiments.flatMap((batiment, index) =>
    parBatiment[index].map((etage) => ({
      id: etage.id,
      buildingId: batiment.id,
      label: `${batiment.name} — ${etage.label}`,
      hasPlan: Boolean(etage.hasPlan),
      sublabel: [batiment.address, plural(etage.roomCount, 'salle')].filter(Boolean).join(' — '),
    })),
  );
}

/** Légende du schéma. Fixe : elle décrit un code couleur, pas une donnée. */
const LEGENDE = [
  { key: 'libre', label: 'Libre', tone: 'success' },
  { key: 'occupee', label: 'Occupée', tone: 'muted' },
  { key: 'mienne', label: 'Votre salle', tone: 'accent' },
];

/**
 * Étage et salles positionnées.
 *
 * Les couloirs et les repères du schéma décoratif ne sont pas modélisés : le
 * plan déposé par l'administration fait foi, et le schéma se limite aux
 * rectangles de salles, dont les coordonnées, elles, sont stockées.
 */
export async function getFloorPlan(planId, { signal } = {}) {
  if (!planId) throw new ApiError('Aucun plan sélectionné.', 404, 'introuvable');

  // Les salles seules : le plan déposé se demande par `getPlanDocumentForPlan`,
  // que l'écran appelle déjà. Le demander ici aussi produisait deux requêtes
  // pour une réponse, et deux 404 rouges dans la console pour un étage sans
  // plan — état parfaitement normal — dont personne ne lisait le résultat.
  const salles = await get('/rooms', { params: { floor_id: planId, size: 100 }, signal });

  const toutes = items(salles).map(adapt.room);
  // Le plan dessine des rectangles à des coordonnées : une salle que
  // l'administration n'a pas encore posée n'en a aucune. Le nom de la variable
  // disait déjà « placées », mais rien ne filtrait — et le plan lisait
  // `salle.plan.x` sur une salle sans position.
  const placees = toutes.filter((salle) => salle.plan);
  const [premiere] = placees.length ? placees : toutes;

  return {
    id: planId,
    buildingId: premiere?.buildingId ?? null,
    label: premiere ? `${premiere.buildingName} — ${premiere.floor}` : 'Plan',
    sublabel: `${placees.length} salles`,
    //: Salles de l'étage restées hors du plan. Comptées et non tues : sans
    //: cela, une salle absente du dessin passerait pour une salle absente du
    //: parc.
    unplaced: toutes.length - placees.length,
    corridors: [],
    entrance: null,
    landmarks: [],
    legend: LEGENDE,
    rooms: placees,
  };
}

/**
 * Identifiant du plan couvrant une salle.
 *
 * Synchrone parce que les écrans l'appellent pendant leur rendu, alors que
 * l'information est désormais distante : elle est lue dans le cache que
 * l'adaptateur de salle alimente à chaque fiche chargée. Les écrans concernés
 * ont tous chargé la salle auparavant.
 */
export function planIdForRoom(roomId) {
  return adapt.floorOfRoom.get(roomId) ?? null;
}

const document_ = (data) => ({
  id: data.id,
  type: data.kind,
  name: data.file_name,
  url: data.file_url,
  sizeKo: Math.max(1, Math.round(data.file_size_bytes / 1024)),
  updatedAt: data.uploaded_at,
  uploadedBy: 'Administration',
});

export const TAILLE_MAX_MO = 5;

const TYPES_ACCEPTES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
  'application/pdf',
];

export async function getPlanDocumentForPlan(planId, { signal, exists = true } = {}) {
  if (!planId) return null;
  // Quand l'appelant sait déjà qu'aucun plan n'est déposé, on ne le demande
  // pas : la réponse serait un 404 légitime côté serveur, mais la console du
  // navigateur l'affiche en rouge, où il se lit comme une panne. L'écran des
  // plans en produisait un par étage vide, à chaque rendu.
  if (!exists) return null;
  // Seul le 404 signifie « aucun plan déposé » : c'est un état vide, pas une
  // panne, et l'écran doit le présenter comme tel. Tout autre échec — 500,
  // coupure réseau, jeton expiré — reste une erreur et remonte : l'avaler
  // afficherait « aucun plan » sur un étage qui en a un.
  const plan = await get(`/floors/${planId}/plan`, { signal }).catch((erreur) => {
    if (erreur instanceof ApiError && erreur.status === 404) return null;
    throw erreur;
  });
  return plan ? document_(plan) : null;
}

/** Plan couvrant la salle, ou null si l'administration n'en a pas déposé. */
export async function getPlanDocument(roomId, options = {}) {
  return getPlanDocumentForPlan(planIdForRoom(roomId), options);
}

/**
 * Dépôt d'un plan.
 *
 * Le fichier part encodé en base64 dans le corps JSON : le multipart aurait
 * demandé une dépendance de plus côté serveur, et le surcoût d'un tiers reste
 * supportable sous un plafond de 5 Mo. Le type et le poids sont revérifiés
 * côté serveur — ce contrôle-ci n'existe que pour répondre sans aller-retour.
 */
export async function uploadPlanDocument(planId, file) {
  if (!file) throw new ApiError('Aucun fichier sélectionné.', 422, 'fichier_manquant');
  if (!TYPES_ACCEPTES.includes(file.type)) {
    throw new ApiError(
      'Format refusé : déposez une image (PNG, JPG, SVG, WebP) ou un PDF.',
      422,
      'format_invalide',
    );
  }
  if (file.size > TAILLE_MAX_MO * 1024 * 1024) {
    throw new ApiError(`Fichier trop lourd : ${TAILLE_MAX_MO} Mo maximum.`, 422, 'trop_lourd');
  }

  const data = await put(`/floors/${planId}/plan`, {
    file_name: file.name,
    content_type: file.type,
    content: await enBase64(file),
  });
  return document_(data);
}

export async function deletePlanDocument(planId) {
  await del(`/floors/${planId}/plan`);
  return { planId, deleted: true };
}

/**
 * Itinéraire depuis l'entrée.
 *
 * Composé du bâtiment, de son adresse et de l'étage plutôt que stocké : une
 * liste d'étapes saisie à la main se périmerait au premier réaménagement, sans
 * que personne ne s'en aperçoive.
 */
export async function getDirections(roomId, { signal } = {}) {
  const salle = adapt.room(await get(`/rooms/${roomId}`, { signal }));
  return {
    roomId,
    steps: [
      salle.buildingName ? `Entrée — ${salle.buildingName}` : 'Entrée principale',
      salle.floor ? `Rejoindre le ${salle.floor}` : null,
      `${salle.name}${salle.badgeRequired ? ' — badge requis' : ''}`,
    ].filter(Boolean),
  };
}

/** Parc complet d'un bâtiment, pour les écrans d'administration. */
export async function allRoomsOfBuilding(buildingId, { signal } = {}) {
  return (await collect('/rooms', { params: { building_id: buildingId }, signal })).map(adapt.room);
}
