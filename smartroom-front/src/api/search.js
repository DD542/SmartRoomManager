// src/api/search.js
// La recherche globale n'a pas d'endpoint unique : elle interroge en parallèle
// les trois collections déjà filtrées côté serveur — salles, mes réservations,
// articles d'aide. Une route « tout chercher » aurait dû rejouer les règles de
// visibilité de chacune, et un oubli y aurait exposé les réservations d'autrui.

import { fmtDayMonth, fmtTime } from '../utils/dates';
import * as adapt from './adapters';
import { abortable, collect, get, items } from './client';

export async function globalSearch(query = '') {
  const q = query.trim();
  if (q.length < 2) return { query, total: 0, groups: [] };

  const signal = abortable('search:global');
  const [salles, reservations, articles] = await Promise.all([
    get('/rooms', { params: { q, size: 20 }, signal })
      .then((page) => items(page).map(adapt.room))
      .catch(() => []),
    collect('/bookings', { params: { size: 100 }, signal })
      .then((lignes) => lignes.map(adapt.booking))
      .catch(() => []),
    collect('/faq/articles', { params: { q }, signal })
      .then((lignes) => lignes.map(adapt.faqArticle))
      .catch(() => []),
  ]);

  const normalise = (valeur) =>
    String(valeur ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const terme = normalise(q);

  const groups = [
    {
      id: 'salles',
      label: 'Salles',
      items: salles.map((salle) => ({
        id: salle.id,
        title: salle.name,
        subtitle: `${salle.capacity} pers. • ${salle.floor}`,
        to: `/app/salles/${salle.id}`,
        tone: salle.status === 'disponible' ? 'success' : 'muted',
        badge: salle.status === 'disponible' ? 'Disponible' : 'Occupée',
      })),
    },
    {
      id: 'reservations',
      label: 'Réservations',
      // Filtrées ici : `GET /bookings` ne prend pas de terme de recherche, mais
      // la collection est celle du compte connecté et reste courte.
      items: reservations
        .filter((item) => normalise(`${item.title} ${item.roomName ?? ''}`).includes(terme))
        .map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: `${fmtDayMonth(item.start)} • ${fmtTime(item.start)} • ${item.roomName ?? ''}`,
          to: `/app/reservations/${item.id}`,
          tone: item.status === 'annulee' ? 'danger' : 'default',
          strikethrough: item.status === 'annulee',
          badge: item.status === 'annulee' ? 'Annulée' : null,
        })),
    },
    {
      id: 'aide',
      label: 'Aide',
      items: articles.map((article) => ({
        id: article.id,
        title: article.title,
        subtitle: 'Article FAQ',
        to: `/app/aide?article=${article.slug}`,
        tone: 'default',
      })),
    },
  ]
    .map((groupe) => ({ ...groupe, count: groupe.items.length }))
    .filter((groupe) => groupe.count > 0);

  return { query, total: groups.reduce((somme, groupe) => somme + groupe.count, 0), groups };
}
