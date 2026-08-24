/**
 * Client HTTP : la pièce la plus sensible du front.
 *
 * Elle porte trois garanties que rien d'autre ne rattrape si elles cassent :
 * le jeton ne touche jamais le stockage du navigateur, une rafale de 401 ne
 * déclenche qu'une seule rotation, et une session perdue est signalée aux
 * contextes qui en dépendent.
 *
 * Les requêtes sont interceptées au niveau réseau : le code exercé est celui
 * de production, pas une doublure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { erreur, page, serveur } from '../test/serveur';
import {
  ApiError,
  collect,
  get,
  getAccessToken,
  items,
  onSessionExpired,
  post,
  restoreSession,
  setAccessToken,
} from './client';

//: Origine déclarée dans `vitest.config.js`. Les URL du client sont
//: relatives ; l'interception, elle, a besoin d'une adresse absolue.
const BASE = 'http://localhost:5180/api/v1';

describe('jeton d’accès', () => {
  it('ne laisse aucune trace dans le stockage du navigateur', async () => {
    setAccessToken('jeton-secret');

    // Le contrôle porte sur les deux stockages : un jeton posé dans l'un ou
    // l'autre serait lisible par tout script injecté dans la page.
    expect(Object.keys(localStorage)).toHaveLength(0);
    expect(Object.keys(sessionStorage)).toHaveLength(0);
    expect(document.cookie).not.toContain('jeton-secret');
    expect(getAccessToken()).toBe('jeton-secret');
  });

  it('accompagne chaque requête d’un en-tête d’autorisation', async () => {
    let recu = null;
    serveur.use(
      http.get(`${BASE}/rooms`, ({ request }) => {
        recu = request.headers.get('authorization');
        return HttpResponse.json(page([]));
      }),
    );
    setAccessToken('jeton-abc');

    await get('/rooms');
    expect(recu).toBe('Bearer jeton-abc');
  });

  it('n’envoie pas d’en-tête quand aucune session n’est ouverte', async () => {
    let recu = 'non-lu';
    serveur.use(
      http.get(`${BASE}/stats/public`, ({ request }) => {
        recu = request.headers.get('authorization');
        return HttpResponse.json({ rooms: 7 });
      }),
    );

    await get('/stats/public');
    expect(recu).toBeNull();
  });
});

describe('enveloppe d’erreur', () => {
  it('traduit une réponse d’erreur en ApiError porteuse du code', async () => {
    serveur.use(
      http.get(`${BASE}/rooms`, () =>
        HttpResponse.json(erreur('salle_introuvable', 'Salle introuvable.'), {
          status: 404,
        }),
      ),
    );

    await expect(get('/rooms')).rejects.toMatchObject({
      status: 404,
      code: 'salle_introuvable',
      message: 'Salle introuvable.',
    });
  });

  it('transporte le conflit qualifié et les alternatives d’un 409', async () => {
    serveur.use(
      http.post(`${BASE}/bookings`, () =>
        HttpResponse.json(
          erreur('conflit', 'Créneau déjà pris.', {
            conflict: { kind: 'identique', overlap_minutes: 60, blocking: true },
            alternatives: [{ kind: 'meme_salle_autre_creneau', score: 81 }],
          }),
          { status: 409 },
        ),
      ),
    );

    const refus = await post('/bookings', {}).catch((e) => e);
    expect(refus).toBeInstanceOf(ApiError);
    expect(refus.conflict.kind).toBe('identique');
    expect(refus.alternatives).toHaveLength(1);
  });

  it('expose les erreurs de champ pour l’affichage au bon endroit', async () => {
    serveur.use(
      http.post(`${BASE}/bookings`, () =>
        HttpResponse.json(
          // Forme réelle de l'API : une liste, et non un dictionnaire. Un
          // formulaire peut avoir deux erreurs sur le même champ, et l'ordre
          // des messages est celui de la validation.
          erreur('validation', 'Corps invalide.', {
            fields: [
              { field: 'title', message: 'Le titre est obligatoire.' },
              { field: 'slot.ends_at', message: 'La fin précède le début.' },
            ],
          }),
          { status: 422 },
        ),
      ),
    );

    const refus = await post('/bookings', {}).catch((e) => e);
    expect(refus.fieldError('title')).toBe('Le titre est obligatoire.');
    expect(refus.fieldError('slot.ends_at')).toBe('La fin précède le début.');
    expect(refus.fieldError('attendees')).toBeNull();
  });
});

describe('rafraîchissement sur 401', () => {
  it('rejoue la requête une fois le jeton renouvelé', async () => {
    let appelsRooms = 0;
    serveur.use(
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json({ access_token: 'jeton-neuf', scope: 'user', user: {} }),
      ),
      http.get(`${BASE}/rooms`, ({ request }) => {
        appelsRooms += 1;
        if (request.headers.get('authorization') !== 'Bearer jeton-neuf') {
          return HttpResponse.json(erreur('jeton_expire', 'Expiré.'), { status: 401 });
        }
        return HttpResponse.json(page([{ id: 'r1' }]));
      }),
    );
    setAccessToken('jeton-perime');

    const reponse = await get('/rooms');
    expect(items(reponse)).toHaveLength(1);
    expect(appelsRooms).toBe(2);
    expect(getAccessToken()).toBe('jeton-neuf');
  });

  it('ne déclenche qu’une seule rotation pour dix requêtes simultanées', async () => {
    // C'est la garantie qui protège la session : deux rotations concurrentes
    // présenteraient un jeton déjà tourné, que le serveur traite — à juste
    // titre — comme un rejeu et sanctionne en révoquant toute la famille.
    let rotations = 0;
    serveur.use(
      http.post(`${BASE}/auth/refresh`, async () => {
        rotations += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ access_token: 'jeton-neuf', scope: 'user', user: {} });
      }),
      http.get(`${BASE}/rooms`, ({ request }) =>
        request.headers.get('authorization') === 'Bearer jeton-neuf'
          ? HttpResponse.json(page([]))
          : HttpResponse.json(erreur('jeton_expire', 'Expiré.'), { status: 401 }),
      ),
    );
    setAccessToken('jeton-perime');

    await Promise.all(Array.from({ length: 10 }, () => get('/rooms')));
    expect(rotations).toBe(1);
  });

  it('ne réessaie qu’une fois si le jeton neuf est refusé à son tour', async () => {
    // Sans ce garde-fou, un serveur qui refuse tout ferait boucler le client
    // indéfiniment sur sa propre rotation.
    let appels = 0;
    serveur.use(
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json({ access_token: 'toujours-refuse', scope: 'user', user: {} }),
      ),
      http.get(`${BASE}/rooms`, () => {
        appels += 1;
        return HttpResponse.json(erreur('jeton_expire', 'Expiré.'), { status: 401 });
      }),
    );
    setAccessToken('jeton-perime');

    await get('/rooms').catch(() => {});
    expect(appels).toBe(2);
  });
});

describe('session perdue', () => {
  it('prévient tous les abonnés quand la rotation échoue', async () => {
    const espaceUtilisateur = vi.fn();
    const espaceAdministration = vi.fn();
    const desabonner = [
      onSessionExpired(espaceUtilisateur),
      onSessionExpired(espaceAdministration),
    ];

    serveur.use(
      http.post(`${BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
      http.get(`${BASE}/rooms`, () =>
        HttpResponse.json(erreur('jeton_expire', 'Expiré.'), { status: 401 }),
      ),
    );
    setAccessToken('jeton-perime');

    await get('/rooms').catch(() => {});

    // Les deux, et non le dernier inscrit : les deux contextes se montent
    // ensemble, et n'en prévenir qu'un laisserait l'autre afficher un profil
    // dont plus aucune requête n'aboutit.
    expect(espaceUtilisateur).toHaveBeenCalledTimes(1);
    expect(espaceAdministration).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();

    desabonner.forEach((retirer) => retirer());
  });

  it('cesse de prévenir un abonné qui s’est retiré', async () => {
    const rappel = vi.fn();
    const retirer = onSessionExpired(rappel);
    retirer();

    serveur.use(
      http.post(`${BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
      http.get(`${BASE}/rooms`, () =>
        HttpResponse.json(erreur('jeton_expire', 'Expiré.'), { status: 401 }),
      ),
    );
    setAccessToken('jeton-perime');

    await get('/rooms').catch(() => {});
    expect(rappel).not.toHaveBeenCalled();
  });
});

describe('reprise de session', () => {
  it('rend la charge du serveur et pose le jeton', async () => {
    serveur.use(
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json({
          access_token: 'jeton-repris',
          scope: 'user',
          user: { email: 'camille@ece.fr' },
        }),
      ),
    );

    const charge = await restoreSession();
    expect(charge.scope).toBe('user');
    expect(getAccessToken()).toBe('jeton-repris');
  });

  it('rend null sans cookie valide, sans lever', async () => {
    // Ce n'est pas une erreur : c'est l'état normal d'un visiteur qui n'a pas
    // encore ouvert de session, et le lever obligerait chaque appelant à
    // l'attraper pour l'ignorer.
    serveur.use(
      http.post(`${BASE}/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    );

    await expect(restoreSession()).resolves.toBeNull();
  });
});

describe('pagination', () => {
  it('déplie une réponse paginée en tableau simple', () => {
    expect(items(page([{ id: 1 }, { id: 2 }]))).toHaveLength(2);
    expect(items([{ id: 1 }])).toHaveLength(1);
    expect(items(null)).toEqual([]);
  });

  it('parcourt toutes les pages d’une collection bornée', async () => {
    serveur.use(
      http.get(`${BASE}/equipments`, ({ request }) => {
        const numero = Number(new URL(request.url).searchParams.get('page') ?? 1);
        return HttpResponse.json({
          items: [{ id: `eq-${numero}` }],
          total: 3,
          pagination: { page: numero, size: 1, pages: 3 },
        });
      }),
    );

    const tout = await collect('/equipments');
    expect(tout.map((item) => item.id)).toEqual(['eq-1', 'eq-2', 'eq-3']);
  });
});
