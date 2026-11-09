/**
 * Rend le film de démonstration `motion-design.html` en vidéo.
 *
 *   node video/rendre-video.mjs            # public/demo-smartroom.webm + affiche
 *   node video/rendre-video.mjs --fps 24   # plus léger
 *   node video/rendre-video.mjs --limite 30   # essai sur les 30 premières images
 *
 * Chaque image est posée par `window.rendre(t)`, puis capturée : le film ne
 * dépend pas de la vitesse de la machine, contrairement à un enregistrement
 * d'écran, et ne saute jamais d'image.
 *
 * L'encodage passe par le ffmpeg que Playwright installe avec Chromium
 * (`ms-playwright/ffmpeg-*`). Il ne connaît que VP8 : le film sort donc en
 * WebM, lu par Chrome, Edge, Firefox et Safari récents.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ici = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const FPS = Number(args[args.indexOf('--fps') + 1]) || 30;
const SORTIE = resolve(ici, '../public/demo-smartroom.webm');
const AFFICHE = resolve(ici, '../public/demo-smartroom.webp');

function trouverFfmpeg() {
  const racines = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'AppData/Local/ms-playwright'),
    join(homedir(), '.cache/ms-playwright'),
    join(homedir(), 'Library/Caches/ms-playwright'),
  ].filter(Boolean);
  for (const racine of racines) {
    if (!existsSync(racine)) continue;
    for (const dossier of readdirSync(racine).filter((d) => d.startsWith('ffmpeg'))) {
      for (const nom of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac']) {
        const chemin = join(racine, dossier, nom);
        if (existsSync(chemin)) return chemin;
      }
    }
  }
  throw new Error('ffmpeg de Playwright introuvable : lancez `npx playwright install`.');
}

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(join(ici, 'motion-design.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState('networkidle');

const duree = await page.evaluate(() => window.DUREE);
const limite = args.includes('--limite') ? Number(args[args.indexOf('--limite') + 1]) : Infinity;
const total = Math.min(Math.round(duree * FPS), limite);

// Les images s'écrivent à la suite dans un flux MJPEG, que ffmpeg lit
// ensuite comme un fichier : la version livrée avec Playwright ne sait pas lire
// l'entrée standard (protocole `pipe` absent de sa compilation).
const flux = join(mkdtempSync(join(tmpdir(), 'smartroom-film-')), 'images.mjpeg');
const ecriture = createWriteStream(flux);

for (let image = 0; image < total; image += 1) {
  const t = image / FPS;
  await page.evaluate((instant) => window.rendre(instant), t);
  const capture = await page.screenshot({ type: 'jpeg', quality: 94 });
  if (!ecriture.write(capture)) await new Promise((r) => ecriture.once('drain', r));
  if (image % FPS === 0) process.stdout.write(`\rcapture ${Math.round((image / total) * 100)} %`);
}
await new Promise((r) => ecriture.end(r));
process.stdout.write('\rcapture 100 % — encodage…\n');

await new Promise((r, e) => {
  const ffmpeg = spawn(
    trouverFfmpeg(),
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', flux,
      '-c:v', 'libvpx', '-b:v', '4M', '-crf', '6', '-qmin', '2', '-qmax', '24',
      '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '1',
      SORTIE,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  ffmpeg.on('error', e);
  ffmpeg.on('close', (code) => (code === 0 ? r() : e(new Error(`ffmpeg a échoué (code ${code})`))));
});
rmSync(dirname(flux), { recursive: true, force: true });

// Affiche : l'instant où la recommandation est posée, le plus parlant du film.
await page.evaluate(() => window.rendre(11.6));
await page.screenshot({ path: AFFICHE.replace('.webp', '.png') });
const png = await page.screenshot({ type: 'png' });
const webp = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.82).split(',')[1];
}, png.toString('base64'));
writeFileSync(AFFICHE, Buffer.from(webp, 'base64'));
rmSync(AFFICHE.replace('.webp', '.png'), { force: true });

await navigateur.close();
console.log(`\n${total} images → ${SORTIE}`);
