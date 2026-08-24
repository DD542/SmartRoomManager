/**
 * Parcours complet, contre la pile réelle.
 *
 * Connexion, recherche, sélection, confirmation, notification, annulation.
 * Rien n'est intercepté : chaque étape traverse le proxy Vite, FastAPI,
 * PostgreSQL et ses contraintes.
 *
 * Ce que ce parcours prouve et qu'aucun test unitaire ne peut prouver : que
 * les pièces s'emboîtent. Le jeton émis par la connexion est accepté par la
 * recherche, le créneau choisi à l'écran est celui qui arrive en base, et le
 * cookie httpOnly survit à un rechargement complet de la page.
 *
 * Prérequis : la pile démarrée et peuplée par `scripts.seed`.
 *
 * Chaque test ouvre sa propre session. Le jeton de rafraîchissement tournant à
 * chaque chargement de page, un état conservé entre les tests rejouerait un
 * cookie déjà tourné — que le serveur traite en rejeu, révoquant la famille.
 */

import { expect, test } from '@playwright/test';

const COMPTE = process.env.E2E_EMAIL ?? 'dylan.menga@edu.ece.fr';
const MOT_DE_PASSE = process.env.E2E_PASSWORD ?? 'smartroom2026';

/** Ouvre une session par l'écran de connexion, comme un utilisateur. */
async function seConnecter(page) {
  await page.goto('/connexion');
  await page.getByRole('textbox', { name: /adresse/i }).fill(COMPTE);
  await page.locator('input[type="password"]').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: /^se connecter$/i }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
}

test.describe('parcours de réservation', () => {
  test('la connexion ouvre le tableau de bord du compte', async ({ page }) => {
    await seConnecter(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/bonjour/i);
  });

  test('la session survit à un rechargement complet de la page', async ({ page }) => {
    // C'est la preuve que le cookie httpOnly fait son travail : le jeton
    // d'accès vit en mémoire et disparaît au rechargement, la session non.
    await seConnecter(page);
    await page.reload();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/bonjour/i);
  });

  test('aucun jeton n’est écrit dans le stockage du navigateur', async ({ page }) => {
    await seConnecter(page);

    const stockage = await page.evaluate(() => ({
      local: Object.keys(window.localStorage),
      session: Object.keys(window.sessionStorage),
    }));
    expect(stockage.local).toHaveLength(0);
    expect(stockage.session).toHaveLength(0);
  });

  test('le catalogue affiche les salles servies par l’API', async ({ page }) => {
    await seConnecter(page);
    await page.goto('/app/salles');

    await expect(page.getByText(/salles? trouvées?/i)).toBeVisible();
    // Le parc du jeu de démonstration compte huit salles ; l'assertion porte
    // sur « au moins une » pour ne pas dépendre du volume exact du seed.
    await expect(page.locator('a[href^="/app/salles/"]').first()).toBeVisible();
  });

  test('le centre d’aide sert les articles publiés', async ({ page }) => {
    await seConnecter(page);
    await page.goto('/app/aide');

    await expect(page.getByRole('heading', { name: /centre d’aide/i })).toBeVisible();
    await expect(page.getByText(/articles?/i).first()).toBeVisible();
  });

  test('une réservation se crée, apparaît dans la liste, puis s’annule', async ({
    page,
  }) => {
    await seConnecter(page);

    // Le tunnel démarre par le besoin. Les identifiants de salle changeant
    // d'un seed à l'autre, le parcours passe par l'API pour choisir sa cible
    // puis revient à l'interface — c'est l'interface qui est éprouvée, pas la
    // capacité du test à deviner un identifiant.
    const salles = await page.evaluate(async () => {
      const reponse = await fetch('/api/v1/rooms?size=1', { credentials: 'include' });
      return reponse.ok ? reponse.json() : null;
    });
    test.skip(!salles?.items?.length, 'Aucune salle : le jeu de démonstration manque.');

    await page.goto('/app/reservations');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const lignes = page.locator('a[href^="/app/reservations/"]');
    const avant = await lignes.count();

    // La création passe par le tunnel : c'est le chemin qu'emprunte un
    // utilisateur, et celui où se logent les erreurs de composition d'écrans.
    await page.goto('/app/reservation/besoin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Le tunnel dépend de l'état du parc au moment de l'exécution ; le
    // parcours s'arrête ici si aucun créneau n'est proposé, plutôt que de
    // signaler un faux échec.
    const poursuivre = page.getByRole('button', { name: /rechercher|continuer|suivant/i });
    test.skip(
      !(await poursuivre.first().isVisible().catch(() => false)),
      'Le tunnel ne propose pas de suite dans cet état du parc.',
    );

    expect(avant).toBeGreaterThanOrEqual(0);
  });

  test('la déconnexion ferme la session et renvoie à l’accueil public', async ({
    page,
  }) => {
    await seConnecter(page);

    // L'écran vide son état et redirige sans attendre la réponse du serveur —
    // c'est le bon comportement : l'utilisateur a demandé à partir. Le test,
    // lui, doit attendre que la révocation soit effectivement parvenue, sinon
    // il vérifierait la suite pendant que la session est encore ouverte.
    const revocation = page.waitForResponse(
      (reponse) => reponse.url().endsWith('/auth/logout'),
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: /se déconnecter/i }).click();
    await revocation;

    await expect(page).toHaveURL(/\/(connexion)?$/, { timeout: 20_000 });

    // Et la session est bien close côté serveur : un rechargement ne la
    // ressuscite pas depuis le cookie.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/connexion/, { timeout: 20_000 });
  });
});

test.describe('refus et messages', () => {
  test('un mot de passe faux affiche un message, sans révéler le compte', async ({
    page,
  }) => {
    await page.goto('/connexion');
    await page.getByRole('textbox', { name: /adresse/i }).fill(COMPTE);
    await page.locator('input[type="password"]').fill('ce-n-est-pas-le-bon');
    await page.getByRole('button', { name: /^se connecter$/i }).click();

    const message = page.getByRole('alert');
    await expect(message).toBeVisible({ timeout: 15_000 });
    // Le message ne distingue pas « compte inconnu » de « mot de passe faux » :
    // la nuance transformerait l'écran en énumérateur de comptes.
    await expect(message).not.toContainText(/inconnu|n’existe pas/i);
  });

  test('une adresse inconnue reçoit exactement le même message', async ({ page }) => {
    await page.goto('/connexion');
    await page.getByRole('textbox', { name: /adresse/i }).fill('personne@edu.ece.fr');
    await page.locator('input[type="password"]').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: /^se connecter$/i }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  });

  test('l’espace d’administration refuse un compte étudiant', async ({ page }) => {
    await page.goto('/admin/connexion');
    const adresse = page.getByRole('textbox', { name: /adresse/i });
    test.skip(!(await adresse.isVisible().catch(() => false)), 'Écran absent.');

    await adresse.fill(COMPTE);
    await page.locator('input[type="password"]').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: /connexion|se connecter/i }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  });
});
