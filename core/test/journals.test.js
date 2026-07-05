import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  validateJournalRecord,
  selectJournal,
  checkFontFloor,
  FALLBACK_SPEC,
} from '../src/journals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JOURNALS_DIR = join(__dirname, '..', '..', 'data', 'journals');

const readJson = (name) => JSON.parse(readFileSync(join(JOURNALS_DIR, name), 'utf8'));
const index = readJson('index.json');
const records = index.journals.map((id) => readJson(`${id}.json`));
const byId = Object.fromEntries(records.map((r) => [r.id, r]));

/* --------------------------------------------------------- data integrity -- */

test('index.json exposes a journals array of ids', () => {
  assert.ok(Array.isArray(index.journals));
  assert.equal(index.journals.length, 9);
});

test('index.json lists exactly the 9 record files present on disk', () => {
  const onDisk = readdirSync(JOURNALS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'schema.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  const listed = [...index.journals].sort();
  assert.deepEqual(onDisk, listed);
});

test("each record's id matches its filename", () => {
  for (const id of index.journals) {
    assert.equal(readJson(`${id}.json`).id, id);
  }
});

test('schema.json parses and is a draft-07 object schema', () => {
  const schema = readJson('schema.json');
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.type, 'object');
  assert.ok(Array.isArray(schema.required) && schema.required.includes('canvas'));
});

test('every shipped record validates against validateJournalRecord', () => {
  for (const rec of records) {
    const { valid, errors } = validateJournalRecord(rec);
    assert.equal(valid, true, `${rec.id} should be valid but got: ${errors.join('; ')}`);
    assert.deepEqual(errors, []);
  }
});

test('every shipped record carries the VERIFY-BEFORE-SHIP sentinel', () => {
  for (const rec of records) {
    assert.equal(rec.last_verified, 'VERIFY-BEFORE-SHIP', `${rec.id}`);
  }
});

/* -------------------------------------------------- validateJournalRecord -- */

test('validateJournalRecord rejects non-objects', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const { valid, errors } = validateJournalRecord(bad);
    assert.equal(valid, false);
    assert.ok(errors.length >= 1);
  }
});

test('validateJournalRecord flags each missing/invalid required field', () => {
  const good = byId['nature'];

  const missingCanvas = { ...good, canvas: { double_column_mm: 183 } };
  assert.equal(validateJournalRecord(missingCanvas).valid, false);

  const zeroWidth = { ...good, canvas: { ...good.canvas, single_column_mm: 0 } };
  assert.equal(validateJournalRecord(zeroWidth).valid, false);

  const lowDpi = { ...good, map_target: { recommended_format: 'pdf', recommended_dpi: 72 } };
  assert.equal(validateJournalRecord(lowDpi).valid, false);

  const emptyFormats = { ...good, formats_accepted: [] };
  assert.equal(validateJournalRecord(emptyFormats).valid, false);

  const badColour = { ...good, colour_mode: 'greyscale' };
  assert.equal(validateJournalRecord(badColour).valid, false);

  const badFont = { ...good, min_font_pt: 0 };
  assert.equal(validateJournalRecord(badFont).valid, false);

  const noUrl = { ...good, source_url: '' };
  assert.equal(validateJournalRecord(noUrl).valid, false);
});

test('validateJournalRecord accepts all three colour modes', () => {
  const base = byId['nature'];
  for (const mode of ['RGB', 'CMYK', 'RGB or CMYK']) {
    assert.equal(validateJournalRecord({ ...base, colour_mode: mode }).valid, true);
  }
});

/* ------------------------------------------------------------ selectJournal -- */

test('selectJournal picks double-column width by default', () => {
  const cfg = selectJournal(byId['nature']);
  assert.equal(cfg.widthMm, 183);
  assert.equal(cfg.maxHeightMm, 247);
  assert.equal(cfg.dpi, 600);
  assert.equal(cfg.journalId, 'nature');
  assert.equal(cfg.journalTitle, 'Nature');
});

test('selectJournal picks single-column width when columns === 1', () => {
  const cfg = selectJournal(byId['nature'], { columns: 1 });
  assert.equal(cfg.widthMm, 89);
});

test('selectJournal honours an accepted requested format', () => {
  const cfg = selectJournal(byId['nature'], { format: 'eps' });
  assert.equal(cfg.format, 'eps');
  assert.ok(!cfg.warnings.some((w) => w.includes('not accepted')));
});

test('selectJournal falls back and warns for an unaccepted format', () => {
  const cfg = selectJournal(byId['nature'], { format: 'png' });
  assert.equal(cfg.format, 'pdf'); // recommended_format
  assert.ok(cfg.warnings.some((w) => w.includes('png') && w.includes('not accepted')));
});

test('selectJournal uses the recommended format when none requested', () => {
  const cfg = selectJournal(byId['plos-one']);
  assert.equal(cfg.format, 'tiff');
});

test('selectJournal emits the CMYK warning only for CMYK-capable journals', () => {
  const cmyk = selectJournal(byId['elsevier-standard']); // "RGB or CMYK"
  assert.ok(cmyk.warnings.some((w) => w.includes('CMYK') && w.includes('perceptual uniformity')));

  const rgb = selectJournal(byId['nature']); // "RGB"
  assert.ok(!rgb.warnings.some((w) => w.includes('perceptual uniformity')));
});

test('selectJournal always warns about the unverified sentinel and cites the source url', () => {
  const cfg = selectJournal(byId['agu-journals']);
  const warn = cfg.warnings.find((w) => w.includes('unverified default'));
  assert.ok(warn, 'expected an unverified-default warning');
  assert.ok(warn.includes(byId['agu-journals'].source_url));
});

test('selectJournal is deterministic (same input -> deep-equal output)', () => {
  const a = selectJournal(byId['science'], { columns: 1, format: 'eps' });
  const b = selectJournal(byId['science'], { columns: 1, format: 'eps' });
  assert.deepEqual(a, b);
});

test('selectJournal passes through colour mode, fonts and provenance', () => {
  const cfg = selectJournal(byId['science']);
  assert.equal(cfg.colourMode, 'RGB');
  assert.equal(cfg.minFontPt, 6);
  assert.equal(cfg.fontFamilyHint, 'Helvetica/Arial');
  assert.equal(cfg.lastVerified, 'VERIFY-BEFORE-SHIP');
  assert.deepEqual(cfg.formatsAccepted, ['pdf', 'eps', 'ai']);
});

/* ------------------------------------------------------------ checkFontFloor -- */

test('checkFontFloor accepts font sizes at or above the floor', () => {
  assert.deepEqual(checkFontFloor(7, 7), { ok: true, message: null });
  assert.deepEqual(checkFontFloor(9, 7), { ok: true, message: null });
});

test('checkFontFloor rejects sizes below the floor with a message', () => {
  const res = checkFontFloor(5, 7);
  assert.equal(res.ok, false);
  assert.ok(typeof res.message === 'string' && res.message.includes('5'));
  assert.ok(res.message.includes('7'));
});

/* --------------------------------------------------------------- FALLBACK -- */

test('FALLBACK_SPEC has the documented generic defaults', () => {
  assert.equal(FALLBACK_SPEC.journalId, null);
  assert.equal(FALLBACK_SPEC.journalTitle, 'Generic (no journal)');
  assert.equal(FALLBACK_SPEC.widthMm, 180);
  assert.equal(FALLBACK_SPEC.maxHeightMm, 240);
  assert.equal(FALLBACK_SPEC.dpi, 600);
  assert.equal(FALLBACK_SPEC.format, 'pdf');
  assert.deepEqual(FALLBACK_SPEC.formatsAccepted, ['pdf', 'png', 'svg']);
  assert.equal(FALLBACK_SPEC.colourMode, 'RGB');
  assert.equal(FALLBACK_SPEC.minFontPt, 7);
  assert.equal(FALLBACK_SPEC.fontFamilyHint, 'Arial/Helvetica');
  assert.deepEqual(FALLBACK_SPEC.warnings, []);
});

test('FALLBACK_SPEC is frozen', () => {
  assert.ok(Object.isFrozen(FALLBACK_SPEC));
  assert.throws(() => {
    'use strict';
    FALLBACK_SPEC.dpi = 72;
  });
});
