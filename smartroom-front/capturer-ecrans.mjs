import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://smartroommanager.vercel.app';
const DOSSIER = path.resolve('..', 'presentation', 'captures');
fs.mkdirSync(DOSSIER, { recursive: true });

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 } });
const page = await contexte.newPage();

async function tirer(nom) {
  await page.screenshot({ path: path.join(DOSSIER, nom + '.png') });
  console.log('OK    ' + nom);
}

async function capturer(nom, url) {
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(1500);
    await tirer(nom);
  } catch (e) {
    console.log('ECHEC ' + nom + ' : ' + String(e).split('\n')[0]);
  }
}

await capturer('01-vitrine', '/presentation');
await capturer('02-connexion', '/connexion');

try {
  await page.goto(BASE + '/connexion', { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByLabel(/adresse|e-?mail/i).first().fill('jean.dupont@edu.ece.fr');
  await page.getByLabel(/mot de passe/i).first().fill('smartroom2026');
  await page.getByRole('button', { name: /connexion|se connecter/i }).first().click();
  await page.waitForURL(/\/app/, { timeout: 60000 });
  console.log('session utilisateur ouverte');

  await capturer('03-tableau-de-bord', '/app');
  await capturer('04-catalogue', '/app/salles');
  await capturer('05-reservations', '/app/reservations');
  await capturer('06-statistiques', '/app/statistiques');
  await capturer('07-tunnel-besoin', '/app/reservation/besoin');

  // --- l'assistant : panneau flottant, monte dans AppLayout ---------------
  await page.goto(BASE + '/app', { waitUntil: 'networkidle', timeout: 90000 });
  await page.getByLabel('Ouvrir l’assistant').click();
  await page.waitForTimeout(1200);
  const champ = page.getByLabel('Message pour l’assistant');
  await champ.fill('Où se trouve la salle Hopper ?');
  await page.getByLabel('Envoyer').click();
  await page.waitForTimeout(14000); // reveil a froid de l'API + tour de modele
  await tirer('08-assistant');
} catch (e) {
  console.log('ECHEC session : ' + String(e).split('\n')[0]);
}

await navigateur.close();
console.log('\nCaptures :');
for (const f of fs.readdirSync(DOSSIER).sort()) {
  console.log('  ' + f + '  ' + Math.round(fs.statSync(path.join(DOSSIER, f)).size / 1024) + ' Ko');
}
