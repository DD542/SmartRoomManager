// src/api/notifications.js
// Endpoints FastAPI cibles :
//   GET   /api/notifications?category=       fil de l'utilisateur
//   PATCH /api/notifications/{id}            marquer lue
//   POST  /api/notifications/read-all        tout marquer comme lu

import { notificationTabs, notifications as seed } from '../mocks/notifications';
import { toDate } from '../utils/dates';
import { clone, createStore, delay, notFound } from './client';

const store = createStore(seed);

export async function listNotifications(category = 'toutes') {
  await delay();
  return store
    .all()
    .filter((n) => (category === 'toutes' ? true : n.category === category))
    .sort((a, b) => toDate(b.at) - toDate(a.at));
}

export async function countUnread() {
  await delay(120);
  return store.filter((n) => !n.read).length;
}

export async function markAsRead(id) {
  await delay(150);
  const updated = store.update(id, { read: true });
  if (!updated) throw notFound('Notification');
  return updated;
}

export async function markAllAsRead() {
  await delay();
  store.all().forEach((n) => store.update(n.id, { read: true }));
  return store.all();
}

export async function listTabs() {
  await delay(100);
  return clone(notificationTabs);
}
