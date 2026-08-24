// src/api/admin/tickets.js
// Endpoints réels :
//   GET   /api/v1/admin/tickets                    file, les plus anciens d'abord
//   GET   /api/v1/tickets/{id}                     détail, notes internes comprises
//   POST  /api/v1/tickets/{id}/messages            répondre
//   PATCH /api/v1/admin/tickets/{id}/status        changer le statut
//   PATCH /api/v1/admin/tickets/{id}/assignee      attribuer
//   GET   /api/v1/admin/response-templates         réponses types
//   GET   /api/v1/admin/users/{id}                 fiche du demandeur

import * as adapt from '../adapters';
import { ApiError, abortable, get, items, patch, post } from '../client';

const ONGLETS = {
  ouverts: 'ouvert',
  en_cours: 'en_cours',
  resolus: 'resolu',
  tous: undefined,
};

async function file(statut, signal) {
  const page = await get('/admin/tickets', {
    params: { status: statut, size: 100 },
    signal: signal ?? abortable('admin:tickets'),
  });
  return { lignes: items(page).map(adapt.ticket), total: page.total ?? 0 };
}

export async function listAdminTickets(tab = 'ouverts') {
  const { lignes } = await file(ONGLETS[tab] ?? ONGLETS.tous);
  return lignes.map((ticket) => ({
    ...ticket,
    updatedAt: ticket.createdAt,
    requester: {
      id: ticket.requesterId,
      name: ticket.requesterName,
      email: null,
      status: 'Actif',
    },
  }));
}

/**
 * Compteurs des onglets.
 *
 * Quatre appels d'une ligne chacun plutôt qu'un chargement complet suivi d'un
 * décompte local : la file peut compter des centaines de tickets, et les
 * pastilles n'ont besoin que du total que la pagination rend déjà.
 */
export async function countTickets() {
  const [ouverts, enCours, resolus, tous] = await Promise.all([
    file('ouvert'),
    file('en_cours'),
    file('resolu'),
    file(undefined),
  ]);
  return {
    ouverts: ouverts.total,
    en_cours: enCours.total,
    resolus: resolus.total,
    tous: tous.total,
  };
}

/**
 * Détail d'un ticket.
 *
 * La réservation liée accompagne la fiche : c'est elle qui rend possibles les
 * actions rapides du rail droit — annuler, déplacer, renvoyer le code d'accès.
 */
export async function getAdminTicket(id, { signal } = {}) {
  const ticket = adapt.ticket(await get(`/tickets/${id}`, { signal }));

  const [demandeur, liee] = await Promise.all([
    get(`/admin/users/${ticket.requesterId}`, { signal })
      .then((data) => ({
        id: data.id,
        name: `${data.first_name} ${data.last_name}`,
        email: data.email,
        phone: data.phone,
        promotion: data.promotion,
        status: data.status === 'actif' ? 'Actif' : 'Suspendu',
      }))
      .catch(() => null),
    ticket.bookingId
      ? get(`/bookings/${ticket.bookingId}`, { signal }).then(adapt.booking).catch(() => null)
      : Promise.resolve(null),
  ]);

  return { ...ticket, updatedAt: ticket.createdAt, requester: demandeur, linkedBooking: liee };
}

/**
 * Réponse sur un ticket.
 *
 * Une note interne est visible du support et jamais du demandeur : le filtre
 * est appliqué à la lecture côté serveur, pas masqué à l'affichage.
 */
export async function replyToAdminTicket(id, { body, internal = false, resolve = false }) {
  if (!body?.trim()) throw new ApiError('La réponse est vide.', 422, 'reponse_vide');

  await post(`/tickets/${id}/messages`, { body: body.trim(), is_internal: internal });
  if (resolve) return setTicketStatus(id, 'resolu');
  return getAdminTicket(id);
}

export async function setTicketStatus(id, status) {
  if (!['ouvert', 'en_cours', 'resolu', 'ferme'].includes(status)) {
    throw new ApiError('Statut inconnu.', 422, 'statut_invalide');
  }
  const data = await patch(`/admin/tickets/${id}/status`, { status });
  return { ...adapt.ticket(data), updatedAt: new Date().toISOString() };
}

export async function assignTicket(id, adminUserId) {
  const data = await patch(`/admin/tickets/${id}/assignee`, { admin_user_id: adminUserId });
  return adapt.ticket(data);
}

export async function listResponseTemplates({ signal } = {}) {
  const data = await get('/admin/response-templates', { signal });
  return data.map((item) => ({
    id: item.id,
    code: item.code,
    category: item.category,
    label: item.label,
    body: item.body,
  }));
}
