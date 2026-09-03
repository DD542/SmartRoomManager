// =============================================================================
// Parcours d'administration, de bout en bout.
//
//   npm run test:e2e
//
// Le complément indispensable de `parcours-complet.spec.js` : celui-ci traverse
// l'espace utilisateur, celui-là l'espace d'administration — dix-huit écrans
// qui n'avaient jamais été ouverts dans un navigateur après la réécriture de la
// couche d'appel. C'est cette absence qui a laissé passer un écran blanc, une
// file bloquée sur son squelette et une navigation mobile inexistante.
//
// Ce que ces tests couvrent et que les tests Vitest ne peuvent pas : le rendu
// réel de chaque écran contre la base de démonstration, et le fait qu'aucun
// d'eux ne réponde 5xx ni ne plante au montage.
//
// Deux parcours seulement, l'un au format bureau et l'autre au doigt, chacun
// enchaînant plusieurs vérifications. Ce n'est pas de l'économie de style : le
// limiteur d'authentification accepte cinq connexions par minute, et chaque
// test ouvre nécessairement sa propre session — un jeton de rafraîchissement
// rejoué déclenche la détection de rejeu et révoque toute la famille. Découpé
// plus finement, ce fichier ferait tomber la suite sur un 429 qui ne dirait
// rien du produit.
// =============================================================================

import { expect, test } from '@playwright/test';

const ADMIN = process.env.E2E_ADMIN_EMAIL ?? 'd.menga@ece.fr';
const MOT_DE_PASSE = process.env.E2E_ADMIN_PASSWORD ?? 'smartroom2026';

/** Les dix-sept écrans atteignables depuis la navigation. */
const ECRANS = [
  ['/admin', /Tableau de bord|Pilotage/i],
  ['/admin/rapports', /Statistiques|rapports/i],
  ['/admin/reservations', /Toutes les réservations/i],
  ['/admin/conflits', /Conflits et demandes/i],
  ['/admin/batiments', /Bâtiments/i],
  ['/admin/salles', /Gestion des salles/i],
  ['/admin/equipements', /Catalogue des équipements/i],
  ['/admin/plans', /Plans de localisation/i],
  ['/admin/ouvertures', /Calendriers d’ouverture/i],
  ['/admin/regles', /Règles de réservation/i],
  ['/admin/utilisateurs', /Utilisateurs/i],
  ['/admin/roles', /Rôles et permissions/i],
  ['/admin/tickets', /Tickets/i],
  ['/admin/connaissances', /Base de connaissances/i],
  ['/admin/modeles', /Modèles d’e-mails/i],
  ['/admin/audit', /Journal d’audit/i],
];

async function seConnecterAdmin(page) {
  await page.goto('/admin/connexion');
  await page.getByRole('textbox', { name: /adresse/i }).fill(ADMIN);
  await page.locator('input[type="password"]').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: /^se connecter$/i }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 20_000 });
}

test.describe('espace d’administration', () => {
  test('les écrans se chargent, s’ouvrent et gardent leurs gardes-fous', async ({
    page,
  }) => {
    await seConnecterAdmin(page);
    // Le filet le plus large du lot : il aurait attrapé d'un coup le 500 de
    // `/admin/accounts`, le 500 du journal d'audit et le 422 des statistiques.
    const echecs = [];
    const plantages = [];
    page.on('response', (reponse) => {
      if (reponse.url().includes('/api/v1/') && reponse.status() >= 400) {
        // Le 404 d'un étage sans plan déposé est un état vide légitime.
        if (!(reponse.status() === 404 && reponse.url().includes('/plan'))) {
          echecs.push(`${reponse.status()} ${new URL(reponse.url()).pathname}`);
        }
      }
    });
    page.on('pageerror', (erreur) => plantages.push(erreur.message));

    for (const [chemin, titre] of ECRANS) {
      await page.goto(chemin);
      await expect(page.locator('main')).toContainText(titre, { timeout: 20_000 });
      // Un squelette encore présent après le titre signale une requête annulée
      // qui ne reviendra jamais — le symptôme des clés d'annulation partagées.
      await expect(page.locator('main [class*="animate-pulse"]')).toHaveCount(0, {
        timeout: 15_000,
      });
    }

    expect(echecs, `réponses en erreur : ${echecs.join(', ')}`).toEqual([]);
    expect(plantages, `erreurs JavaScript : ${plantages.join(' | ')}`).toEqual([]);

    // --- Détail d'un conflit -------------------------------------------------
    // Il plantait entièrement : `AlternativeList` lit `entree.room.id` alors
    // que l'API ne rend qu'un `room_id`.
    await page.goto('/admin/conflits');
    const premier = page.locator('main li button').first();
    if ((await premier.count()) > 0) {
      await premier.click();
      const detail = page.locator('main');
      await expect(detail).toContainText(/#[A-Z]+-\d+/, { timeout: 15_000 });
      // Aucun identifiant technique ne doit rester à l'écran.
      await expect(detail).not.toContainText(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
      );
    }

    // --- Menu du compte et écran de profil -----------------------------------
    // L'avatar de la barre haute était un carré de couleur sans action : le
    // seul point qui parle du compte ne menait nulle part.
    await page.goto('/admin');
    await page.getByRole('button', { name: /Mon compte/ }).click();
    const compte = page.getByRole('menu');
    await expect(compte).toBeVisible();
    await compte.getByRole('menuitem', { name: /Mon profil/ }).click();

    await expect(page).toHaveURL(/\/admin\/profil$/);
    await expect(page.locator('main')).toContainText('Sessions ouvertes');
    // La session qui consulte doit se reconnaître, sinon fermer « les autres »
    // reviendrait à se déconnecter soi-même sans le savoir.
    await expect(page.locator('main')).toContainText('Cet appareil');

    // --- Garde-fou de la suspension -----------------------------------------
    // Elle partait d'un seul clic, le motif étant fabriqué côté écran.
    await page.goto('/admin/utilisateurs');
    // La fiche s'ouvre depuis le bouton de la ligne, pas depuis la ligne
    // elle-même : `tbody tr` n'est pas cliquable, et le sélectionner faisait
    // échouer le test sur une modale jamais ouverte.
    await page.locator('main tbody tr:visible, main li button:visible').first().click();

    // Le compte ouvert peut être actif ou suspendu selon l'état de la base :
    // les deux décisions passent par la même modale et exigent le même motif.
    const bascule = page.getByRole('button', {
      name: /(Suspendre|Réactiver) le compte/,
    });
    await expect(bascule).toBeVisible({ timeout: 15_000 });
    const suspension = (await bascule.innerText()).includes('Suspendre');
    await bascule.click();

    const modale = page.getByRole('dialog');
    await expect(modale).toBeVisible();
    const valider = modale.getByRole('button', {
      name: suspension ? /^Suspendre$/ : /^Réactiver$/,
    });
    await expect(valider).toBeDisabled();

    // On renonce : le test vérifie la garde, pas la décision elle-même, dont
    // l'effet est éprouvé côté back.
    await modale.getByRole('button', { name: /^Annuler$/ }).click();
    await expect(modale).toBeHidden();
  });
});

test.describe('administration au doigt', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('les écrans restent atteignables et ne débordent pas', async ({ page }) => {
    // Sous ce seuil la barre latérale disparaît, et la liste des liens était
    // enfermée dedans : dix-sept écrans sur dix-huit devenaient inatteignables,
    // sans le moindre bouton de menu pour les rouvrir.
    await seConnecterAdmin(page);

    // Le declencheur porte le mot « Menu » **ecrit**, et pas seulement lu par
    // les lecteurs d'ecran : trois traits ne disent pas qu'ils cachent
    // dix-huit ecrans, et la navigation avait ete rapportee comme absente
    // alors qu'elle etait la. Le chercher sous un autre nom accessible
    // reviendrait a exiger un `aria-label` qui masquerait ce texte visible,
    // contre WCAG 2.5.3.
    const menu = page.getByRole('button', { name: /^menu$/i });
    await expect(menu).toBeVisible();
    await menu.click();

    const feuille = page.getByRole('dialog');
    await expect(feuille).toBeVisible();
    expect(await feuille.getByRole('link').count()).toBeGreaterThanOrEqual(10);

    await feuille.getByRole('link', { name: 'Utilisateurs' }).click();
    await expect(page).toHaveURL(/\/admin\/utilisateurs$/);
    // La feuille se referme d'elle-même : la garder ouverte masquerait l'écran
    // que l'on vient de demander.
    await expect(feuille).toBeHidden();

    // --- Aucun défilement latéral de la page --------------------------------
    // Les tables denses cèdent la place à des cartes sous 1024 px ; le seuil
    // était réglé à 768. Et la carte de densité imposait 520 px de large sur un
    // écran de 375, faisant défiler la page entière de 155 px — un conteneur
    // `overflow-x-auto` ne suffisait pas à la contenir.
    for (const [chemin] of ECRANS) {
      await page.goto(chemin);
      await page.waitForLoadState('networkidle');
      const debordement = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(debordement, `débordement sur ${chemin}`).toBeLessThanOrEqual(2);
    }
  });
});
