// src/api/recommendations.js
// Endpoints réels :
//   POST /api/v1/recommendations        classement complet, score détaillé
//   POST /api/v1/recommendations/best   meilleure salle éligible

import * as adapt from './adapters';
import { abortable, post } from './client';

/** Le besoin exprimé par les écrans vers le corps attendu par le moteur. */
const besoin = (need = {}) => ({
  slot: need.start && need.end ? adapt.slotIn(need.start, need.end) : null,
  attendees: need.attendees ?? 1,
  building_id: need.buildingId ?? null,
  equipment_ids: need.equipmentIds ?? need.equipment ?? [],
  accessible_only: need.accessibleOnly ?? false,
  // Le filtre strict écarterait toute salle à laquelle il manque un seul
  // équipement ; en recommandation, mieux vaut la proposer avec un score
  // moindre et le motif affiché.
  equipment_strict: need.strictEquipment ?? false,
  limit: need.limit ?? 10,
});

/**
 * Classement des salles pour un besoin.
 *
 * Le score et sa justification viennent du moteur : les écrans n'affichent
 * aucun texte figé, et la pondération reste modifiable sans toucher au front.
 */
export async function recommendRooms(need = {}) {
  const data = await post('/recommendations', besoin(need), {
    signal: abortable('reco:rank'),
  });
  return data.map(adapt.suggestion);
}

/** Meilleure salle éligible : tableau de bord, chatbot, résolution de conflit. */
export async function recommendBest(need = {}) {
  const data = await post('/recommendations/best', besoin(need), {
    signal: abortable('reco:best'),
  });
  return data ? adapt.suggestion(data) : null;
}

/**
 * Dossier d'arbitrage d'un créneau disputé.
 *
 * Aucun gagnant n'y est désigné : les prétendants sont exposés avec leurs
 * critères, et la décision reste humaine.
 */
export async function getArbitrationBrief(roomId, { start, end }) {
  const data = await post(
    `/recommendations/rooms/${roomId}/arbitration`,
    adapt.slotIn(start, end),
  );
  return {
    roomId: data.room_id,
    ...adapt.slotOut(data.slot),
    claimants: data.claimants.map((item) => ({
      userId: item.user_id,
      name: item.display_name,
      requestedAt: new Date(item.requested_at),
      bookingId: item.booking_id,
      factors: item.factors.map((facteur) => ({
        key: facteur.key,
        label: facteur.label,
        value: facteur.value,
        detail: facteur.detail,
        favours: facteur.favours,
      })),
    })),
  };
}
