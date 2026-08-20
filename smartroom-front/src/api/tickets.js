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

/** Catégories d'aide, avec un compteur calculé sur la base réelle d'articles. */
export async function listHelpCategories() {
  await delay(150);
  return helpCategories.map((category) => ({
    ...clone(category),
    count: helpArticles.filter((article) => article.category === category.id).length,
  }));
}

/**
 * Recherche d'articles par texte et/ou catégorie.
 * Accepte une chaîne (recherche simple) ou un objet { query, category }.
 */
export async function searchHelpArticles(criteria = '') {
  await delay(200);
  const { query = '', category = null } =
    typeof criteria === 'string' ? { query: criteria } : criteria;

  const q = normalize(query);
  return helpArticles
    .filter((article) => (category ? article.category === category : true))
    .filter((article) =>
      q
        ? normalize(`${article.title} ${article.excerpt} ${article.body}`).includes(q)
        : true,
    )
    .map(clone);
}

/** Articles liés à un article donné, résolus depuis leurs identifiants. */
export async function listRelatedArticles(articleId) {
  await delay(120);
  const source = helpArticles.find((article) => article.id === articleId);
  if (!source) return [];
  return (source.related ?? [])
    .map((id) => helpArticles.find((article) => article.id === id))
    .filter(Boolean)
    .map(clone);
}

export async function getHelpArticle(id) {
  await delay(200);
  const article = helpArticles.find((a) => a.id === id);
  if (!article) throw notFound('Article');
  return clone(article);
}
