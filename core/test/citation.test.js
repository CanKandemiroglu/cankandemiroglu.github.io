import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DATA_SOURCES,
  buildCitationText,
  buildBibTeX,
  attributionLine,
} from '../src/citation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ATTRIB_JSON_PATH = join(__dirname, '..', '..', 'data', 'attrib', 'attributions.json');

const REQUIRED_IDS = [
  'tool',
  'terrainTiles',
  'etopo2022',
  'gebco',
  'naturalEarth',
  'cmocean',
  'emodnet',
  'marineRegions',
  'gmt',
  'pygmt',
];

const REQUIRED_KEYS = [
  'id',
  'name',
  'licence',
  'url',
  'doi',
  'citation',
  'bibtex',
  'attribution',
  'note',
];

/* ----------------------------------------------------------- registry shape -- */

test('DATA_SOURCES contains exactly the required source ids', () => {
  assert.deepEqual(Object.keys(DATA_SOURCES).sort(), [...REQUIRED_IDS].sort());
});

test('every entry has all required keys with the right types', () => {
  for (const [key, src] of Object.entries(DATA_SOURCES)) {
    assert.deepEqual(
      Object.keys(src).sort(),
      [...REQUIRED_KEYS].sort(),
      `${key}: unexpected key set`,
    );
    assert.equal(src.id, key, `${key}: id must match its registry key`);
    for (const field of ['name', 'licence', 'url', 'citation', 'attribution']) {
      assert.equal(typeof src[field], 'string', `${key}.${field} must be a string`);
      assert.ok(src[field].trim().length > 0, `${key}.${field} must be non-empty`);
    }
    for (const field of ['doi', 'bibtex', 'note']) {
      assert.ok(
        src[field] === null || typeof src[field] === 'string',
        `${key}.${field} must be a string or null`,
      );
    }
    assert.match(src.url, /^https:\/\//, `${key}.url must be an https URL`);
  }
});

test('entries with a DOI carry it in both citation and bibtex', () => {
  for (const src of Object.values(DATA_SOURCES)) {
    if (src.doi === null) continue;
    assert.ok(src.citation.includes(src.doi), `${src.id}: citation must include DOI`);
    if (src.bibtex !== null) {
      assert.ok(src.bibtex.includes(src.doi), `${src.id}: bibtex must include DOI`);
    }
  }
});

test('key facts: DOIs, licences and VERIFY notes match the product spec', () => {
  assert.equal(DATA_SOURCES.etopo2022.doi, '10.25921/fd45-gt74');
  assert.equal(DATA_SOURCES.gebco.doi, '10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f');
  assert.equal(DATA_SOURCES.cmocean.doi, '10.5670/oceanog.2016.66');
  assert.equal(DATA_SOURCES.gmt.doi, '10.1029/2019GC008515');
  assert.equal(DATA_SOURCES.pygmt.doi, null);
  assert.equal(DATA_SOURCES.emodnet.licence, 'CC-BY 4.0');
  assert.equal(DATA_SOURCES.marineRegions.licence, 'CC-BY 4.0');
  assert.match(DATA_SOURCES.gebco.note, /^VERIFY /);
  assert.match(DATA_SOURCES.emodnet.note, /^VERIFY /);
  assert.equal(
    DATA_SOURCES.naturalEarth.note,
    'No attribution legally required; credit appreciated.',
  );
  assert.equal(DATA_SOURCES.naturalEarth.bibtex, null);
  assert.match(DATA_SOURCES.tool.bibtex, /^@software\{/);
  assert.match(DATA_SOURCES.cmocean.bibtex, /^@article\{/);
  assert.match(DATA_SOURCES.gmt.bibtex, /^@article\{/);
});

test('DATA_SOURCES is deep-frozen', () => {
  assert.ok(Object.isFrozen(DATA_SOURCES));
  assert.ok(Object.isFrozen(DATA_SOURCES.gebco));
  assert.throws(() => {
    'use strict';
    DATA_SOURCES.gebco.doi = 'tampered';
  }, TypeError);
});

/* ------------------------------------------------------- JSON <-> module sync -- */

test('data/attrib/attributions.json mirrors DATA_SOURCES exactly', () => {
  const json = JSON.parse(readFileSync(ATTRIB_JSON_PATH, 'utf8'));
  assert.deepEqual(Object.keys(json), ['sources']);
  assert.deepEqual(json.sources, Object.values(DATA_SOURCES));
});

/* --------------------------------------------------------- buildCitationText -- */

test('buildCitationText leads with the header and the versioned tool citation', () => {
  const text = buildCitationText({ sources: ['gebco'], toolVersion: '9.9.9' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'How to cite this figure');
  assert.ok(text.includes('Marine Map Tool (v9.9.9)'));
  assert.ok(!text.includes('{version}'), 'placeholder must be substituted');
});

test('buildCitationText lists requested sources in order with their DOIs', () => {
  const text = buildCitationText({
    sources: ['etopo2022', 'gebco', 'cmocean', 'gmt'],
    accessedDate: '2026-07-05',
  });
  assert.ok(text.includes('10.25921/fd45-gt74'));
  assert.ok(text.includes('10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f'));
  assert.ok(text.includes('10.5670/oceanog.2016.66'));
  assert.ok(text.includes('10.1029/2019GC008515'));
  assert.ok(
    text.indexOf('10.25921/fd45-gt74') < text.indexOf('10.5285/1c44ce99'),
    'sources must appear in the requested order',
  );
  assert.ok(text.endsWith('Data accessed 2026-07-05.'));
});

test('buildCitationText omits the accessed line when no date is given', () => {
  const text = buildCitationText({ sources: ['gebco'] });
  assert.ok(!text.includes('Data accessed'));
});

test('buildCitationText skips unknown ids without throwing and never repeats the tool', () => {
  const text = buildCitationText({ sources: ['nope', 'tool', 'gebco', 'alsoNope'] });
  assert.ok(text.includes('GEBCO Compilation Group (2024)'));
  const toolMentions = text.split('Marine Map Tool (v').length - 1;
  assert.equal(toolMentions, 1, 'tool citation must appear exactly once');
});

test('buildCitationText with no arguments yields just header + tool citation', () => {
  const text = buildCitationText();
  const lines = text.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('Marine Map Tool (v0.1.0)'));
});

/* -------------------------------------------------------------- buildBibTeX -- */

test('buildBibTeX puts the versioned @software entry first', () => {
  const bib = buildBibTeX({ sources: ['cmocean', 'gmt'], toolVersion: '2.0.0' });
  assert.match(bib, /^@software\{/);
  assert.ok(bib.includes('version = {2.0.0}'));
  assert.ok(!bib.includes('{version}'), 'placeholder must be substituted');
});

test('buildBibTeX includes available entries with DOIs and skips null bibtex', () => {
  const bib = buildBibTeX({
    sources: ['etopo2022', 'gebco', 'naturalEarth', 'cmocean', 'gmt', 'pygmt', 'bogus'],
  });
  assert.ok(bib.includes('10.25921/fd45-gt74'));
  assert.ok(bib.includes('10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f'));
  assert.ok(bib.includes('10.5670/oceanog.2016.66'));
  assert.ok(bib.includes('10.1029/2019GC008515'));
  // 1 tool + 4 sources with bibtex; naturalEarth/pygmt (null) and bogus skipped.
  assert.equal(bib.split('\n\n').length, 5);
  assert.ok(!bib.includes('Natural Earth'));
});

test('buildBibTeX with only null-bibtex sources returns just the tool entry', () => {
  const bib = buildBibTeX({ sources: ['naturalEarth', 'pygmt', 'emodnet'] });
  assert.match(bib, /^@software\{/);
  assert.equal(bib.split('\n\n').length, 1);
});

/* ----------------------------------------------------------- attributionLine -- */

test('attributionLine joins corner credits with the interpunct separator', () => {
  const line = attributionLine(['gebco', 'naturalEarth', 'cmocean']);
  assert.equal(
    line,
    'Bathymetry: GEBCO 2024 · Made with Natural Earth · cmocean colormaps (Thyng et al. 2016)',
  );
});

test('attributionLine produces corner-ready bathymetry credits', () => {
  assert.equal(attributionLine(['etopo2022']), 'Bathymetry: ETOPO 2022 (NOAA)');
  assert.equal(attributionLine(['terrainTiles']), 'Bathymetry: Terrain Tiles (Mapzen/AWS)');
});

test('attributionLine skips unknown ids and handles empty/invalid input', () => {
  assert.equal(attributionLine(['bogus', 'gebco', 'nope']), 'Bathymetry: GEBCO 2024');
  assert.equal(attributionLine([]), '');
  assert.equal(attributionLine(undefined), '');
});
