#!/usr/bin/env node
/**
 * build-cmocean.mjs — regenerate core/src/cmocean-data.js from the upstream
 * cmocean RGB tables (https://github.com/matplotlib/cmocean, MIT licence).
 *
 * Each table is 256 lines of "r g b" floats in [0, 1]. We quantise to 8-bit
 * and store each colormap as a 1536-char hex string (256 × RGB), which the
 * runtime decodes back into a Uint8Array LUT. Run from the repo root:
 *
 *   node scripts/dev/build-cmocean.mjs
 *
 * Provenance (upstream commit SHA + date) is recorded in the generated file.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAPS = [
  // [id, kind] — kind per Thyng et al. (2016): sequential | diverging | cyclic
  ['thermal', 'sequential'], ['haline', 'sequential'], ['solar', 'sequential'],
  ['ice', 'sequential'], ['gray', 'sequential'], ['oxy', 'sequential'],
  ['deep', 'sequential'], ['dense', 'sequential'], ['algae', 'sequential'],
  ['matter', 'sequential'], ['turbid', 'sequential'], ['speed', 'sequential'],
  ['amp', 'sequential'], ['tempo', 'sequential'], ['rain', 'sequential'],
  ['topo', 'other'], ['balance', 'diverging'], ['delta', 'diverging'],
  ['curl', 'diverging'], ['diff', 'diverging'], ['tarn', 'diverging'],
  ['phase', 'cyclic'],
];

const BASE = 'https://raw.githubusercontent.com/matplotlib/cmocean/master/cmocean/rgb';

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function upstreamCommit() {
  try {
    const res = await fetch('https://api.github.com/repos/matplotlib/cmocean/commits/master', {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { sha: j.sha, date: j.commit?.committer?.date };
  } catch {
    return null;
  }
}

function toHex(text, id) {
  const rows = text.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  if (rows.length < 2) throw new Error(`${id}: too few rows (${rows.length})`);
  let hex = '';
  for (let i = 0; i < 256; i++) {
    // Linear resample: upstream tables are 256 or 512 rows.
    const pos = (i / 255) * (rows.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, rows.length - 1);
    const f = pos - lo;
    for (let c = 0; c < 3; c++) {
      const v = rows[lo][c] * (1 - f) + rows[hi][c] * f;
      if (!(v >= 0 && v <= 1)) throw new Error(`${id}: value out of range: ${v}`);
      hex += Math.round(v * 255).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

const commit = await upstreamCommit();
const entries = [];
for (const [id, kind] of MAPS) {
  const text = await fetchText(`${BASE}/${id}-rgb.txt`);
  entries.push({ id, kind, hex: toHex(text, id) });
  process.stdout.write(`${id} `);
}
console.log();

const header = `// GENERATED FILE — do not edit by hand. Regenerate with:
//   node scripts/dev/build-cmocean.mjs
//
// Colormap data from cmocean (MIT licence), Thyng et al. (2016),
// https://github.com/matplotlib/cmocean${commit ? `\n// Upstream commit ${commit.sha} (${commit.date})` : ''}
// Generated ${new Date().toISOString().slice(0, 10)}
//
// Each entry is 256 RGB triplets quantised to 8-bit, packed as a hex string.
`;

const body = entries
  .map((e) => `  ${e.id}: { kind: '${e.kind}', hex:\n'${e.hex.replace(/(.{96})/g, "$1' +\n'")}' },`)
  .join('\n');

const out = `${header}export const CMOCEAN_DATA = {\n${body}\n};\n`;
const dest = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../core/src/cmocean-data.js');
await writeFile(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024).toFixed(0)} kB, ${entries.length} colormaps)`);
