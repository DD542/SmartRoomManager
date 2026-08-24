// src/api/admin/plans.js
// Endpoints réels :
//   GET   /api/v1/buildings                    bâtiments
//   GET   /api/v1/buildings/{id}/floors        étages, du sous-sol au sommet
//   GET   /api/v1/floors/{id}/plan             document déposé
//   PATCH /api/v1/floors/{id}/placements       positionner les salles
//   POST  /api/v1/rooms/{id}/unplace           retirer une salle du plan
//   GET   /api/v1/rooms?floor_id=              salles de l'étage
//
// Un plan est un étage : `planId` vaut `floorId`.

import * as adapt from '../adapters';
import { ApiError, get, items, patch, post } from '../client';
import { getPlanDocumentForPlan, listFloorPlans } from '../buildings';

export const listPlans = listFloorPlans;

/**
 * État complet de l'éditeur : le plan, les salles déjà posées avec leur
 * géométrie, et celles de l'étage qui restent à placer.
 */
export async function getPlanLayout(planId, { signal } = {}) {
  if (!planId) throw new ApiError('Plan introuvable.', 404, 'introuvable');

  const [page, document] = await Promise.all([
    get('/rooms', { params: { floor_id: planId, size: 100 }, signal }),
    getPlanDocumentForPlan(planId, { signal }),
  ]);

  const salles = items(page).map(adapt.room);
  const [premiere] = salles;

  return {
    id: planId,
    buildingId: premiere?.buildingId ?? null,
    label: premiere ? `${premiere.buildingName} — ${premiere.floor}` : 'Plan',
    sublabel: `${salles.length} salles`,
    document,
    placed: salles
      .filter((salle) => salle.plan)
      .map((salle) => ({
        roomId: salle.id,
        room: salle,
        x: salle.plan.x,
        y: salle.plan.y,
        w: salle.plan.w,
        h: salle.plan.h,
        rotation: salle.plan.rotation,
      })),
    // Une salle archivée n'est plus proposée au placement : elle ne doit plus
    // apparaître sur le plan que consultent les utilisateurs.
    unplaced: salles
      .filter((salle) => !salle.plan && salle.status !== 'archivee')
      .map((salle) => ({
        id: salle.id,
        name: salle.name,
        area: salle.area,
        floor: salle.floor,
      })),
  };
}

/**
 * Position d'une salle sur le plan.
 *
 * Les coordonnées sont exprimées en pourcentage de la surface : elles
 * survivent au remplacement du plan par une image de dimensions différentes,
 * ce que des pixels ne feraient pas.
 *
 * L'API remplace en bloc les placements d'un étage ; les positions existantes
 * sont donc relues et renvoyées avec la nouvelle, sans quoi déplacer une salle
 * effacerait toutes les autres.
 */
export async function placeRoom(planId, roomId, { x, y, w, h, rotation = 0, entrance = false }) {
  if (x < 0 || y < 0 || x > 100 || y > 100) {
    throw new ApiError('Position hors du plan.', 422, 'hors_plan');
  }

  const etat = await getPlanLayout(planId);
  const autres = etat.placed.filter((pose) => pose.roomId !== roomId);
  const largeur = w ?? etat.placed.find((pose) => pose.roomId === roomId)?.w ?? 20;
  const hauteur = h ?? etat.placed.find((pose) => pose.roomId === roomId)?.h ?? 15;

  await patch(`/floors/${planId}/placements`, [
    ...autres.map((pose) => ({
      room_id: pose.roomId,
      pos_x: String(pose.x),
      pos_y: String(pose.y),
      width: String(pose.w),
      height: String(pose.h),
      rotation: pose.rotation ?? 0,
    })),
    {
      room_id: roomId,
      pos_x: String(x),
      pos_y: String(y),
      width: String(largeur),
      height: String(hauteur),
      rotation,
      is_entrance_marked: entrance,
    },
  ]);

  return { planId, roomId, x, y, w: largeur, h: hauteur, rotation, entrance };
}

export async function unplaceRoom(planId, roomId) {
  await post(`/rooms/${roomId}/unplace`);
  return { planId, roomId, placed: false };
}
