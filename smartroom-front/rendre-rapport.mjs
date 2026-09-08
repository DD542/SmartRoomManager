import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const source = path.resolve('..', 'presentation', 'rapport-source.html');
const sortie = path.resolve('..', 'presentation', 'SmartRoomManager-rapport-de-projet.pdf');

const navigateur = await chromium.launch();
const page = await navigateur.newPage();
await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });

await page.pdf({
  path: sortie,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%; font-family:'Segoe UI',Arial,sans-serif; font-size:8pt;
                color:#8a9099; padding:0 16mm; display:flex; justify-content:space-between;">
      <span>SmartRoom Manager — Rapport de projet · ECE Paris, Bachelor 3 Data &amp; IA</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
});

await navigateur.close();
console.log('PDF ecrit : ' + sortie);
