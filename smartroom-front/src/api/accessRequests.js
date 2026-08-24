// src/api/accessRequests.js
// Endpoints réels :
//   POST /api/v1/access-requests              déposer une demande dérogatoire
//   GET  /api/v1/access-requests/{id}         suivi
//   POST /api/v1/availability/rooms/{id}/check   sert à savoir si une dérogation
//                                                est seulement nécessaire

import * as adapt from './adapters';
import { ApiError, get, post } from './client';

/**
 * Gestionnaires habilités.
 *
 * L'API n'expose pas d'annuaire d'approbateurs : une demande part dans la file
 * d'arbitrage et non vers une personne nommée. Désigner un destinataire ferait
 * dépendre le traitement de sa présence ce jour-là. La liste reste vide, et
 * l'écran affiche « file d'arbitrage » au lieu d'un nom.
 */
export async function listApprovers() {
  return [];
}

/**
 * Une demande n'a de sens que si le créneau est bien refusé.
 *
 * Le verdict vient du moteur : dupliquer la règle des jours d'ouverture côté
 * écran laisserait passer une demande que l'API refuserait ensuite, ou en
 * exigerait une là où la réservation directe suffit.
 */
export async function isExceptionalNeeded(roomId, date, { end } = {}) {
  const debut = date instanceof Date ? date : new Date(date);
  const fin = end ?? new Date(debut.getTime() + 3_600_000);

  const verdict = adapt.slotCheck(
    await post(`/availability/rooms/${roomId}/check`, {
      slot: adapt.slotIn(debut, fin),
      attendees: 1,
    }),
  );
  return !verdict.available && !verdict.conflicts.some((item) => item.blocking);
}

export async function createAccessRequest(payload) {
  const { roomId, start, end, date, reason, accepted } = payload;
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

  const debut = start ?? date;
  const fin = end ?? new Date(new Date(debut).getTime() + 3_600_000);

  const data = await post('/access-requests', {
    room_id: roomId,
    slot: adapt.slotIn(debut, fin),
    reason: reason.trim(),
  });
  return withSteps(adapt.accessRequest(data));
}

export async function getAccessRequest(id, { signal } = {}) {
  return withSteps(adapt.accessRequest(await get(`/access-requests/${id}`, { signal })));
}

/**
 * Frise d'avancement de l'écran de suivi, déduite du statut.
 *
 * Trois états seulement côté serveur — en attente, acceptée, refusée — et une
 * frise à trois étapes côté écran : la traduction est un affichage, pas une
 * donnée à stocker.
 */
const withSteps = (demande) => ({
  ...demande,
  steps: [
    { key: 'envoyee', label: 'Demande envoyée', done: true },
    {
      key: 'validation',
      label: 'Validation gestionnaire',
      done: demande.status !== 'ouvert',
    },
    {
      key: 'confirmation',
      label: demande.status === 'refuse' ? 'Demande refusée' : 'Confirmation',
      done: demande.status === 'accorde' || demande.status === 'reoriente',
    },
  ],
});
