// src/api/admin/tickets.js
// Endpoints FastAPI cibles :
//   GET   /api/admin/tickets?status=       file de traitement
//   GET   /api/admin/tickets/{id}          fil, demandeur et réservation liée
//   POST  /api/admin/tickets/{id}/reply    réponse publique ou note interne
//   PATCH /api/admin/tickets/{id}/status   changement d'état
//   GET   /api/admin/response-templates    réponses types

import { responseTemplates } from '../../mocks/admin/responseTemplates';
import { tickets as seedTickets } from '../../mocks/tickets';
import { roomById } from '../../mocks/rooms';
import { userById } from '../../mocks/users';
import { NOW, toDate } from '../../utils/dates';
import { ApiError, clone, createStore, delay } from '../client';
import { bookingStore } from '../bookings';

/** Le back-office ajoute au ticket son demandeur et ses notes internes. */
const store = createStore(
  seedTickets.map((ticket) => ({
    ...ticket,
    requesterId: 'u-01',
    assignee: 'Support Niveau 1',
    messages: ticket.messages.map((message) => ({ ...message, internal: false })),
  })),
);

const ONGLETS = {
  ouverts: (ticket) => ticket.status === 'ouvert',
  en_cours: (ticket) => ticket.status === 'en_cours',
  resolus: (ticket) => ticket.status === 'resolu',
  tous: () => true,
};

export async function listAdminTickets(tab = 'ouverts') {
  await delay();
  return store
    .filter(ONGLETS[tab] ?? ONGLETS.tous)
    .map((ticket) => ({
      ...ticket,
      requester: resumeDemandeur(ticket.requesterId),
      roomName: ticket.roomId ? roomById[ticket.roomId]?.name ?? null : null,
    }))
    .sort((a, b) => toDate(b.updatedAt) - toDate(a.updatedAt));
}

export async function countTickets() {
  await delay(120);
  const all = store.all();
  return {
    ouverts: all.filter(ONGLETS.ouverts).length,
    en_cours: all.filter(ONGLETS.en_cours).length,
    resolus: all.filter(ONGLETS.resolus).length,
    tous: all.length,
  };
}

function resumeDemandeur(userId) {
  const user = userById[userId];
  if (!user) return null;
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone,
    promotion: user.promotion,
    status: 'Actif',
  };
}

/**
 * Détail d'un ticket, avec la réservation concernée : c'est elle qui rend
 * possibles les actions rapides du rail droit.
 */
export async function getAdminTicket(id) {
  await delay();
  const ticket = store.find((item) => item.id === String(id));
  if (!ticket) throw new ApiError('Ticket introuvable.', 404, 'introuvable');

  const liee = ticket.roomId
    ? bookingStore
        .filter((booking) => booking.roomId === ticket.roomId && booking.ownerId === ticket.requesterId)
        .sort((a, b) => toDate(b.start) - toDate(a.start))[0] ?? null
    : null;

  return {
    ...ticket,
    requester: resumeDemandeur(ticket.requesterId),
    linkedBooking: liee ? { ...liee, room: clone(roomById[liee.roomId]) } : null,
  };
}

export async function replyToAdminTicket(id, { body, internal = false, resolve = false }) {
  await delay();
  if (!body?.trim()) throw new ApiError('La réponse est vide.', 422, 'reponse_vide');

  const updated = store.update(id, (ticket) => ({
    status: resolve ? 'resolu' : ticket.status === 'ouvert' ? 'en_cours' : ticket.status,
    updatedAt: NOW.toISOString(),
    messages: [
      ...ticket.messages,
      { author: 'support', at: NOW.toISOString(), body: body.trim(), internal },
    ],
  }));
  if (!updated) throw new ApiError('Ticket introuvable.', 404, 'introuvable');
  return updated;
}

export async function setTicketStatus(id, status) {
  await delay(200);
  if (!['ouvert', 'en_cours', 'resolu'].includes(status)) {
    throw new ApiError('Statut inconnu.', 422, 'statut_invalide');
  }
  const updated = store.update(id, { status, updatedAt: NOW.toISOString() });
  if (!updated) throw new ApiError('Ticket introuvable.', 404, 'introuvable');
  return updated;
}

export async function listResponseTemplates() {
  await delay(150);
  return clone(responseTemplates);
}
