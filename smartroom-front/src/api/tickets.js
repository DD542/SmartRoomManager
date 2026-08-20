// src/api/tickets.js
// Endpoints FastAPI cibles :
//   GET  /api/tickets                mes demandes d'assistance
//   GET  /api/tickets/{id}           fil de discussion
//   POST /api/tickets                nouvelle demande
//   GET  /api/help/categories        catégories du centre d'aide
//   GET  /api/help/articles?q=       recherche dans la base de connaissances

import { ticketCategories, tickets as seed } from '../mocks/tickets';
import { helpArticles, helpCategories } from '../mocks/helpArticles';
import { NOW, toDate } from '../utils/dates';
import { normalize } from '../utils/format';
import { ApiError, clone, createStore, delay, nextId, notFound } from './client';

const store = createStore(seed);

export async function listTickets() {
  await delay();
  return store.all().sort((a, b) => toDate(b.updatedAt) - toDate(a.updatedAt));
}

export async function getTicket(id) {
  await delay();
  const ticket = store.find((t) => t.id === String(id));
  if (!ticket) throw notFound('Ticket');
  return ticket;
}

export async function createTicket({ subject, category, roomId, body }) {
  await delay();
  if (!subject?.trim() || !body?.trim()) {
    throw new ApiError('Le sujet et le message sont obligatoires.', 422, 'champs_requis');
  }
  const ticket = {
    id: nextId('tk').replace('tk-', ''),
    subject: subject.trim(),
    category,
    status: 'ouvert',
    updatedAt: NOW.toISOString(),
    roomId: roomId ?? null,
    messages: [{ author: 'utilisateur', at: NOW.toISOString(), body: body.trim() }],
  };
  return store.insert(ticket);
}

export async function replyToTicket(id, body) {
  await delay();
  const updated = store.update(id, (ticket) => ({
    updatedAt: NOW.toISOString(),
    messages: [...ticket.messages, { author: 'utilisateur', at: NOW.toISOString(), body }],
  }));
  if (!updated) throw notFound('Ticket');
  return updated;
}

export async function listTicketCategories() {
  await delay(120);
  return clone(ticketCategories);
}

export async function listHelpCategories() {
  await delay(150);
  return clone(helpCategories);
}

export async function searchHelpArticles(query = '') {
  await delay();
  const q = normalize(query);
  if (!q) return clone(helpArticles);
  return helpArticles.filter(
    (article) =>
      normalize(article.title).includes(q) ||
      normalize(article.excerpt).includes(q) ||
      normalize(article.body).includes(q),
  );
}

export async function getHelpArticle(id) {
  await delay(200);
  const article = helpArticles.find((a) => a.id === id);
  if (!article) throw notFound('Article');
  return clone(article);
}
