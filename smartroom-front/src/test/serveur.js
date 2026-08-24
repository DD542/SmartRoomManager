// Interception à la frontière du client HTTP.
//
// Les requêtes sont arrêtées au niveau réseau et non en remplaçant `fetch` :
// le code testé est exactement celui qui tourne en production, en-têtes,
// cookies et codes de statut compris.

import { setupServer } from 'msw/node';

export const serveur = setupServer();

/** Enveloppe d'erreur de l'API, telle que la rend FastAPI. */
export const erreur = (code, message, extra = {}) => ({
  error: { code, message, ...extra },
});

/** Enveloppe paginée, telle que la rend `Page.build`. */
export const page = (items, total = items.length) => ({
  items,
  total,
  pagination: { page: 1, size: 100, pages: Math.max(1, Math.ceil(total / 100)) },
});
