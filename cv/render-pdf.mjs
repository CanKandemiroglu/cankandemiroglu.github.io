// Render the CV design to an exact, vector PDF (selectable text, A4, 2 pages).
//
//   npm install
//   npx playwright install chromium
//   npm run pdf
//
// Output: "Osman-Can-Kandemiroglu-CV.pdf" in this folder.
//
// How it works: a tiny static server serves the design; headless Chromium
// loads it, waits for the fonts + layout, then prints using the design's own
// @page rules (A4, correct margins, background graphics). pdf-lib then writes
// clean document metadata (no tool/AI fingerprints).
//
// If you already have a Chromium build on disk (e.g. a system browser), set
// CHROMIUM_PATH to its executable to skip `npx playwright install`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PAGE = 'cv.dc.html';
const OUT = 'Osman-Can-Kandemiroglu-CV.pdf';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/' + PAGE;
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/${encodeURIComponent(PAGE)}`;
console.log('Serving', url);

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('.sheet', { timeout: 30000 });         // design has rendered
await page.evaluate(async () => { try { await document.fonts.ready; } catch {} });
await page.waitForTimeout(500);                                    // settle web fonts

const raw = await page.pdf({
  format: 'A4',
  printBackground: true,        // accent rules & colours
  preferCSSPageSize: true,      // use the design's own @page A4 + margins
});
await browser.close();
server.close();

// --- clean metadata: identify as the applicant's document, nothing else ---
// updateMetadata:false stops pdf-lib from re-stamping itself as Producer on
// save, so the cleared Producer/Creator below are preserved in the output.
const doc = await PDFDocument.load(raw, { updateMetadata: false });
doc.setTitle('Curriculum Vitae');
doc.setAuthor('Osman Can Kandemiroglu');
doc.setSubject('Curriculum Vitae');
doc.setKeywords([]);
doc.setProducer('');
doc.setCreator('');
const now = new Date();
doc.setCreationDate(now);
doc.setModificationDate(now);
const bytes = await doc.save();
fs.writeFileSync(path.join(ROOT, OUT), bytes);
console.log('Wrote', OUT, `(${bytes.length} bytes)`);
