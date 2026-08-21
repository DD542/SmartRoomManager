// src/api/admin/rules.js
// Endpoints FastAPI cibles :
//   GET   /api/admin/rules?scope=global|{roomId}   règles applicables
//   PATCH /api/admin/rules/{scope}                 modification
//   POST  /api/admin/rules/preview                 impact avant application

import { bookingRules } from '../../mocks/admin/closures';
import { fmtDuration } from '../../utils/dates';
import { ApiError, clone, delay } from '../client';
import { roomStore } from './rooms';

/** Règles globales, puis surcharges éventuelles par salle. */
let globales = clone(bookingRules);
const surcharges = new Map();

export async function getRules(scope = 'global') {
  await delay(200);
  if (scope === 'global') return clone(globales);

  const room = roomStore.find((item) => item.id === scope);
  if (!room) throw new ApiError('Salle introuvable.', 404, 'introuvable');
  return { ...clone(globales), ...(surcharges.get(scope) ?? {}), scope };
}

function valider(regles) {
  if (regles.minDurationMin < 15) {
    throw new ApiError('La durée minimale ne peut pas descendre sous 15 min.', 422, 'duree_min');
  }
  if (regles.maxDurationMin <= regles.minDurationMin) {
    throw new ApiError('La durée maximale doit dépasser la durée minimale.', 422, 'ordre_duree');
  }
  if (regles.weeklyQuotaHours * 60 < regles.maxDurationMin) {
    throw new ApiError(
      'Le quota hebdomadaire est inférieur à la durée maximale d’une seule réservation.',
      422,
      'quota_incoherent',
    );
  }
  if (regles.checkInWindowMin < 5) {
    throw new ApiError('La fenêtre de validation doit valoir au moins 5 min.', 422, 'fenetre');
  }
}

export async function updateRules(scope, patch) {
  await delay();
  const futur = { ...(scope === 'global' ? globales : await getRules(scope)), ...patch };
  valider(futur);

  if (scope === 'global') {
    globales = { ...futur, scope: 'global' };
    return clone(globales);
  }
  surcharges.set(scope, { ...(surcharges.get(scope) ?? {}), ...patch });
  return { ...futur, scope };
}

/**
 * Phrases d'impact affichées à droite de l'écran A-10, construites à partir des
 * valeurs saisies : elles changent avec les règles, aucune n'est figée.
 */
export async function previewImpact(regles) {
  await delay(150);
  return {
    resume: `Un utilisateur ne peut pas réserver plus de ${fmtDuration(
      regles.maxDurationMin,
    )} d’affilée, ni plus de ${regles.maxConcurrentSlots} créneaux simultanés.`,
    quota: `Quota hebdomadaire : ${regles.weeklyQuotaHours} h, soit environ ${Math.floor(
      (regles.weeklyQuotaHours * 60) / regles.maxDurationMin,
    )} réservations à la durée maximale.`,
    avertissement: `Les réservations seront automatiquement annulées si l’utilisateur ne valide pas sa présence dans les ${regles.checkInWindowMin} minutes suivant le début.`,
    battement: `Un battement de ${regles.bufferMin} min reste exigé entre deux réunions d’une même salle.`,
  };
}
