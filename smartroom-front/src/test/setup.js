// Mise en place commune à tous les tests du front.
//
// Le serveur d'interception est démarré une fois pour la session et remis à
// zéro entre chaque test : un gestionnaire posé par un test ne doit pas
// survivre au suivant, sinon l'ordre d'exécution deviendrait signifiant.

import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setAccessToken } from '../api/client';
import { serveur } from './serveur';

/**
 * Recolle deux moitiés de plateforme que l'environnement de test sépare.
 *
 * jsdom fournit `AbortController`, `fetch` vient de Node : passer le signal de
 * l'un à l'autre lève « Expected signal to be an instance of AbortSignal ». Or
 * toutes les fonctions de `src/api` annulent leurs requêtes par clé et passent
 * donc un signal — sans ce recollage, la moitié des modules serait intestable.
 *
 * Deux raisons de ne pas retirer purement le signal du produit : dans un
 * navigateur réel les deux implémentations viennent de la même plateforme, et
 * l'annulation par clé est ce qui empêche une recherche tapée vite de voir ses
 * réponses s'écraser dans le désordre. Le comportement d'annulation lui-même
 * est vérifié à part, sans réseau, par `abortable`.
 */
function reconcilierAbortSignal() {
  const natif = globalThis.fetch;
  let compatible = true;
  try {
    new Request('http://localhost/', { signal: new AbortController().signal });
  } catch {
    compatible = false;
  }
  if (compatible) return;

  globalThis.fetch = (entree, options = {}) => {
    const { signal, ...reste } = options;
    return natif(entree, reste);
  };
}

beforeAll(() => {
  // `error` et non `warn` : une requête non interceptée est un test qui parle
  // au réseau réel. Mieux vaut qu'il échoue bruyamment.
  serveur.listen({ onUnhandledRequest: 'error' });
  // Après l'interception, et non avant : `listen` remplace `fetch` par son
  // intercepteur, et une enveloppe posée plus tôt serait écrasée.
  reconcilierAbortSignal();
});

afterEach(() => {
  serveur.resetHandlers();
  cleanup();
  // Le jeton vit en mémoire dans le module : sans remise à zéro, un test
  // connecté rendrait le suivant connecté sans qu'il l'ait demandé.
  setAccessToken(null);
});

afterAll(() => serveur.close());
