import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const source = path.resolve('..', 'presentation', 'diagrammes-source.html');
const sortie = path.resolve('..', 'presentation', 'SmartRoomManager-diagrammes-UML.pdf');

const navigateur = await chromium.launch();
const page = await navigateur.newPage();
await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });

await page.pdf({
  path: sortie,
  printBackground: true,
  preferCSSPageSize: true, // laisse les regles @page nommees choisir portrait ou paysage
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%; font-family:'Segoe UI',Arial,sans-serif; font-size:7.5pt;
                color:#858b95; padding:0 12mm; display:flex; justify-content:space-between;">
      <span>SmartRoom Manager — Diagrammes UML · ECE Paris, Bachelor 3 Data &amp; IA</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
});

await navigateur.close();
console.log('PDF ecrit : ' + sortie);
