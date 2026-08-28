// src/api/admin/assistant.js
// Endpoints réels :
//   GET /api/v1/admin/chat/statistiques   taux, latences, outils, causes de repli
//   GET /api/v1/admin/chat/etat           fournisseurs, index documentaire, seuils
//   GET /api/v1/admin/chat/prompt         prompt système versionné
//
// Les chiffres sont rendus tels quels : ils viennent d'agrégations SQL sur le
// journal des tours, et les recalculer ici ferait diverger l'écran du journal.

import { get } from '../client';

export async function getAssistantStatistiques(jours = 7, { signal } = {}) {
  return get('/admin/chat/statistiques', { params: { jours }, signal });
}

export async function getAssistantEtat({ signal } = {}) {
  return get('/admin/chat/etat', { signal });
}

export async function getPromptSysteme(version = null, { signal } = {}) {
  return get('/admin/chat/prompt', {
    params: version ? { version } : undefined,
    signal,
  });
}
