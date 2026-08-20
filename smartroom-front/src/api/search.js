// src/api/search.js
// Endpoint FastAPI cible :
//   GET /api/search?q=   recherche multi-entités (salles, réservations, aide)

import { rooms } from '../mocks/rooms';
import { helpArticles } from '../mocks/helpArticles';
import { currentUserId } from '../mocks/users';
import { normalize } from '../utils/format';
import { fmtDayMonth, fmtTime } from '../utils/dates';
import { delay } from './client';
import { bookingStore } from './bookings';

/**
 * Renvoie des groupes homogènes, directement consommables par U-25 :
 * { id, label, count, items: [{ id, title, subtitle, to, tone }] }
 */
export async function globalSearch(query = '') {
  await delay();
  const q = normalize(query);
  if (q.length < 2) return { query, total: 0, groups: [] };

  const roomHits = rooms
    .filter((room) => normalize(`${room.name} ${room.description}`).includes(q))
    .map((room) => ({
      id: room.id,
      title: room.name,
      subtitle: `${room.capacity} pers. • ${room.floor}`,
      to: `/app/salles/${room.id}`,
      tone: room.status === 'disponible' ? 'success' : 'muted',
      badge: room.status === 'disponible' ? 'Disponible' : 'Occupée',
    }));

  const bookingHits = bookingStore
    .filter((b) => b.ownerId === currentUserId)
    .filter((b) => normalize(`${b.title} ${rooms.find((r) => r.id === b.roomId)?.name ?? ''}`).includes(q))
    .map((b) => ({
      id: b.id,
      title: b.title,
      subtitle: `${fmtDayMonth(b.start)} • ${fmtTime(b.start)} • ${
        rooms.find((r) => r.id === b.roomId)?.name ?? ''
      }`,
      to: `/app/reservations/${b.id}`,
      tone: b.status === 'annulee' ? 'danger' : 'default',
      strikethrough: b.status === 'annulee',
      badge: b.status === 'annulee' ? 'Annulée' : null,
    }));

  const helpHits = helpArticles
    .filter((article) => normalize(`${article.title} ${article.excerpt}`).includes(q))
    .map((article) => ({
      id: article.id,
      title: article.title,
      subtitle: 'Article FAQ',
      to: `/app/aide?article=${article.id}`,
      tone: 'default',
    }));

  const groups = [
    { id: 'salles', label: 'Salles', items: roomHits },
    { id: 'reservations', label: 'Réservations', items: bookingHits },
    { id: 'aide', label: 'Aide', items: helpHits },
  ]
    .map((group) => ({ ...group, count: group.items.length }))
    .filter((group) => group.count > 0);

  return { query, total: groups.reduce((sum, g) => sum + g.count, 0), groups };
}
