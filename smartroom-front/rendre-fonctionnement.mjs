import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const source = path.resolve('..', 'presentation', 'fonctionnement-source.html');
const sortie = path.resolve('..', 'presentation', 'SmartRoomManager-fonctionnement.pdf');

const navigateur = await chromium.launch();
const page = await navigateur.newPage();
await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });

await page.pdf({
  path: sortie,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%; font-family:'Segoe UI',Arial,sans-serif; font-size:8pt;
                color:#868c96; padding:0 18mm; display:flex; justify-content:space-between;">
      <span>SmartRoom Manager — Comment chaque fonctionnalite marche · ECE Paris, Bachelor 3 Data &amp; IA</span>
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`,
});

await navigateur.close();
console.log('PDF ecrit : ' + sortie);
