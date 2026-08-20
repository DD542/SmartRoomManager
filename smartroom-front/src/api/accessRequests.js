// src/api/accessRequests.js
// Endpoints FastAPI cibles :
//   GET  /api/access-requests/approvers   gestionnaires habilités
//   POST /api/access-requests             demande d'accès dérogatoire
//   GET  /api/access-requests/{id}        suivi de la demande

import { users } from '../mocks/users';
import { roomById } from '../mocks/rooms';
import { NOW } from '../utils/dates';
import { fullName } from '../utils/format';
import { isVisitDay } from '../utils/openingRules';
import { ApiError, clone, createStore, delay, nextId, notFound } from './client';

const store = createStore([]);

export async function listApprovers() {
  await delay(150);
  return users
    .filter((u) => u.role === 'gestionnaire')
    .map((u) => ({ id: u.id, label: `${fullName(u)} — ${u.department}` }));
}

/** Une demande n'a de sens que si la date est bien hors jours de visite. */
export async function isExceptionalNeeded(roomId, date) {
  await delay(150);
  const room = roomById[roomId];
  if (!room) throw notFound('Salle');
  return !isVisitDay(date, room.rules);
}

export async function createAccessRequest(payload) {
  await delay();
  const { roomId, date, reason, approverId, attendees, accepted } = payload;
  if (!reason?.trim()) {
    throw new ApiError('Le motif de la demande est obligatoire.', 422, 'motif_requis');
  }
  if (!accepted) {
    throw new ApiError(
      'Vous devez accepter les consignes de sécurité spécifiques.',
      422,
      'consignes_refusees',
    );
  }

  const request = {
    id: nextId('acc'),
    roomId,
    date,
    reason: reason.trim(),
    approverId,
    attendees,
    status: 'envoyee',
    createdAt: NOW.toISOString(),
    steps: [
      { key: 'envoyee', label: 'Demande envoyée', done: true },
      { key: 'validation', label: 'Validation gestionnaire', done: false },
      { key: 'confirmation', label: 'Confirmation', done: false },
    ],
  };
  return store.insert(request);
}

export async function getAccessRequest(id) {
  await delay();
  const request = store.find((r) => r.id === id);
  if (!request) throw notFound('Demande');
  return clone(request);
}
