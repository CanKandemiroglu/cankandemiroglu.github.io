import test from 'node:test';
import assert from 'node:assert/strict';

import { suggestProjection } from '../src/projection.js';

/** Bounds used across the shape/sanity tests, one per rule plus edge cases. */
const SAMPLE_BOUNDS = [
  { west: -180, south: -90, east: 180, north: 90 }, // whole world
  { west: -40, south: 66, east: 40, north: 84 }, // Arctic
  { west: -60, south: -78, east: -20, north: -60 }, // Southern Ocean sector
  { west: -6, south: 30, east: 36, north: 46 }, // Mediterranean
  { west: -30, south: 25, east: -10, north: 60 }, // tall Atlantic transect
  { west: -5, south: -5, east: 10, north: 6 }, // Gulf of Guinea
  { west: 177, south: -20, east: -178, north: -15 }, // Fiji (antimeridian)
  { west: 170, south: 66, east: -150, north: 84 }, // antimeridian, polar
];

/* -------------------------------------------------------------- rule 1 ---- */

test('whole world suggests Robinson centred on the bounds centre', () => {
  const s = suggestProjection({ west: -180, south: -90, east: 180, north: 90 });
  assert.equal(s.id, 'robinson');
  assert.equal(s.name, 'Robinson');
  assert.equal(s.gmt, '-JN0/WIDTH');
  assert.match(s.note, /global/i);
  assert.match(s.rationale, /360°/);
});

test('global rule wins over polar (rule order)', () => {
  const s = suggestProjection({ west: -180, south: 70, east: 180, north: 90 });
  assert.equal(s.id, 'robinson');
});

test('lonSpan exactly 300° counts as global', () => {
  const s = suggestProjection({ west: -150, south: -20, east: 150, north: 20 });
  assert.equal(s.id, 'robinson');
});

/* -------------------------------------------------------------- rule 2 ---- */

test('Arctic box suggests north polar stereographic', () => {
  const s = suggestProjection({ west: -40, south: 66, east: 40, north: 84 });
  assert.equal(s.id, 'polar-stereographic');
  assert.equal(s.name, 'Polar stereographic');
  assert.equal(s.gmt, '-JS0/90/WIDTH');
  assert.match(s.gmt, /\/90\/WIDTH$/);
  assert.match(s.rationale, /75°/); // centre latitude
});

test('Southern Ocean box suggests south polar stereographic', () => {
  const s = suggestProjection({ west: -60, south: -78, east: -20, north: -60 });
  assert.equal(s.id, 'polar-stereographic');
  assert.equal(s.gmt, '-JS-40/-90/WIDTH');
  assert.match(s.gmt, /\/-90\/WIDTH$/);
});

test('|centre latitude| exactly 65° counts as polar', () => {
  const s = suggestProjection({ west: 0, south: 60, east: 20, north: 70 });
  assert.equal(s.id, 'polar-stereographic');
});

/* -------------------------------------------------------------- rule 3 ---- */

test('Mediterranean suggests Lambert conic with 1/6-inset standard parallels', () => {
  const s = suggestProjection({ west: -6, south: 30, east: 36, north: 46 });
  assert.equal(s.id, 'lambert-conic');
  assert.equal(s.name, 'Lambert conformal conic');
  // latSpan 16° → inset 16/6 ≈ 2.667° → parallels at 32.7 and 43.3
  assert.equal(s.gmt, '-JL15/38/32.7/43.3/WIDTH');
  const [, , std1, std2] = s.gmt.replace('-JL', '').split('/');
  assert.ok(Number(std1) > 30 && Number(std1) < 38, 'std parallel 1 inside south half');
  assert.ok(Number(std2) > 38 && Number(std2) < 46, 'std parallel 2 inside north half');
});

test('southern-hemisphere wide mid-latitude box also gets Lambert conic', () => {
  const s = suggestProjection({ west: 10, south: -45, east: 40, north: -33 });
  assert.equal(s.id, 'lambert-conic');
  assert.equal(s.gmt, '-JL25/-39/-43/-35/WIDTH');
});

/* -------------------------------------------------------------- rule 4 ---- */

test('tall mid-latitude Atlantic transect suggests transverse Mercator', () => {
  const s = suggestProjection({ west: -30, south: 25, east: -10, north: 60 });
  assert.equal(s.id, 'transverse-mercator');
  assert.equal(s.name, 'Transverse Mercator');
  assert.equal(s.gmt, '-JT-20/WIDTH');
  assert.match(s.rationale, /north–south/);
});

/* -------------------------------------------------------------- rule 5 ---- */

test('Gulf of Guinea (tropics) suggests Mercator matching the preview', () => {
  const s = suggestProjection({ west: -5, south: -5, east: 10, north: 6 });
  assert.equal(s.id, 'mercator');
  assert.equal(s.name, 'Mercator');
  assert.equal(s.gmt, '-JMWIDTH'); // no space before WIDTH
  assert.match(s.note, /preview/i);
});

/* ------------------------------------------------------- antimeridian ----- */

test('Fiji box crossing the antimeridian is handled and mentioned', () => {
  const s = suggestProjection({ west: 177, south: -20, east: -178, north: -15 });
  assert.equal(s.id, 'mercator'); // centre latitude -17.5° → tropics
  assert.match(s.rationale, /antimeridian/);
  assert.match(s.rationale, /182°/); // east + 360
});

test('antimeridian polar box normalises the centre longitude', () => {
  // west 170, east -150 → unfolded east 210 → centre 190 → normalised -170
  const s = suggestProjection({ west: 170, south: 66, east: -150, north: 84 });
  assert.equal(s.id, 'polar-stereographic');
  assert.equal(s.gmt, '-JS-170/90/WIDTH');
  assert.match(s.rationale, /antimeridian/);
});

/* --------------------------------------------------- template hygiene ----- */

test('every gmt template contains the WIDTH token and no NaN', () => {
  for (const bounds of SAMPLE_BOUNDS) {
    const s = suggestProjection(bounds);
    assert.ok(s.gmt.includes('WIDTH'), `WIDTH missing in ${s.gmt}`);
    assert.ok(!s.gmt.includes('NaN'), `NaN leaked into ${s.gmt}`);
    assert.ok(!s.gmt.includes(' '), `unexpected space in ${s.gmt}`);
    assert.match(s.gmt, /^-J[A-Z]/, `not a -J string: ${s.gmt}`);
  }
});

test('every result has the full {id, name, gmt, note, rationale} shape', () => {
  for (const bounds of SAMPLE_BOUNDS) {
    const s = suggestProjection(bounds);
    for (const key of ['id', 'name', 'gmt', 'note', 'rationale']) {
      assert.equal(typeof s[key], 'string', `${key} should be a string`);
      assert.ok(s[key].length > 0, `${key} should be non-empty`);
    }
  }
});

test('lon/lat parameters in templates are rounded to 1 decimal', () => {
  // centre lon (0.15 + 11.37)/2 = 5.76 → 5.8; centre lat 55.165 → 55.2
  const s = suggestProjection({ west: 0.15, south: 50.11, east: 11.37, north: 60.22 });
  assert.equal(s.id, 'lambert-conic');
  for (const part of s.gmt.replace('-JL', '').split('/').slice(0, 4)) {
    assert.match(part, /^-?\d+(\.\d)?$/, `${part} has more than 1 decimal`);
  }
});

/* ---------------------------------------------------- input validation ---- */

test('malformed bounds throw TypeError', () => {
  assert.throws(() => suggestProjection(null), TypeError);
  assert.throws(() => suggestProjection([1, 2, 3, 4]), TypeError);
  assert.throws(
    () => suggestProjection({ west: 0, south: 0, east: 10, north: NaN }),
    TypeError,
  );
});

test('out-of-range or inverted latitudes throw RangeError', () => {
  assert.throws(
    () => suggestProjection({ west: 0, south: -95, east: 10, north: 0 }),
    RangeError,
  );
  assert.throws(
    () => suggestProjection({ west: 0, south: 40, east: 10, north: 30 }),
    RangeError,
  );
});
