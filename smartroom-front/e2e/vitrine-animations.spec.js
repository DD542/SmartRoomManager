/**
 * Apparitions au défilement de la page publique.
 *
 * Le comportement ne s'observe que dans un navigateur qui peint réellement :
 * `IntersectionObserver` ne répond pas sans rendu, et jsdom n'en a pas. Ce
 * parcours est donc le seul endroit où l'animation peut être éprouvée.
 *
 * Ce qui est vérifié tient en trois points, et le troisième est le plus
 * important : ce qui est en bas de page doit finir par se montrer. Une
 * apparition ratée laisse du contenu invisible — un défaut bien pire que pas
 * d'animation du tout.
 */

import { expect, test } from '@playwright/test';

test.describe('page de présentation', () => {
  test('le haut de page est là dès l’ouverture', async ({ page }) => {
    await page.goto('/presentation');

    const premier = page.locator('.reveal').first();
    await expect(premier).toHaveAttribute('data-visible', 'true', { timeout: 10_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('le bas de page attend le défilement, puis se montre', async ({ page }) => {
    await page.goto('/presentation');

    // La page fait plusieurs hauteurs d'écran : ce qui la termine ne peut pas
    // être visible tant qu'on n'y est pas allé.
    const dernier = page.locator('.reveal').last();
    await expect(dernier).toHaveAttribute('data-visible', 'false');
    expect(await dernier.evaluate((n) => Number(getComputedStyle(n).opacity))).toBeLessThan(0.2);

    await dernier.scrollIntoViewIfNeeded();

    await expect(dernier).toHaveAttribute('data-visible', 'true', { timeout: 10_000 });
    await expect
      .poll(async () => dernier.evaluate((n) => Number(getComputedStyle(n).opacity)), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0.95);
  });

  test('tout finit visible après un parcours complet', async ({ page }) => {
    await page.goto('/presentation');

    // Défilement par écrans, comme un visiteur — et non un saut jusqu'en bas,
    // qui sauterait aussi les sections intermédiaires.
    const hauteur = await page.evaluate(() => window.innerHeight);
    const total = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < total; y += hauteur) {
      await page.evaluate((position) => window.scrollTo(0, position), y);
      await page.waitForTimeout(150);
    }

    await expect
      .poll(
        async () =>
          page.evaluate(
            () => document.querySelectorAll('.reveal:not([data-visible="true"])').length,
          ),
        { timeout: 10_000 },
      )
      .toBe(0);
  });

  test('les chiffres du bandeau montent jusqu’à leur valeur', async ({ page }) => {
    await page.goto('/presentation');

    // Le compte part de zéro : la valeur affichée doit rejoindre celle que
    // l'API annonce, sinon l'animation aurait remplacé la donnée.
    const attendu = await page.evaluate(async () => {
      const reponse = await fetch('/api/v1/stats/public');
      return (await reponse.json()).rooms;
    });

    const salles = page.locator('dl div', { hasText: 'Salles connectées' }).locator('dd');
    await expect(salles).toHaveText(String(attendu), { timeout: 10_000 });
  });
});
