// src/api/tickets.js
// Endpoints réels :
//   GET  /api/v1/tickets                  mes tickets
//   POST /api/v1/tickets                  ouvrir un ticket, message initial compris
//   GET  /api/v1/tickets/{id}             détail et fil des messages
//   POST /api/v1/tickets/{id}/messages    répondre
//   GET  /api/v1/faq/categories           catégories, avec leur compteur
//   GET  /api/v1/faq/articles             recherche sur titre et extrait
//   GET  /api/v1/faq/articles/{slug}      lecture, incrémente un compteur d'usage

import * as adapt from './adapters';
import { abortable, collect, get, items, post } from './client';

/**
 * Catégories de ticket. Fixes : elles ne sont pas un référentiel en base mais
 * une valeur libre côté serveur, et l'écran doit proposer un choix borné.
 */
const CATEGORIES = [
  { id: 'acces', label: 'Accès' },
  { id: 'equipement', label: 'Équipement' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'compte', label: 'Compte' },
];

export async function listTickets({ status, signal } = {}) {
  const page = await get('/tickets', {
    params: { status, size: 100 },
    signal: signal ?? abortable('tickets:list'),
  });
  return items(page).map(adapt.ticket);
}

export async function getTicket(id, { signal } = {}) {
  return adapt.ticket(await get(`/tickets/${id}`, { signal }));
}

/**
 * Ouverture d'un ticket.
 *
 * Le message initial part avec le ticket : un ticket sans description
 * obligerait le support à réclamer avant de pouvoir aider.
 */
export async function createTicket({ subject, category, roomId, bookingId, body }) {
  const data = await post('/tickets', {
    subject,
    category,
    body,
    room_id: roomId ?? null,
    booking_id: bookingId ?? null,
  });
  return adapt.ticket(data);
}

export async function replyToTicket(id, body) {
  const data = await post(`/tickets/${id}/messages`, { body, is_internal: false });
  return adapt.ticketMessage(data);
}

export async function listTicketCategories() {
  return CATEGORIES.map((item) => ({ ...item }));
}

/** Catégories d'aide, chacune portant son nombre d'articles publiés. */
export async function listHelpCategories({ signal } = {}) {
  const data = await get('/faq/categories', { signal });
  return data.map((item) => ({ ...adapt.faqCategory(item), count: item.article_count }));
}

/**
 * Recherche d'articles.
 *
 * Accepte une chaîne ou `{ query, category }`. Le filtrage est fait en SQL sur
 * le titre et l'extrait : rapatrier la base pour la parcourir en mémoire
 * deviendrait coûteux dès quelques centaines d'articles.
 */
export async function searchHelpArticles(criteria = '', { signal } = {}) {
  const { query = '', category = null } =
    typeof criteria === 'string' ? { query: criteria } : criteria;

  const lignes = await collect('/faq/articles', {
    params: { q: query || undefined, category_id: category || undefined },
    signal: signal ?? abortable('faq:search'),
  });
  return lignes.map(adapt.faqArticle);
}

/**
 * Articles liés.
 *
 * Le modèle ne stocke pas de liens explicites entre articles : les voisins de
 * catégorie en tiennent lieu. Un lien saisi à la main se périmerait à la
 * première réorganisation de la base de connaissances.
 */
export async function listRelatedArticles(articleId, { signal } = {}) {
  const source = await getHelpArticle(articleId, { signal });
  if (!source?.categoryId) return [];

  const voisins = await collect('/faq/articles', {
    params: { category_id: source.categoryId },
    signal,
  });
  return voisins
    .map(adapt.faqArticle)
    .filter((item) => item.id !== source.id && item.slug !== source.slug)
    .slice(0, 3);
}

/**
 * Lecture d'un article.
 *
 * L'API adresse les articles par leur `slug`, lisible et stable. Les écrans
 * passent tantôt un identifiant, tantôt un slug : les deux sont acceptés ici.
 */
export async function getHelpArticle(idOrSlug, { signal } = {}) {
  const estUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(idOrSlug),
  );
  if (!estUuid) return adapt.faqArticle(await get(`/faq/articles/${idOrSlug}`, { signal }));

  const lignes = await collect('/faq/articles', { signal });
  const article = lignes.map(adapt.faqArticle).find((item) => item.id === idOrSlug);
  return article ? adapt.faqArticle(await get(`/faq/articles/${article.slug}`, { signal })) : null;
}
