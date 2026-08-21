// src/api/admin/conflicts.js
// Endpoints FastAPI cibles :
//   GET  /api/admin/queue?tab=            file des conflits et demandes
//   GET  /api/admin/queue/{id}            détail d'un élément
//   POST /api/admin/queue/{id}/arbitrate  décision de l'administrateur

import { roomById, rooms } from '../../mocks/rooms';
import { userById } from '../../mocks/users';
import { NOW, toDate } from '../../utils/dates';
import { rankRooms } from '../../utils/recommendation';
import { ApiError, clone, createStore, delay } from '../client';
import { bookingStore } from '../bookings';

/**
 * File d'arbitrage. Les éléments sont dérivés des réservations réelles quand
 * c'est possible : le conflit Vinci du 26/03 est celui que l'espace utilisateur
 * rencontre à l'étape 3 du tunnel.
 */
const seed = [
  {
    id: '#CONF-8492',
    type: 'conflit_double',
    urgency: 'haute',
    createdAt: '2026-03-26T11:35:00',
    roomId: 'r-vinci',
    title: 'Salle Vinci — Conflit de réservation',
    status: 'ouvert',
    claimants: [
      {
        userId: 'u-01',
        name: 'Dylan Menga Wanda',
        role: 'B3 Data & IA',
        start: '2026-03-26T14:00:00',
        end: '2026-03-26T15:30:00',
        createdAt: '2026-03-25T16:42:00',
        monthlyBookings: 6,
        remainingQuotaH: 14,
      },
      {
        userId: 'u-07',
        name: 'Amadou Diallo',
        role: 'Pédagogie',
        start: '2026-03-26T14:00:00',
        end: '2026-03-26T15:00:00',
        createdAt: '2026-03-26T11:30:00',
        monthlyBookings: 12,
        remainingQuotaH: 2,
      },
    ],
  },
  {
    id: '#CONF-8493',
    type: 'conflit_materiel',
    urgency: 'moyenne',
    createdAt: '2026-03-26T10:45:00',
    roomId: 'r-curie',
    title: 'Salle Curie — Équipement indisponible',
    status: 'ouvert',
    detail: 'Projecteur 4K requis par J. Dupont, déjà assigné sur le même créneau.',
    claimants: [],
  },
  {
    id: '#ACC-2201',
    type: 'demande_acces',
    urgency: 'moyenne',
    createdAt: '2026-03-25T09:10:00',
    roomId: 'r-alpha',
    title: 'Conseil Alpha — Accès hors jour de visite',
    status: 'ouvert',
    detail: 'Comité exceptionnel demandé un mardi, salle ouverte le jeudi uniquement.',
    claimants: [],
  },
  {
    id: '#ACC-2202',
    type: 'demande_acces',
    urgency: 'basse',
    createdAt: '2026-03-24T15:20:00',
    roomId: 'r-pascal',
    title: 'Salle Pascal — Accès un mercredi',
    status: 'ouvert',
    detail: 'Salle ouverte lundi, mardi et jeudi.',
    claimants: [],
  },
  {
    id: '#VAL-1104',
    type: 'validation',
    urgency: 'basse',
    createdAt: '2026-03-24T11:00:00',
    roomId: 'r-curie',
    title: 'Atelier de 20 personnes — validation de capacité',
    status: 'ouvert',
    detail: 'Effectif au maximum de la salle, validation demandée par la règle interne.',
    claimants: [],
  },
];

const store = createStore(seed);

// Exposé au tableau de bord : les compteurs de conflits doivent suivre les
// arbitrages rendus, pas une constante écrite dans le rapport.
export const queueStore = store;

const ONGLETS = {
  tous: () => true,
  conflits: (item) => item.type.startsWith('conflit'),
  demandes: (item) => item.type === 'demande_acces',
  validations: (item) => item.type === 'validation',
};

const ORDRE = { haute: 0, moyenne: 1, basse: 2 };

export async function listQueue(tab = 'tous') {
  await delay();
  return store
    .filter((item) => item.status === 'ouvert')
    .filter(ONGLETS[tab] ?? ONGLETS.tous)
    .map((item) => ({ ...item, room: clone(roomById[item.roomId]) ?? null }))
    .sort((a, b) => ORDRE[a.urgency] - ORDRE[b.urgency] || toDate(b.createdAt) - toDate(a.createdAt));
}

export async function countQueue() {
  await delay(120);
  const ouverts = store.filter((item) => item.status === 'ouvert');
  return {
    tous: ouverts.length,
    conflits: ouverts.filter(ONGLETS.conflits).length,
    demandes: ouverts.filter(ONGLETS.demandes).length,
    validations: ouverts.filter(ONGLETS.validations).length,
  };
}

/**
 * Détail d'un élément, enrichi des salles alternatives calculées par le moteur
 * de recommandation pour le demandeur qui serait débouté.
 */
export async function getQueueItem(id) {
  await delay();
  const item = store.find((entry) => entry.id === id);
  if (!item) throw new ApiError('Élément introuvable.', 404, 'introuvable');

  const perdant = item.claimants[1] ?? item.claimants[0] ?? null;

  // Les alternatives sont calculées même sans demandeur identifié : une demande
  // d'accès hors règle se règle aussi en orientant vers une salle déjà ouverte,
  // et l'onglet « alternative » serait sinon une impasse.
  const alternatives = rankRooms(
    rooms.filter((room) => room.id !== item.roomId && room.status !== 'maintenance'),
    {
      attendees: roomById[item.roomId]?.capacity ?? 8,
      equipmentIds: [],
      buildingId: roomById[item.roomId]?.buildingId,
    },
  )
    .filter((entry) => entry.eligible)
    .slice(0, 3);

  return {
    ...item,
    room: clone(roomById[item.roomId]) ?? null,
    occupants: bookingStore.filter(
      (booking) => booking.roomId === item.roomId && booking.status !== 'annulee',
    ),
    alternatives,
    targetUser: perdant ? clone(userById[perdant.userId]) ?? null : null,
  };
}

/**
 * Arbitrage : `maintien` conserve la réservation du premier demandeur,
 * `alternative` réoriente le second, `refus` annule la demande contestée.
 */
export async function arbitrate(id, { decision, comment, alternativeRoomId }) {
  await delay();
  const item = store.find((entry) => entry.id === id);
  if (!item) throw new ApiError('Élément introuvable.', 404, 'introuvable');
  if (!['maintien', 'alternative', 'refus'].includes(decision)) {
    throw new ApiError('Décision inconnue.', 422, 'decision_invalide');
  }
  if (decision === 'alternative' && !alternativeRoomId) {
    throw new ApiError('Sélectionnez la salle proposée.', 422, 'alternative_requise');
  }

  return store.update(id, {
    status: decision === 'refus' ? 'refuse' : 'arbitre',
    decision,
    comment: comment?.trim() ?? '',
    alternativeRoomId: alternativeRoomId ?? null,
    resolvedAt: NOW.toISOString(),
  });
}
