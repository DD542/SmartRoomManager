// src/api/admin/conflicts.js
// Endpoints réels :
//   GET  /api/v1/admin/access-requests                    file d'arbitrage
//   GET  /api/v1/access-requests/{id}                     détail d'une demande
//   POST /api/v1/admin/access-requests/{id}/decide        décision
//   POST /api/v1/recommendations/rooms/{id}/alternatives  salles de repli
//   GET  /api/v1/availability/calendar                    occupants du créneau
//
// La file est celle des demandes d'accès. Il n'existe pas de « conflit » à
// arbitrer en tant qu'entité : la contrainte `ex_bookings_no_overlap` rend deux
// réservations qui se chevauchent impossibles. Ce qui remonte ici est donc
// toujours une *demande* portant sur un créneau refusé — ce que l'écran traite.

import * as adapt from '../adapters';
import { ApiError, abortable, get, items, post } from '../client';

/**
 * Onglets de l'écran, rapportés au type de dérogation demandé.
 *
 * `conflit_reservation` désigne un créneau déjà pris ; les autres types
 * décrivent une règle enfreinte, pas un tiers lésé.
 */
const ONGLETS = {
  tous: () => true,
  conflits: (item) => item.accessType === 'conflit_reservation',
  demandes: (item) =>
    item.accessType === 'hors_jour_ouverture' || item.accessType === 'hors_horaire',
  validations: (item) =>
    item.accessType === 'depassement_capacite'
    || item.accessType === 'equipement_indisponible',
};

const URGENCE = {
  conflit_reservation: 'haute',
  depassement_capacite: 'moyenne',
  equipement_indisponible: 'moyenne',
  hors_jour_ouverture: 'moyenne',
  hors_horaire: 'basse',
};

const TITRES = {
  conflit_reservation: 'Conflit de réservation',
  depassement_capacite: 'Dépassement de capacité',
  equipement_indisponible: 'Équipement indisponible',
  hors_jour_ouverture: 'Accès hors jour d’ouverture',
  hors_horaire: 'Accès hors horaire',
};

const ORDRE = { haute: 0, moyenne: 1, basse: 2 };

const element = (demande) => ({
  ...demande,
  type: demande.accessType,
  urgency: URGENCE[demande.accessType] ?? 'basse',
  title: `${demande.roomName} — ${TITRES[demande.accessType] ?? 'Demande d’accès'}`,
  detail: demande.reason,
  createdAt: demande.createdAt,
  room: { id: demande.roomId, name: demande.roomName },
});

async function fileOuverte(signal) {
  const page = await get('/admin/access-requests', {
    params: { request_status: 'ouvert', size: 100 },
    signal: signal ?? abortable('admin:queue'),
  });
  return items(page).map(adapt.accessRequest).map(element);
}

export async function listQueue(tab = 'tous') {
  const lignes = await fileOuverte();
  return lignes
    .filter(ONGLETS[tab] ?? ONGLETS.tous)
    .sort(
      (a, b) =>
        ORDRE[a.urgency] - ORDRE[b.urgency] || new Date(b.createdAt) - new Date(a.createdAt),
    );
}

export async function countQueue() {
  const lignes = await fileOuverte();
  return {
    tous: lignes.length,
    conflits: lignes.filter(ONGLETS.conflits).length,
    demandes: lignes.filter(ONGLETS.demandes).length,
    validations: lignes.filter(ONGLETS.validations).length,
  };
}

/**
 * Détail d'un élément, enrichi des salles de repli calculées par le moteur.
 *
 * Les alternatives sont demandées même sans prétendant identifié : une demande
 * hors règle se règle aussi en orientant vers une salle déjà ouverte, et
 * l'onglet « alternative » serait sinon une impasse.
 */
export async function getQueueItem(id, { signal } = {}) {
  const demande = element(adapt.accessRequest(await get(`/access-requests/${id}`, { signal })));

  const [alternatives, occupants] = await Promise.all([
    post(`/recommendations/rooms/${demande.roomId}/alternatives`, {
      slot: adapt.slotIn(demande.start, demande.end),
      attendees: 1,
    })
      .then((data) => data.map(adapt.alternative))
      .catch(() => []),
    get('/availability/calendar', {
      params: {
        from_date: demande.start.toISOString(),
        to_date: demande.end.toISOString(),
        room_ids: [demande.roomId],
      },
      signal,
    })
      .then((data) => data.events.map(adapt.calendarEvent))
      .catch(() => []),
  ]);

  return {
    ...demande,
    alternatives,
    occupants,
    claimants: [
      {
        userId: demande.requesterId,
        name: demande.requesterName,
        start: demande.start,
        end: demande.end,
        createdAt: demande.createdAt,
      },
    ],
    targetUser: { id: demande.requesterId, firstName: demande.requesterName, lastName: '' },
  };
}

/**
 * Arbitrage.
 *
 * `maintien` refuse la demande et laisse la réservation en place, `alternative`
 * réoriente vers une autre salle, `refus` écarte la demande. Accorder crée la
 * réservation dans la foulée : accorder sans réserver laisserait le demandeur
 * devant un créneau toujours refusé.
 */
const DECISIONS = {
  maintien: 'refuse',
  refus: 'refuse',
  alternative: 'reoriente',
  accord: 'accorde',
};

export async function arbitrate(id, { decision, comment, alternativeRoomId }) {
  const tranchee = DECISIONS[decision];
  if (!tranchee) throw new ApiError('Décision inconnue.', 422, 'decision_invalide');
  if (tranchee === 'reoriente' && !alternativeRoomId) {
    throw new ApiError('Sélectionnez la salle proposée.', 422, 'alternative_requise');
  }

  const data = await post(`/admin/access-requests/${id}/decide`, {
    decision: tranchee,
    comment: comment ?? null,
    alternative_room_id: alternativeRoomId ?? null,
  });
  return element(adapt.accessRequest(data));
}
