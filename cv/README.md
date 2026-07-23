# CV → exact PDF (headless Chromium)

This bundle renders the CV **exactly as designed** — the same two‑page A4 layout, fonts, spacing and accent rules you see in the preview — to a real **vector PDF** with selectable, searchable text. It is not a screenshot: text stays live and the file is small.

## What's in here

| File | What it is |
|------|------------|
| `cv.dc.html` | The CV design (a self‑rendering HTML "Design Component"). This is the source of truth for the layout. |
| `support.js` | Runtime the design needs to render. Keep it next to `cv.dc.html`. |
| `render-pdf.mjs` | Node script: serves the design, prints it with headless Chromium, then writes clean PDF metadata. |
| `package.json` | Dependencies (`playwright`, `pdf-lib`). |

## Quick start

```bash
cd design_handoff_cv_pdf
npm install
npx playwright install chromium   # one‑time: download the Chromium build
npm run pdf
```

Output: **`Osman-Can-Kandemiroglu-CV.pdf`** in this folder — A4, 2 pages, vector, selectable text.

If you already have a Chromium build on disk (e.g. a system browser) you can skip the `playwright install` step by pointing the script at it:

```bash
CHROMIUM_PATH=/path/to/chrome npm run pdf
```

## Why this reproduces the design exactly

The design carries its own print geometry (`@page { size: A4; margin: 12mm 14mm }` plus print rules). The script prints with:

- `preferCSSPageSize: true` → Chromium uses the design's own A4 page size and margins (not Chrome's defaults).
- `printBackground: true` → the accent hairlines and colours render.
- a wait on `document.fonts.ready` → the Google Fonts (**Spectral**, **IBM Plex Sans**, **IBM Plex Mono**) are loaded before printing.

Page breaks are handled by the design itself (`break-inside: avoid` on every entry), so no line is ever cut across the page boundary.

## Metadata (no tool / AI fingerprints)

After printing, `pdf-lib` rewrites the document properties:

- Title → "Curriculum Vitae", Author → "Osman Can Kandemiroglu"
- Producer / Creator → emptied; Keywords → none; dates → render time

So the finished PDF's properties name only the applicant. (Chromium's raw output would otherwise list "Skia/PDF" as producer — harmless, but this removes it.)

## No‑Node alternative (manual, still vector)

Open `cv.dc.html` in Chrome or Edge → **Print** (Ctrl/Cmd‑P) →
**Destination: Save as PDF · Paper: A4 · Margins: Default · ✔ Background graphics** → Save.
This produces the same exact vector PDF; only the document metadata won't be normalized. In Chrome's print dialog choose **Save as PDF · A4 · Margins: Default · ✔ Background graphics**; the file will be named by hand rather than `Osman-Can-Kandemiroglu-CV.pdf`.

## Fonts / offline

The fonts load from Google Fonts, so the first render needs internet. To make it fully offline/deterministic, download the three font families and swap the `<link href="https://fonts.googleapis.com/…">` in `cv.dc.html` for local `@font-face` rules — the layout is unaffected.

## Notes

- Requires Node 18+.
- If you want a different accent colour, edit the `--accent` value on the `.sheet` element (or the `accent` prop) in `cv.dc.html`; it's an `oklch(...)` value.
- Puppeteer works too: replace the Playwright import/launch with `puppeteer` and call the same `page.pdf({ format:'A4', printBackground:true, preferCSSPageSize:true })`.
