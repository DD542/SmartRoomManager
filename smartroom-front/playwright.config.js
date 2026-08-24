// =============================================================================
// Parcours de bout en bout.
//
//   npm run test:e2e
//
// Exécuté contre la pile réelle : PostgreSQL, FastAPI et le front servi par
// Vite. Rien n'est intercepté — c'est la différence avec les tests Vitest, et
// c'est ce qui donne à ce parcours sa valeur : il traverse la contrainte
// d'exclusion, le JWT, le cookie httpOnly et le proxy.
//
// La pile est supposée démarrée. `docker compose -f docker-compose.test.yml up`
// la monte, seed compris ; sans elle, les tests échouent immédiatement plutôt
// que de partir en attente.
//
// Chaque test ouvre sa propre session. Conserver un état entre les tests a été
// essayé et ne marche pas : le jeton de rafraîchissement tourne à chaque
// chargement de page, et rejouer un cookie déjà tourné déclenche la détection
// de rejeu — le serveur révoque alors toute la famille, et les tests suivants
// se retrouvent déconnectés. La protection fait son travail.
//
// La contrepartie est le limiteur, à cinq connexions par minute. La pile
// d'intégration le relève par `RATE_LIMIT_LOGIN` ; il garde son propre test
// côté back, qui le réactive et vérifie le 429.
// =============================================================================

import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5180';

export default defineConfig({
  testDir: './e2e',
  // Un parcours complet dépasse la seconde : le plafond protège contre une
  // attente infinie, pas contre la lenteur normale.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Séquentiel et un seul essai : le parcours écrit en base, et deux exécutions
  // parallèles se disputeraient le même créneau — ce que la contrainte
  // d'exclusion refuserait, produisant un échec qui ne dirait rien du produit.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // Conservés au premier échec seulement : une trace par test remplirait le
    // disque sans rien apprendre sur les cas qui passent.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
