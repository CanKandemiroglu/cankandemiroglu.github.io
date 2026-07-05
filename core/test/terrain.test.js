import test from 'node:test';
import assert from 'node:assert/strict';

import {
  terrariumToElevation, elevationToTerrarium, terrariumStats, applyColormapToTerrarium,
} from '../src/terrain.js';
import { getLUT } from '../src/cmocean.js';

// ------------------------------------------------------------------- helpers

/** Build an RGBA tile from [elevation, alpha] pairs (alpha defaults to 255). */
function makeTile(pixels) {
  const rgba = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((px, n) => {
    const [elevation, alpha = 255] = Array.isArray(px) ? px : [px];
    const [r, g, b] = elevationToTerrarium(elevation);
    rgba.set([r, g, b, alpha], n * 4);
  });
  return rgba;
}

/** Synthetic LUT where index is readable: r = i, g = 100, b = 255 - i. */
function rampLUT() {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = i;
    lut[i * 3 + 1] = 100;
    lut[i * 3 + 2] = 255 - i;
  }
  return lut;
}

/** Second synthetic LUT, distinguishable from rampLUT: r = 255 - i, g = i, b = 7. */
function landRampLUT() {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    lut[i * 3] = 255 - i;
    lut[i * 3 + 1] = i;
    lut[i * 3 + 2] = 7;
  }
  return lut;
}

function pixel(rgba, n) {
  return [rgba[n * 4], rgba[n * 4 + 1], rgba[n * 4 + 2], rgba[n * 4 + 3]];
}

// ------------------------------------------------------- terrariumToElevation

test('terrariumToElevation: known encodings', () => {
  assert.equal(terrariumToElevation(128, 0, 0), 0);       // 128*256 = 32768
  assert.equal(terrariumToElevation(0, 0, 0), -32768);
  assert.equal(terrariumToElevation(128, 0, 128), 0.5);   // 1/256 m steps
  assert.equal(terrariumToElevation(255, 255, 255), 32767.99609375);
});

// ------------------------------------------------------- elevationToTerrarium

test('elevationToTerrarium: round-trips exactly for integer elevations', () => {
  for (const m of [0, -4000, 8848, -10911]) {
    const [r, g, b] = elevationToTerrarium(m);
    for (const c of [r, g, b]) {
      assert.ok(Number.isInteger(c) && c >= 0 && c <= 255, `channel ${c} out of range`);
    }
    assert.equal(terrariumToElevation(r, g, b), m, `round trip failed for ${m}`);
  }
});

test('elevationToTerrarium: round-trips exactly for multiples of 1/256 m', () => {
  for (const m of [0.5, -12.25, 1234.00390625]) {
    const [r, g, b] = elevationToTerrarium(m);
    assert.equal(terrariumToElevation(r, g, b), m);
  }
});

test('elevationToTerrarium: clamps out-of-range elevations', () => {
  assert.deepEqual(elevationToTerrarium(1e6), [255, 255, 255]);
  assert.deepEqual(elevationToTerrarium(Infinity), [255, 255, 255]);
  assert.deepEqual(elevationToTerrarium(-1e6), [0, 0, 0]);
  assert.deepEqual(elevationToTerrarium(-Infinity), [0, 0, 0]);
});

test('elevationToTerrarium: throws on NaN and non-numbers', () => {
  assert.throws(() => elevationToTerrarium(NaN), TypeError);
  assert.throws(() => elevationToTerrarium('4000'), TypeError);
});

// ------------------------------------------------------------- terrariumStats

test('terrariumStats: min/max over a synthetic 2x2 tile, transparent ignored', () => {
  const rgba = makeTile([-4000, -10, 500, [9000, 0]]); // 9000 m pixel is nodata
  assert.deepEqual(terrariumStats(rgba), { min: -4000, max: 500 });
});

test('terrariumStats: all-transparent tile yields NaN extremes', () => {
  const { min, max } = terrariumStats(makeTile([[100, 0], [-100, 0]]));
  assert.ok(Number.isNaN(min) && Number.isNaN(max));
});

test('terrariumStats: throws when length is not divisible by 4', () => {
  assert.throws(() => terrariumStats(new Uint8Array(6)), /divisible by 4/);
});

// -------------------------------------------------- applyColormapToTerrarium

test('applyColormapToTerrarium: shallow → lut[0..2], deepest → lut[765..767]', () => {
  const lut = rampLUT();
  const rgba = applyColormapToTerrarium(makeTile([0, -8000]), lut); // default min/max
  assert.deepEqual(pixel(rgba, 0), [lut[0], lut[1], lut[2], 255]);      // t=0, shallow
  assert.deepEqual(pixel(rgba, 1), [lut[765], lut[766], lut[767], 255]); // t=1, deep
});

test('applyColormapToTerrarium: mid-depth lands mid-LUT, clamps below min', () => {
  const rgba = applyColormapToTerrarium(makeTile([-4000, -12000]), rampLUT());
  assert.equal(rgba[0], 128); // t=0.5 → round(127.5)=128
  assert.equal(rgba[4], 255); // clamped to min → index 255
});

test('applyColormapToTerrarium: degenerate min===max maps water to index 0', () => {
  const rgba = applyColormapToTerrarium(makeTile([-50]), rampLUT(), { min: 0, max: 0 });
  assert.deepEqual(pixel(rgba, 0), [0, 100, 255, 255]);
});

test('applyColormapToTerrarium: land flat uses default landColor', () => {
  const rgba = applyColormapToTerrarium(makeTile([500]), rampLUT());
  assert.deepEqual(pixel(rgba, 0), [232, 229, 224, 255]);
});

test('applyColormapToTerrarium: land flat honours custom landColor', () => {
  const rgba = applyColormapToTerrarium(makeTile([500]), rampLUT(), { landColor: [10, 20, 30] });
  assert.deepEqual(pixel(rgba, 0), [10, 20, 30, 255]);
});

test('applyColormapToTerrarium: land transparent zeroes alpha, water untouched', () => {
  const rgba = applyColormapToTerrarium(makeTile([500, -100]), rampLUT(), { land: 'transparent' });
  assert.equal(rgba[3], 0);   // land pixel alpha
  assert.equal(rgba[7], 255); // water pixel alpha
});

test('applyColormapToTerrarium: hypsometric colours land through landLut', () => {
  const landLut = landRampLUT();
  const rgba = applyColormapToTerrarium(
    makeTile([1500, 3000, 9000, -8000]), rampLUT(),
    { hypsometric: true, landLut }, // landMax defaults to 3000
  );
  const mid = 128 * 3; // t=0.5 → round(127.5)=128
  assert.deepEqual(pixel(rgba, 0), [landLut[mid], landLut[mid + 1], landLut[mid + 2], 255]);
  assert.deepEqual(pixel(rgba, 1), [landLut[765], landLut[766], landLut[767], 255]); // e===landMax
  assert.deepEqual(pixel(rgba, 2), [landLut[765], landLut[766], landLut[767], 255]); // clamped
  assert.deepEqual(pixel(rgba, 3), [255, 100, 0, 255]); // water still via water LUT
});

test('applyColormapToTerrarium: hypsometric respects opts.landMax and overrides land mode', () => {
  const landLut = landRampLUT();
  const rgba = applyColormapToTerrarium(
    makeTile([250]), rampLUT(),
    { hypsometric: true, landLut, landMax: 500, land: 'transparent' },
  );
  const mid = 128 * 3; // 250/500 → t=0.5
  assert.deepEqual(pixel(rgba, 0), [landLut[mid], landLut[mid + 1], landLut[mid + 2], 255]);
});

test('applyColormapToTerrarium: recolours in place and returns the same array', () => {
  const rgba = makeTile([-100]);
  const out = applyColormapToTerrarium(rgba, rampLUT());
  assert.equal(out, rgba);
});

test('applyColormapToTerrarium: integrates with cmocean getLUT("deep")', () => {
  const deep = getLUT('deep');
  const rgba = applyColormapToTerrarium(makeTile([0, -8000]), deep);
  assert.deepEqual(pixel(rgba, 0), [deep[0], deep[1], deep[2], 255]);
  assert.deepEqual(pixel(rgba, 1), [deep[765], deep[766], deep[767], 255]);
});

test('applyColormapToTerrarium: throws on malformed input', () => {
  const lut = rampLUT();
  assert.throws(() => applyColormapToTerrarium(new Uint8ClampedArray(5), lut), /divisible by 4/);
  assert.throws(() => applyColormapToTerrarium(makeTile([0]), new Uint8Array(767)), /768/);
  assert.throws(() => applyColormapToTerrarium(makeTile([1]), lut, { hypsometric: true }), /landLut/);
  assert.throws(
    () => applyColormapToTerrarium(makeTile([1]), lut, { hypsometric: true, landLut: new Uint8Array(10) }),
    /landLut/,
  );
  assert.throws(() => applyColormapToTerrarium(makeTile([1]), lut, { land: 'lava' }), /land mode/);
});
