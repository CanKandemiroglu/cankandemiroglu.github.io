import test from 'node:test';
import assert from 'node:assert/strict';

import {
  metersPerPixel, niceScaleBar, graticuleInterval, graticuleLines,
  colorbarTicks, formatDegree, formatDepth, lonLatToCanvasXY,
} from '../src/furniture.js';

// ---------------------------------------------------------------- metersPerPixel

test('metersPerPixel: equator, z0, 512px tiles ≈ 78271.5 m/px', () => {
  const v = metersPerPixel(0, 0, 512);
  assert.ok(Math.abs(v - 78271.51696) < 0.01, `got ${v}`);
});

test('metersPerPixel: defaults to 512px tiles', () => {
  assert.equal(metersPerPixel(0, 0), metersPerPixel(0, 0, 512));
});

test('metersPerPixel: 256px tiles double the resolution value', () => {
  assert.ok(Math.abs(metersPerPixel(0, 0, 256) - 2 * metersPerPixel(0, 0, 512)) < 1e-9);
});

test('metersPerPixel: halves per zoom level and scales by cos(lat)', () => {
  assert.ok(Math.abs(metersPerPixel(0, 1) - metersPerPixel(0, 0) / 2) < 1e-9);
  assert.ok(Math.abs(metersPerPixel(60, 4) - metersPerPixel(0, 4) * 0.5) < 1e-6);
});

// ------------------------------------------------------------------ niceScaleBar

test('niceScaleBar: picks 100 km when it just fits', () => {
  const bar = niceScaleBar(1000, 120); // max 120 000 m
  assert.equal(bar.meters, 100000);
  assert.equal(bar.label, '100 km');
  assert.ok(Math.abs(bar.px - 100) < 1e-9);
  assert.ok(bar.px <= 120);
});

test('niceScaleBar: drops to 50 km when 100 km would overflow', () => {
  const bar = niceScaleBar(1000, 99); // max 99 000 m
  assert.equal(bar.meters, 50000);
  assert.equal(bar.label, '50 km');
  assert.ok(Math.abs(bar.px - 50) < 1e-9);
});

test('niceScaleBar: metric labels below 1 km', () => {
  const bar = niceScaleBar(1, 700);
  assert.equal(bar.meters, 500);
  assert.equal(bar.label, '500 m');
  assert.ok(Math.abs(bar.px - 500) < 1e-9);
});

test('niceScaleBar: sub-meter lengths keep clean labels', () => {
  const bar = niceScaleBar(0.001, 250); // max 0.25 m
  assert.equal(bar.meters, 0.2);
  assert.equal(bar.label, '0.2 m');
});

test('niceScaleBar: exact nice boundary is accepted', () => {
  const bar = niceScaleBar(1000, 100); // max exactly 100 000 m
  assert.equal(bar.meters, 100000);
});

test('niceScaleBar: rejects non-positive inputs', () => {
  assert.throws(() => niceScaleBar(0, 100), RangeError);
  assert.throws(() => niceScaleBar(-3, 100), RangeError);
  assert.throws(() => niceScaleBar(10, 0), RangeError);
  assert.throws(() => niceScaleBar(10, -5), RangeError);
});

// ------------------------------------------------------------- graticuleInterval

test('graticuleInterval: sane picks from the allowed step list', () => {
  const allowed = [45, 30, 20, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];
  assert.equal(graticuleInterval(30), 5);
  assert.equal(graticuleInterval(180), 45);
  assert.equal(graticuleInterval(1), 0.25);
  assert.equal(graticuleInterval(0.05), 0.01);
  for (const span of [0.03, 0.7, 3, 12, 47, 120, 360]) {
    const step = graticuleInterval(span);
    assert.ok(allowed.includes(step), `span ${span} gave off-list step ${step}`);
  }
});

test('graticuleInterval: yields roughly 4-8 lines across the span', () => {
  for (const span of [1, 2.5, 8, 30, 75, 160]) {
    const step = graticuleInterval(span);
    const lines = Math.floor(span / step) + 1; // upper bound when snapped
    assert.ok(lines >= 4 && lines <= 8, `span ${span}, step ${step} → ${lines} lines`);
  }
});

test('graticuleInterval: rejects non-positive spans', () => {
  assert.throws(() => graticuleInterval(0), RangeError);
  assert.throws(() => graticuleInterval(-10), RangeError);
});

// ----------------------------------------------------------------- graticuleLines

test('graticuleLines: snapped meridians and parallels with correct properties', () => {
  const fc = graticuleLines({ west: -10, south: -5, east: 20, north: 25 }, 5);
  assert.equal(fc.type, 'FeatureCollection');
  const meridians = fc.features.filter((f) => f.properties.kind === 'meridian');
  const parallels = fc.features.filter((f) => f.properties.kind === 'parallel');
  assert.deepEqual(meridians.map((f) => f.properties.value), [-10, -5, 0, 5, 10, 15, 20]);
  assert.deepEqual(parallels.map((f) => f.properties.value), [-5, 0, 5, 10, 15, 20, 25]);
  for (const f of fc.features) {
    assert.equal(f.type, 'Feature');
    assert.equal(f.geometry.type, 'LineString');
    assert.equal(f.geometry.coordinates.length, 2);
  }
  // A meridian runs south→north at constant longitude; a parallel west→east.
  assert.deepEqual(meridians[0].geometry.coordinates, [[-10, -5], [-10, 25]]);
  assert.deepEqual(parallels[0].geometry.coordinates, [[-10, -5], [20, -5]]);
});

test('graticuleLines: line count matches graticuleInterval target', () => {
  const bounds = { west: 0, south: 0, east: 30, north: 30 };
  const step = graticuleInterval(30);
  const fc = graticuleLines(bounds, step);
  const meridians = fc.features.filter((f) => f.properties.kind === 'meridian');
  assert.ok(meridians.length >= 4 && meridians.length <= 8, `got ${meridians.length}`);
});

test('graticuleLines: clamps parallels and meridian extent to ±85', () => {
  const fc = graticuleLines({ west: 0, south: -90, east: 40, north: 90 }, 10);
  const parallels = fc.features.filter((f) => f.properties.kind === 'parallel');
  for (const f of parallels) {
    assert.ok(f.properties.value >= -85 && f.properties.value <= 85);
  }
  const meridian = fc.features.find((f) => f.properties.kind === 'meridian');
  const lats = meridian.geometry.coordinates.map(([, lat]) => lat);
  assert.deepEqual(lats, [-85, 85]);
});

test('graticuleLines: fractional intervals give clean snapped values', () => {
  const fc = graticuleLines({ west: 0.07, south: 0.07, east: 0.44, north: 0.44 }, 0.1);
  const meridians = fc.features.filter((f) => f.properties.kind === 'meridian');
  assert.deepEqual(meridians.map((f) => f.properties.value), [0.1, 0.2, 0.3, 0.4]);
});

test('graticuleLines: rejects a non-positive interval', () => {
  assert.throws(() => graticuleLines({ west: 0, south: 0, east: 10, north: 10 }, 0), RangeError);
});

// ------------------------------------------------------------------ colorbarTicks

test('colorbarTicks: 0–100 gives multiples of 20', () => {
  assert.deepEqual(colorbarTicks(0, 100), [0, 20, 40, 60, 80, 100]);
});

test('colorbarTicks: negative depth range', () => {
  assert.deepEqual(colorbarTicks(-5000, 0), [-5000, -4000, -3000, -2000, -1000, 0]);
});

test('colorbarTicks: fractional range stays inside bounds, sorted, ≤ maxTicks', () => {
  const ticks = colorbarTicks(0.13, 0.94);
  assert.ok(ticks.length >= 2 && ticks.length <= 6);
  for (const t of ticks) assert.ok(t >= 0.13 && t <= 0.94, `tick ${t} outside range`);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1]);
  assert.deepEqual(ticks, [0.2, 0.4, 0.6, 0.8]); // exact, no float noise
});

test('colorbarTicks: respects a custom maxTicks', () => {
  const ticks = colorbarTicks(0, 100, 3);
  assert.ok(ticks.length <= 3);
  assert.deepEqual(ticks, [0, 50, 100]);
});

test('colorbarTicks: degenerate and invalid ranges', () => {
  assert.deepEqual(colorbarTicks(7, 7), [7]);
  assert.throws(() => colorbarTicks(5, 1), RangeError);
  assert.throws(() => colorbarTicks(0, 1, 1), RangeError);
});

// ------------------------------------------------------------------- formatDegree

test('formatDegree: exact labels', () => {
  assert.equal(formatDegree(45, 'lat'), '45°N');
  assert.equal(formatDegree(-33, 'lat'), '33°S');
  assert.equal(formatDegree(-12.5, 'lon'), '12.5°W');
  assert.equal(formatDegree(151.2, 'lon'), '151.2°E');
  assert.equal(formatDegree(0, 'lat'), '0°');
  assert.equal(formatDegree(0, 'lon'), '0°');
  assert.equal(formatDegree(180, 'lon'), '180°');
  assert.equal(formatDegree(-180, 'lon'), '180°');
});

test('formatDegree: rejects an unknown axis', () => {
  assert.throws(() => formatDegree(10, 'depth'), RangeError);
});

// -------------------------------------------------------------------- formatDepth

test('formatDepth: exact labels', () => {
  assert.equal(formatDepth(-1500), '1,500 m');
  assert.equal(formatDepth(-12345), '12,345 m');
  assert.equal(formatDepth(-1234567), '1,234,567 m');
  assert.equal(formatDepth(250), '250 m');
  assert.equal(formatDepth(0), '0 m');
  assert.equal(formatDepth(-5), '5 m');
  assert.equal(formatDepth(-3.75), '3.8 m'); // one decimal only below 10 m
  assert.equal(formatDepth(-9.5), '9.5 m');
  assert.equal(formatDepth(-1500.6), '1,501 m'); // ≥10 m rounds to integer
});

test('formatDepth: rejects non-finite input', () => {
  assert.throws(() => formatDepth(NaN), RangeError);
  assert.throws(() => formatDepth(-Infinity), RangeError);
});

// -------------------------------------------------------------- lonLatToCanvasXY

test('lonLatToCanvasXY: corners map exactly to canvas corners', () => {
  const bounds = { west: -10, south: -10, east: 10, north: 10 };
  assert.deepEqual(lonLatToCanvasXY(-10, 10, bounds, 200, 100), [0, 0]);
  assert.deepEqual(lonLatToCanvasXY(10, -10, bounds, 200, 100), [200, 100]);
  assert.deepEqual(lonLatToCanvasXY(-10, -10, bounds, 200, 100), [0, 100]);
  assert.deepEqual(lonLatToCanvasXY(10, 10, bounds, 200, 100), [200, 0]);
});

test('lonLatToCanvasXY: equator centres an equator-symmetric canvas', () => {
  const [x, y] = lonLatToCanvasXY(0, 0, { west: -10, south: -10, east: 10, north: 10 }, 200, 100);
  assert.ok(Math.abs(x - 100) < 1e-9);
  assert.ok(Math.abs(y - 50) < 1e-6);
});

test('lonLatToCanvasXY: y is Mercator-stretched, not linear in latitude', () => {
  // Halfway latitude of a 0–60°N band sits below the canvas midline.
  const [, y] = lonLatToCanvasXY(30, 30, { west: 0, south: 0, east: 60, north: 60 }, 100, 100);
  assert.ok(y > 55 && y < 62, `expected Mercator midpoint ≈58, got ${y}`);
});

test('lonLatToCanvasXY: rejects degenerate bounds and canvas sizes', () => {
  assert.throws(() => lonLatToCanvasXY(0, 0, { west: 10, south: 0, east: 10, north: 5 }, 100, 100), RangeError);
  assert.throws(() => lonLatToCanvasXY(0, 0, { west: 0, south: 5, east: 10, north: 5 }, 100, 100), RangeError);
  assert.throws(() => lonLatToCanvasXY(0, 0, { west: 0, south: 0, east: 10, north: 5 }, 0, 100), RangeError);
  assert.throws(() => lonLatToCanvasXY(0, 0, { west: 0, south: 0, east: 10, north: 5 }, 100, -1), RangeError);
});
