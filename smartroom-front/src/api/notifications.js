// src/api/notifications.js
// Endpoints réels :
//   GET   /api/v1/notifications                fil du compte connecté
//   GET   /api/v1/notifications/unread-count   pastille de la barre supérieure
//   PATCH /api/v1/notifications/{id}           marquer lue
//   POST  /api/v1/notifications/read-all       tout marquer comme lu

import * as adapt from './adapters';
import { abortable, collect, get, patch, post } from './client';

const ONGLETS = [
  { id: 'toutes', label: 'Toutes' },
  { id: 'reservation', label: 'Réservations' },
  { id: 'rappel', label: 'Rappels' },
  { id: 'aide', label: 'Aide' },
];

export async function listNotifications(category = 'toutes', { signal } = {}) {
  const lignes = (await collect('/notifications', {
    signal: signal ?? abortable('notifications:list'),
  })).map(adapt.notification);

  return category === 'toutes'
    ? lignes
    : lignes.filter((item) => item.category === category);
}

/**
 * Pastille de la barre supérieure.
 *
 * Un `COUNT` côté serveur plutôt que la longueur d'une liste chargée : la
 * pastille n'a besoin que du nombre, et le fil peut compter des centaines de
 * lignes.
 */
export async function countUnread({ signal } = {}) {
  return get('/notifications/unread-count', { signal });
}

export async function markAsRead(id) {
  return adapt.notification(await patch(`/notifications/${id}`, { read: true }));
}

export async function markAllAsRead() {
  await post('/notifications/read-all');
  return listNotifications();
}

export async function listTabs() {
  return ONGLETS.map((item) => ({ ...item }));
}
