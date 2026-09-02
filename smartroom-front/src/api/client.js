/**
 * Socle de la couche d'accès aux données.
 *
 * Un seul endroit connaît le transport : les fonctions de src/api/ appellent
 * `get`, `post`, `patch`, `del`, et rien d'autre du réseau ne transparaît.
 *
 * Trois propriétés portent l'essentiel :
 *
 *  - **le jeton vit en mémoire**, jamais dans localStorage : un XSS n'a rien à
 *    voler. Le rafraîchissement est en cookie httpOnly, hors de portée du JS ;
 *  - **un 401 déclenche un rafraîchissement**, une seule fois, et les requêtes
 *    concurrentes attendent le même : sans file, dix appels simultanés
 *    lanceraient dix rotations et invalideraient la session ;
 *  - **les erreurs arrivent normalisées** : l'API rend toujours
 *    `{ error: { code, message, fields } }`, et `ApiError` le reflète tel quel
 *    pour que les écrans affichent le message sans le reformuler.
 */

export const API_BASE = '/api/v1';

/** Erreur normalisée, image exacte de l'enveloppe rendue par l'API. */
export class ApiError extends Error {
  constructor(message, status = 400, code = 'erreur', extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? [];
    /** Présents sur un 409 de conflit : l'écran les affiche sans second appel. */
    this.conflict = extra.conflict ?? null;
    this.alternatives = extra.alternatives ?? [];
    this.requestId = extra.request_id ?? null;
  }

  /** Message d'un champ précis, pour surligner un formulaire. */
  fieldError(name) {
    return this.fields.find((item) => item.field === name)?.message ?? null;
  }
}

/** Requête abandonnée : l'écran l'ignore au lieu d'afficher une erreur. */
export class Cancelled extends Error {
  constructor() {
    super('Requête annulée.');
    this.name = 'Cancelled';
  }
}

export const isCancelled = (error) => error instanceof Cancelled;

/* -------------------------------------------------------------------------- */
/* Jeton d'accès                                                              */
/* -------------------------------------------------------------------------- */

let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token ?? null;
};

export const getAccessToken = () => accessToken;

/**
 * Prévenus quand la session ne peut plus être renouvelée. Les contextes
 * d'authentification s'y branchent pour vider leur état et renvoyer à la
 * connexion.
 *
 * Une liste et non un seul rappel : l'espace utilisateur et l'espace
 * d'administration s'abonnent tous les deux, et le second écraserait le premier.
 * L'appel rend sa fonction de désabonnement, directement utilisable comme
 * nettoyage d'un `useEffect`.
 */
const abonnes = new Set();

export const onSessionExpired = (callback) => {
  abonnes.add(callback);
  return () => abonnes.delete(callback);
};

const signalerExpiration = () => abonnes.forEach((callback) => callback());

/* -------------------------------------------------------------------------- */
/* Rafraîchissement                                                            */
/* -------------------------------------------------------------------------- */

let refreshInFlight = null;

/**
 * Renouvelle le jeton d'accès. Les appels concurrents partagent la même
 * promesse : dix requêtes qui reçoivent 401 en même temps ne doivent lancer
 * qu'une seule rotation, sinon la seconde invaliderait la famille entière.
 */
async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      // 204 : aucun cookie présenté, donc aucune session à reprendre. Ce n'est
      // pas un refus, et le distinguer explicitement évite de s'en remettre à
      // l'exception que lèverait `json()` sur un corps vide.
      if (response.status === 204) return null;
      if (!response.ok) return null;

      const payload = await response.json();
      setAccessToken(payload.access_token);
      return payload;
    } catch {
      return null;
    } finally {
      // Libéré dans le `finally` : sans cela, un échec figerait toute rotation
      // ultérieure sur une promesse déjà résolue.
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/* -------------------------------------------------------------------------- */
/* Requête                                                                     */
/* -------------------------------------------------------------------------- */

function buildUrl(path, params) {
  const url = `${API_BASE}${path}`;
  if (!params) return url;

  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    // Un tableau devient une répétition du paramètre : c'est ce qu'attend
    // FastAPI pour `list[UUID] | None = Query()`.
    if (Array.isArray(value)) {
      value.filter((item) => item !== undefined && item !== null).forEach((item) => query.append(key, item));
    } else {
      query.append(key, value);
    }
  });

  const chaine = query.toString();
  return chaine ? `${url}?${chaine}` : url;
}

async function toApiError(response) {
  let corps = null;
  try {
    corps = await response.json();
  } catch {
    corps = null;
  }

  const erreur = corps?.error;
  if (erreur) {
    return new ApiError(erreur.message, response.status, erreur.code, erreur);
  }
  return new ApiError(
    "Le serveur n'a pas répondu comme prévu.",
    response.status,
    'erreur_reseau',
  );
}

async function execute(method, path, { body, params, signal, retry = true, raw = false } = {}) {
  const entetes = {};
  if (body !== undefined) entetes['Content-Type'] = 'application/json';
  if (accessToken) entetes.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers: entetes,
      // `include` : le cookie de rafraîchissement doit accompagner les appels
      // d'authentification, et il est restreint à ce chemin côté serveur.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Cancelled();
    throw new ApiError(
      'Serveur injoignable. Vérifiez votre connexion.',
      0,
      'reseau_indisponible',
    );
  }

  if (response.status === 401 && retry) {
    const renouvelle = await refreshAccessToken();
    if (renouvelle) {
      // Une seule reprise : `retry: false` empêche la boucle si le jeton
      // fraîchement émis est refusé à son tour.
      return execute(method, path, { body, params, signal, retry: false, raw });
    }
    setAccessToken(null);
    signalerExpiration();
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return null;
  if (raw) return response.text();

  return response.json();
}

/**
 * Reprend la session depuis le cookie de rafraîchissement.
 *
 * Passe par la même promesse partagée que la reprise sur 401 : les deux
 * contextes d'authentification se montent en même temps, et deux rotations
 * concurrentes feraient présenter un jeton déjà tourné — que le serveur traite,
 * à juste titre, comme un rejeu et sanctionne en révoquant toute la famille.
 */
export const restoreSession = () => refreshAccessToken();

export const get = (path, options) => execute('GET', path, options);
export const post = (path, body, options) => execute('POST', path, { ...options, body });
export const patch = (path, body, options) => execute('PATCH', path, { ...options, body });
export const put = (path, body, options) => execute('PUT', path, { ...options, body });
export const del = (path, options) => execute('DELETE', path, options);

/** Corps texte, pour les exports CSV. */
export const getText = (path, options) => execute('GET', path, { ...options, raw: true });

/* -------------------------------------------------------------------------- */
/* Annulation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fabrique un signal d'annulation par clé. Un nouvel appel sur la même clé
 * abandonne le précédent : sans cela, une recherche tapée vite ferait s'écraser
 * les réponses dans le désordre, la plus lente gagnant.
 */
const controllers = new Map();

export function abortable(key) {
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  return controller.signal;
}

export function abortAll() {
  controllers.forEach((controller) => controller.abort());
  controllers.clear();
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Déplie une réponse paginée en tableau simple.
 *
 * La plupart des écrans affichent une liste complète et bornée — le parc, les
 * équipements, les notifications d'un compte. Leur imposer la mécanique de
 * pagination pour trente lignes n'apporterait rien.
 */
export const items = (page) => (Array.isArray(page) ? page : (page?.items ?? []));

/**
 * Toutes les pages d'une collection, jusqu'à un plafond — et **ce que le
 * plafond a laissé de côté**.
 *
 * Le compte restant n'est pas décoratif. L'écran « Toutes les réservations »
 * chargeait 500 lignes sur 589 et n'en disait rien : la route rend les
 * réservations par créneau croissant, les 89 abandonnées étaient donc les plus
 * lointaines — exactement là où atterrit une réservation qu'on vient de
 * créer. Elle n'apparaissait pas, et rien à l'écran ne distinguait « absente
 * de la liste » de « jamais enregistrée ».
 */
export async function collectAvecReste(path, { params, signal, max = 500 } = {}) {
  const premiere = await get(path, { params: { ...params, size: 100 }, signal });
  const lignes = items(premiere);

  const pages = premiere?.pagination?.pages ?? 1;
  for (let page = 2; page <= pages && lignes.length < max; page += 1) {
    const suivante = await get(path, { params: { ...params, size: 100, page }, signal });
    lignes.push(...items(suivante));
  }

  const total = premiere?.total ?? lignes.length;
  return { lignes, total, reste: Math.max(0, total - lignes.length) };
}

/** La même chose, pour les appelants que le reste n'intéresse pas. */
export async function collect(path, options) {
  return (await collectAvecReste(path, options)).lignes;
}

/**
 * Contenu d'un fichier en base64, sans le préfixe `data:` de FileReader.
 *
 * Vit ici parce que c'est une question de transport : l'API reçoit ses
 * fichiers encodés dans le corps JSON, le multipart demandant une dépendance
 * de plus côté serveur. Deux modules en avaient besoin — les plans d'étage et
 * les photos de profil — et le second allait le recopier.
 */
export function enBase64(file) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new ApiError('Fichier illisible.', 422, 'fichier_illisible'));
    lecteur.onload = () => resolve(String(lecteur.result).split(',')[1] ?? '');
    lecteur.readAsDataURL(file);
  });
}
