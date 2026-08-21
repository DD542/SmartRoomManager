// src/api/admin/plans.js
// Endpoints FastAPI cibles :
//   GET   /api/admin/plans/{planId}            plan, salles placées et salles à placer
//   PATCH /api/admin/plans/{planId}/rooms/{id} position, rotation, marqueur d'entrée
//   POST  /api/admin/plans/{planId}/unplace    retirer une salle du plan

import { floorPlans } from '../../mocks/floorPlan';
import { ApiError, clone, delay } from '../client';
import { getPlanDocumentForPlan } from '../buildings';
import { roomStore } from './rooms';

/** Placements édités par l'administration, indexés par identifiant de plan. */
const placements = new Map(
  floorPlans.map((plan) => [
    plan.id,
    plan.roomIds.map((roomId) => ({ roomId, rotation: 0, entrance: false })),
  ]),
);

export async function listPlans() {
  await delay(150);
  return floorPlans.map(({ id, buildingId, label, sublabel }) => ({
    id,
    buildingId,
    label,
    sublabel,
  }));
}

/**
 * État complet de l'éditeur : le plan, les salles déjà posées avec leur
 * géométrie, et celles du bâtiment qui restent à placer.
 */
export async function getPlanLayout(planId) {
  await delay();
  const plan = floorPlans.find((item) => item.id === planId);
  if (!plan) throw new ApiError('Plan introuvable.', 404, 'introuvable');

  const poses = placements.get(planId) ?? [];
  const posesIds = poses.map((item) => item.roomId);

  return {
    ...clone(plan),
    document: await getPlanDocumentForPlan(planId),
    placed: poses
      .map((pose) => {
        const room = roomStore.find((item) => item.id === pose.roomId);
        return room ? { ...pose, room: clone(room) } : null;
      })
      .filter(Boolean),
    // Une salle archivée n'est plus proposée au placement : elle ne doit plus
    // apparaître sur le plan que consultent les utilisateurs.
    unplaced: roomStore
      .filter(
        (room) =>
          room.buildingId === plan.buildingId &&
          room.status !== 'archivee' &&
          !posesIds.includes(room.id),
      )
      .map((room) => ({ id: room.id, name: room.name, area: room.area, floor: room.floor })),
  };
}

/**
 * Déplacement d'une salle sur le plan. Les coordonnées sont exprimées en
 * pourcentage du viewBox, comme dans le champ `plan` du modèle Room.
 */
export async function placeRoom(planId, roomId, { x, y, rotation = 0, entrance = false }) {
  await delay(200);
  const room = roomStore.find((item) => item.id === roomId);
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  if (x < 0 || y < 0 || x > 100 || y > 100) {
    throw new ApiError('Position hors du plan.', 422, 'hors_plan');
  }

  roomStore.update(roomId, { plan: { ...room.plan, x, y } });

  const poses = placements.get(planId) ?? [];
  const existant = poses.find((pose) => pose.roomId === roomId);
  if (existant) {
    Object.assign(existant, { rotation, entrance });
  } else {
    poses.push({ roomId, rotation, entrance });
  }
  placements.set(planId, poses);

  return { planId, roomId, x, y, rotation, entrance };
}

export async function unplaceRoom(planId, roomId) {
  await delay(200);
  placements.set(planId, (placements.get(planId) ?? []).filter((pose) => pose.roomId !== roomId));
  return { planId, roomId, placed: false };
}
