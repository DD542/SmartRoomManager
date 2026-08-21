// src/api/admin/knowledge.js
// Endpoints FastAPI cibles :
//   GET    /api/admin/articles?category=   base de connaissances administrable
//   POST   /api/admin/articles             création ou mise à jour
//   PATCH  /api/admin/articles/{id}/status publication ou retour en brouillon
//   DELETE /api/admin/articles/{id}
//   GET    /api/admin/chatbot/intents      scénarios du chatbot

import { helpArticles, helpCategories } from '../../mocks/helpArticles';
import { chatIntents } from '../../mocks/chatScripts';
import { NOW } from '../../utils/dates';
import { ApiError, clone, createStore, delay, nextId } from '../client';

/** Les articles publics deviennent des articles publiés, avec leur audience. */
const store = createStore(
  helpArticles.map((article, index) => ({
    ...article,
    status: 'publie',
    views: 120 + ((index * 37) % 300),
  })),
);

export async function listManagedArticles(categoryId = null) {
  await delay();
  return store
    .all()
    .filter((article) => (categoryId ? article.category === categoryId : true))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'brouillon' ? -1 : 1));
}

export async function listCategoriesWithCounts() {
  await delay(150);
  const all = store.all();
  return helpCategories.map((category) => ({
    ...clone(category),
    count: all.filter((article) => article.category === category.id).length,
  }));
}

export async function saveArticle(payload) {
  await delay();
  if (!payload.title?.trim()) throw new ApiError('Le titre est obligatoire.', 422, 'titre_requis');
  if (!payload.body?.trim()) throw new ApiError('Le contenu est obligatoire.', 422, 'corps_requis');

  const champs = {
    title: payload.title.trim(),
    excerpt: payload.excerpt?.trim() || `${payload.body.trim().slice(0, 90)}…`,
    body: payload.body.trim(),
    category: payload.category,
    related: payload.related ?? [],
    updatedAt: NOW.toISOString(),
  };

  if (payload.id) {
    const updated = store.update(payload.id, champs);
    if (!updated) throw new ApiError('Article introuvable.', 404, 'introuvable');
    return updated;
  }

  return store.insert({
    id: nextId('ha'),
    ...champs,
    status: payload.status ?? 'brouillon',
    views: 0,
  });
}

/** Un article ne peut être publié qu'avec un contenu réel. */
export async function setArticleStatus(id, status) {
  await delay();
  const article = store.find((item) => item.id === id);
  if (!article) throw new ApiError('Article introuvable.', 404, 'introuvable');
  if (status === 'publie' && article.body.trim().length < 40) {
    throw new ApiError('Article trop court pour être publié.', 422, 'contenu_insuffisant');
  }
  return store.update(id, { status, updatedAt: NOW.toISOString() });
}

export async function deleteArticle(id) {
  await delay(200);
  store.remove(id);
  return { id, deleted: true };
}

/** Libellés des intentions, dérivés de leur identifiant technique. */
const LIBELLES_INTENTIONS = {
  salle_libre: 'Trouver une salle libre',
  code_acces: 'Code d’accès',
  annuler: 'Annuler une réservation',
  humain: 'Parler à un humain',
  horaires: 'Horaires d’ouverture',
  equipement: 'Équipement d’une salle',
};

/**
 * Scénarios reconnus par le chatbot de l'espace utilisateur, présentés au
 * support : l'identifiant technique devient un libellé, et une intention qui
 * propose « parler à un humain » est signalée comme menant à un ticket.
 */
export async function listChatbotIntents() {
  await delay(200);
  return clone(chatIntents).map((intent) => ({
    ...intent,
    label: LIBELLES_INTENTIONS[intent.id] ?? intent.id,
    answer: intent.reply,
    escalates:
      intent.id === 'humain' ||
      (intent.quickReplies ?? []).some((reponse) => /humain|support/i.test(reponse)),
  }));
}
