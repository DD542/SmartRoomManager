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
/**
 * Types de dérogation de l'API traduits dans le vocabulaire de l'écran.
 *
 * `QueueList` connaît quatre familles et les nomme ; l'API en distingue cinq,
 * plus fines. Sans cette table, chaque élément retombe sur le libellé par
 * défaut — un conflit de réservation s'affichait « Validation ».
 */
const FAMILLE = {
  conflit_reservation: 'conflit_double',
  equipement_indisponible: 'conflit_materiel',
  hors_jour_ouverture: 'demande_acces',
  hors_horaire: 'demande_acces',
  depassement_capacite: 'validation',
};

const ONGLETS = {
  tous: () => true,
  conflits: (item) => item.type === 'conflit_double' || item.type === 'conflit_materiel',
  demandes: (item) => item.type === 'demande_acces',
  validations: (item) => item.type === 'validation',
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
  type: FAMILLE[demande.accessType] ?? 'validation',
  urgency: URGENCE[demande.accessType] ?? 'basse',
  title: `${demande.roomName} — ${TITRES[demande.accessType] ?? 'Demande d’accès'}`,
  detail: demande.reason,
  createdAt: demande.createdAt,
  room: { id: demande.roomId, name: demande.roomName },
});

/**
 * File des demandes ouvertes.
 *
 * `cle` distingue les usages concurrents. La liste et les compteurs partagent
 * la même source mais partent ensemble : sous une clé commune, le second appel
 * annulerait le premier, et l'écran resterait sur son squelette en affichant
 * un compteur juste au-dessus d'une liste vide.
 */
async function fileOuverte(cle, signal) {
  const page = await get('/admin/access-requests', {
    params: { request_status: 'ouvert', size: 100 },
    signal: signal ?? abortable(cle),
  });
  return items(page).map(adapt.accessRequest).map(element);
}

export async function listQueue(tab = 'tous') {
  const lignes = await fileOuverte('admin:queue:liste');
  return lignes
    .filter(ONGLETS[tab] ?? ONGLETS.tous)
    .sort(
      (a, b) =>
        ORDRE[a.urgency] - ORDRE[b.urgency] || new Date(b.createdAt) - new Date(a.createdAt),
    );
}

export async function countQueue() {
  const lignes = await fileOuverte('admin:queue:compteurs');
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

  const [propositions, occupants, parc] = await Promise.all([
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
    // Le moteur ne rend qu'un identifiant de salle : « proposer 0e03efc0 » ne
    // se décide pas. Le catalogue est relu une fois pour nommer les
    // propositions et donner leur capacité, qui est le critère de l'arbitre.
    get('/rooms', { params: { size: 100 }, signal })
      .then((page) => items(page).map(adapt.room))
      .catch(() => []),
  ]);

  const parNom = new Map(parc.map((salle) => [salle.id, salle]));
  const alternatives = propositions
    // `decide` réserve toujours le créneau demandé et ne fait varier que la
    // salle : `alternative_room_id` est son seul degré de liberté. Les familles
    // `meme_salle_autre_creneau` et `proche` déplacent l'horaire — les proposer
    // ici ferait choisir un report que la décision ne peut pas appliquer, et
    // renverrait le demandeur sur le créneau litigieux, que la contrainte
    // d'exclusion refuse. Seul « autre salle, même créneau » est arbitrable.
    .filter((proposition) => proposition.kind === 'autre_salle_meme_creneau')
    .map((proposition) => {
      const salle = parNom.get(proposition.roomId);
      return salle
        ? { ...proposition, room: { id: salle.id, name: salle.name, capacity: salle.capacity } }
        : null;
    })
    // Une proposition dont la salle a disparu du catalogue n'est pas
    // affichable : mieux vaut l'écarter que de rendre une ligne sans nom.
    .filter(Boolean);

  const salleDemandee = parNom.get(demande.roomId);

  return {
    ...demande,
    room: { ...demande.room, capacity: salleDemandee?.capacity ?? null },
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
