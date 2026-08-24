// src/api/admin/knowledge.js
// Endpoints réels :
//   GET    /api/v1/admin/faq/articles             articles, brouillons compris
//   POST   /api/v1/admin/faq/articles             création
//   PATCH  /api/v1/admin/faq/articles/{id}        modification
//   PATCH  /api/v1/admin/faq/articles/{id}/status publication ou retrait
//   DELETE /api/v1/admin/faq/articles/{id}        suppression
//   GET    /api/v1/faq/categories                 catégories et leurs compteurs
//   GET    /api/v1/admin/chatbot/intents          intentions déclarées

import * as adapt from '../adapters';
import { ApiError, abortable, collect, del, get, patch, post } from '../client';

export async function listManagedArticles(categoryId = null, { signal } = {}) {
  const lignes = await collect('/admin/faq/articles', {
    params: { category_id: categoryId || undefined },
    signal: signal ?? abortable('admin:faq'),
  });

  return lignes
    .map(adapt.faqArticle)
    .map((article) => ({ ...article, category: article.categoryId }))
    // Les brouillons d'abord : ce sont eux qui attendent une action.
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'brouillon' ? -1 : 1));
}

export async function listCategoriesWithCounts({ signal } = {}) {
  const data = await get('/faq/categories', { signal });
  return data.map((item) => ({ ...adapt.faqCategory(item), count: item.article_count }));
}

/**
 * Le `slug` sert d'adresse publique à l'article : il est dérivé du titre à la
 * création, puis figé. Le changer ensuite casserait les liens déjà partagés.
 */
const slugDepuis = (titre) =>
  String(titre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);

export async function saveArticle(payload) {
  if (!payload.title?.trim()) throw new ApiError('Le titre est obligatoire.', 422, 'titre_requis');
  if (!payload.body?.trim()) throw new ApiError('Le contenu est obligatoire.', 422, 'corps_requis');

  const champs = {
    category_id: payload.categoryId ?? payload.category,
    title: payload.title.trim(),
    excerpt: payload.excerpt?.trim() || `${payload.body.trim().slice(0, 90)}…`,
    body: payload.body.trim(),
  };

  const data = payload.id
    ? await patch(`/admin/faq/articles/${payload.id}`, champs)
    : await post('/admin/faq/articles', {
        ...champs,
        slug: slugDepuis(payload.title),
        status: payload.status ?? 'brouillon',
      });

  const article = adapt.faqArticle(data);
  return { ...article, category: article.categoryId };
}

/**
 * Publication ou retrait.
 *
 * Un article ne peut être publié qu'avec un contenu réel : la contrainte de
 * base l'exige, et publier une coquille vide ferait tomber un lecteur sur une
 * page blanche. Le retrait annule la date de publication — la garder ferait
 * mentir un article redevenu brouillon.
 */
export async function setArticleStatus(id, status) {
  if (!['brouillon', 'publie'].includes(status)) {
    throw new ApiError('Statut inconnu.', 422, 'statut_invalide');
  }
  const data = await patch(`/admin/faq/articles/${id}/status`, { status });
  const article = adapt.faqArticle(data);
  return { ...article, category: article.categoryId };
}

export async function deleteArticle(id) {
  await del(`/admin/faq/articles/${id}`);
  return { id, deleted: true };
}

/**
 * Scénarios reconnus par l'assistant, présentés au support.
 *
 * Les intentions et leurs mots-clés vivent en base : les modifier ne demande
 * pas de redéploiement, et une intention qui renvoie vers un ticket est
 * signalée comme telle.
 */
export async function listChatbotIntents({ signal } = {}) {
  const data = await get('/admin/chatbot/intents', { signal });
  return data.map((item) => ({
    id: item.id,
    code: item.code,
    label: item.label,
    answer: item.answer,
    reply: item.answer,
    quickReplies: item.quick_replies ?? [],
    keywords: item.keywords ?? [],
    escalates: item.escalates_to_ticket,
    articleId: item.faq_article_id,
    active: item.is_active,
  }));
}
