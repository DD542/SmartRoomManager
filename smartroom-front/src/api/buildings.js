// src/api/buildings.js
// Endpoints FastAPI cibles :
//   GET    /api/buildings                        liste des bâtiments et de leurs étages
//   GET    /api/buildings/{id}/plan?floor=       plan d'étage et salles positionnées
//   GET    /api/plans/{planId}/document          plan téléversé (image ou PDF)
//   POST   /api/plans/{planId}/document          dépôt du plan par un gestionnaire
//   DELETE /api/plans/{planId}/document          retrait du plan

import { buildings } from '../mocks/buildings';
import { floorPlans, planDocuments, planLegend } from '../mocks/floorPlan';
import { roomById } from '../mocks/rooms';
import { equipmentById } from '../mocks/equipment';
import { NOW } from '../utils/dates';
import { ApiError, clone, delay, notFound } from './client';

export async function listBuildings() {
  await delay(150);
  return clone(buildings);
}

export async function getBuilding(id) {
  await delay(150);
  const building = buildings.find((b) => b.id === id);
  if (!building) throw notFound('Bâtiment');
  return clone(building);
}

/** Plans disponibles, pour le sélecteur de bâtiment de U-18. */
export async function listFloorPlans() {
  await delay(150);
  return floorPlans.map(({ id, buildingId, label, sublabel }) => ({
    id,
    buildingId,
    label,
    sublabel,
  }));
}

export async function getFloorPlan(planId) {
  await delay();
  const plan = floorPlans.find((p) => p.id === planId) ?? floorPlans[0];
  if (!plan) throw notFound('Plan');
  return {
    ...clone(plan),
    legend: clone(planLegend),
    rooms: plan.roomIds
      .map((id) => roomById[id])
      .filter(Boolean)
      .map((room) => ({
        ...clone(room),
        equipment: room.equipmentIds.map((eq) => clone(equipmentById[eq])).filter(Boolean),
      })),
  };
}

/** Identifiant du plan d'étage couvrant une salle donnée. */
export function planIdForRoom(roomId) {
  return floorPlans.find((plan) => plan.roomIds.includes(roomId))?.id ?? null;
}

// Magasin des documents déposés : en mémoire, comme le reste des écritures.
const documents = { ...planDocuments };

const TYPES_ACCEPTES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'application/pdf'];
export const TAILLE_MAX_MO = 5;

/** Document déposé pour un plan donné : image ou PDF, ou null. */
export async function getPlanDocumentForPlan(planId) {
  await delay(200);
  return planId ? (clone(documents[planId]) ?? null) : null;
}

/**
 * Plan téléversé couvrant la salle : image ou PDF, ou null si l'administration
 * n'en a pas encore déposé.
 */
export async function getPlanDocument(roomId) {
  return getPlanDocumentForPlan(planIdForRoom(roomId));
}

/**
 * Dépôt d'un plan par un gestionnaire. Le mock crée une URL d'objet locale ;
 * le back renverra l'URL du fichier stocké après validation du type et du poids.
 */
export async function uploadPlanDocument(planId, file) {
  await delay(600);
  if (!file) throw new ApiError('Aucun fichier sélectionné.', 422, 'fichier_manquant');
  if (!TYPES_ACCEPTES.includes(file.type)) {
    throw new ApiError('Format refusé : déposez une image (PNG, JPG, SVG, WebP) ou un PDF.', 422, 'format_invalide');
  }
  if (file.size > TAILLE_MAX_MO * 1024 * 1024) {
    throw new ApiError(`Fichier trop lourd : ${TAILLE_MAX_MO} Mo maximum.`, 422, 'trop_lourd');
  }

  const document = {
    id: `doc-${planId}`,
    type: file.type === 'application/pdf' ? 'pdf' : 'image',
    name: file.name,
    url: URL.createObjectURL(file),
    sizeKo: Math.max(1, Math.round(file.size / 1024)),
    updatedAt: NOW.toISOString(),
    uploadedBy: 'Vous',
  };
  documents[planId] = document;
  return clone(document);
}

export async function deletePlanDocument(planId) {
  await delay(300);
  delete documents[planId];
  return { planId, deleted: true };
}

/** Itinéraire depuis l'entrée, affiché en U-18 et dans l'e-mail de rappel. */
export async function getDirections(roomId) {
  await delay(200);
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');
  const building = buildings.find((b) => b.id === room.buildingId);
  return {
    roomId,
    steps: [...(building?.directions ?? []), `${room.name} — ${room.floor}`],
  };
}
