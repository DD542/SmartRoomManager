/**
 * Socle de la couche d'accès aux données.
 *
 * Toutes les fonctions de src/api/ renvoient une Promise avec un délai simulé
 * de 300 ms. Le jour où le back FastAPI est branché, seul ce dossier change :
 * `delay()` disparaît au profit de `fetch`, les signatures restent identiques.
 *
 * Base d'API cible : /api (proxy Vite vers http://127.0.0.1:8000).
 */

export const API_BASE = '/api';

export const DEFAULT_DELAY = 300;

export const delay = (ms = DEFAULT_DELAY) => new Promise((resolve) => setTimeout(resolve, ms));

/** Erreur normalisée, équivalente à une réponse HTTP non 2xx. */
export class ApiError extends Error {
  constructor(message, status = 400, code = 'erreur') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what = 'Ressource') => new ApiError(`${what} introuvable.`, 404, 'introuvable');

export const forbidden = (message = 'Accès refusé.') => new ApiError(message, 403, 'interdit');

/** Copie profonde : les mocks ne doivent jamais être mutés par une page. */
export const clone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

/**
 * Petit magasin en mémoire, seul endroit où vivent les écritures de la maquette.
 * Aucun localStorage : l'état repart à zéro à chaque rechargement, comme prévu.
 */
export function createStore(seed) {
  let data = clone(seed);
  return {
    all: () => clone(data),
    find: (predicate) => {
      const hit = data.find(predicate);
      return hit ? clone(hit) : null;
    },
    filter: (predicate) => clone(data.filter(predicate)),
    insert: (item) => {
      data = [...data, clone(item)];
      return clone(item);
    },
    update: (id, patch) => {
      let updated = null;
      data = data.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item, ...(typeof patch === 'function' ? patch(item) : patch) };
        return updated;
      });
      return updated ? clone(updated) : null;
    },
    remove: (id) => {
      data = data.filter((item) => item.id !== id);
    },
    reset: () => {
      data = clone(seed);
    },
  };
}

/** Générateur d'identifiants lisibles : bk-1731, tk-208… */
let sequence = 1000;
export const nextId = (prefix) => `${prefix}-${(sequence += 7)}`;

/** Code d'accès physique : lettre du bâtiment + 4 chiffres. */
export const generateAccessCode = (buildingCode = 'A') =>
  `${buildingCode}-${Math.floor(1000 + Math.random() * 8999)}`;
