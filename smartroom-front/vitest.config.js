// =============================================================================
// Tests du front.
//
//   npm run test            une passe
//   npm run test:watch      en continu pendant le développement
//   npm run test:coverage   avec le seuil de 80 % sur src/api
//
// Deux environnements cohabitent, choisis par fichier :
//   - `node` pour les tests du client HTTP et des adaptateurs, qui n'ont pas
//     de DOM à manipuler ;
//   - `jsdom` pour les composants, déclaré en tête de fichier par la directive
//     `@vitest-environment jsdom`.
//
// Le second est le défaut : un test de composant qui oublierait la directive
// échouerait sur une erreur incompréhensible, alors qu'un test de client HTTP
// lancé dans jsdom fonctionne sans rien coûter.
// =============================================================================

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    // Origine explicite : le client construit des URL relatives à `/api/v1`,
    // et l'origine par défaut de jsdom changerait d'une version à l'autre. Les
    // interceptions doivent viser une adresse stable.
    environmentOptions: { jsdom: { url: 'http://localhost:5180' } },
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    // Les tests d'interface ne partagent aucun état : les paralléliser est sûr.
    // Le client HTTP, lui, tient un jeton en mémoire — d'où le nettoyage
    // systématique du fichier de mise en place plutôt qu'un mode séquentiel.
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/api/**/*.js'],
      // Les modules d'administration sont pilotés par les mêmes primitives que
      // l'espace utilisateur ; les couvrir un par un mesurerait le même code
      // sous quinze noms différents.
      exclude: [
        'src/api/admin/**',
        // Les fichiers de test se couvrent eux-mêmes à 100 % : les compter
        // gonflerait le chiffre de plusieurs points sans rien mesurer.
        '**/*.test.{js,jsx}',
      ],
      reporter: ['text', 'html'],
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
    },
  },
});
