import test from 'node:test';
import assert from 'node:assert/strict';

import {
  haversineMeters, sampleLine, lonLatToTilePixel, uniqueTiles,
  buildProfile, profileToCSV,
} from '../src/transect.js';

// --------------------------------------------------------------- haversineMeters

test('haversineMeters: 1° of longitude at the equator ≈ 111.3 km', () => {
  const d = haversineMeters({ lon: 0, lat: 0 }, { lon: 1, lat: 0 });
  // On the IUGG mean sphere (R = 6371008.8 m) this is 111195 m; still within a
  // few hundred metres of the familiar 111.32 km WGS84 figure.
  assert.ok(Math.abs(d - 111195.08) < 1, `got ${d}`);
  assert.ok(Math.abs(d - 111320) < 200, `expected ~111.32 km, got ${d}`);
});

test('haversineMeters: symmetric and zero for identical points', () => {
  const a = { lon: -30, lat: 12 };
  const b = { lon: 5, lat: -47 };
  assert.equal(haversineMeters(a, a), 0);
  assert.ok(Math.abs(haversineMeters(a, b) - haversineMeters(b, a)) < 1e-6);
});

test('haversineMeters: 1° of latitude anywhere ≈ 111.2 km (meridian)', () => {
  const d = haversineMeters({ lon: 10, lat: 40 }, { lon: 10, lat: 41 });
  assert.ok(Math.abs(d - 111195.08) < 1, `got ${d}`);
});

// -------------------------------------------------------------------- sampleLine

test('sampleLine: throws RangeError for n < 2 and non-integers', () => {
  const a = { lon: 0, lat: 0 };
  const b = { lon: 1, lat: 1 };
  assert.throws(() => sampleLine(a, b, 1), RangeError);
  assert.throws(() => sampleLine(a, b, 0), RangeError);
  assert.throws(() => sampleLine(a, b, 2.5), RangeError);
});

test('sampleLine: correct count, exact endpoints, dist[0] = 0', () => {
  const a = { lon: -122.5, lat: 37.7 };
  const b = { lon: -122.1, lat: 37.9 };
  const s = sampleLine(a, b, 5);
  assert.equal(s.length, 5);
  assert.equal(s[0].lon, a.lon);
  assert.equal(s[0].lat, a.lat);
  assert.equal(s[0].dist, 0);
  assert.equal(s[4].lon, b.lon); // exact, no float drift
  assert.equal(s[4].lat, b.lat);
});

test('sampleLine: endpoints exact even when linear interp would drift', () => {
  const a = { lon: 0.1, lat: 0.1 };
  const b = { lon: 0.2, lat: 0.2 };
  const s = sampleLine(a, b, 3);
  assert.equal(s[2].lon, 0.2); // 0.1 + (0.2-0.1)*1 would be 0.20000000000000004
  assert.equal(s[2].lat, 0.2);
});

test('sampleLine: dist is monotonically non-decreasing and equals total at end', () => {
  const a = { lon: 0, lat: 0 };
  const b = { lon: 3, lat: 0 };
  const s = sampleLine(a, b, 4);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].dist >= s[i - 1].dist, `dist not monotonic at ${i}`);
  }
  // 3 equal steps of ~111.2 km along the equator.
  const total = haversineMeters(a, b);
  assert.ok(Math.abs(s[3].dist - total) < 1e-6, `end dist ${s[3].dist} vs ${total}`);
  assert.ok(Math.abs(s[1].dist - total / 3) < 1e-6);
});

test('sampleLine: samples are evenly spaced in lon/lat', () => {
  const s = sampleLine({ lon: 0, lat: 0 }, { lon: 10, lat: 20 }, 3);
  assert.ok(Math.abs(s[1].lon - 5) < 1e-12);
  assert.ok(Math.abs(s[1].lat - 10) < 1e-12);
});

// -------------------------------------------------------------- lonLatToTilePixel

test('lonLatToTilePixel: (0,0,z=1) lands on tile (1,1) at the region boundary', () => {
  const t = lonLatToTilePixel(0, 0, 1);
  assert.deepEqual(t, { tx: 1, ty: 1, px: 0, py: 0 });
});

test('lonLatToTilePixel: mid-latitude case (-90, 45, z=2)', () => {
  // n=4; txf=(90/360)*4=1.0 → tx=1,px=0.
  // asinh(tan45°)/π = 0.28051…; tyf=(1-0.28051)/2*4=1.43890 → ty=1,
  // py=floor(0.43890*256)=112.
  const t = lonLatToTilePixel(-90, 45, 2);
  assert.deepEqual(t, { tx: 1, ty: 1, px: 0, py: 112 });
});

test('lonLatToTilePixel: top-left corner of the world (z=0) is tile 0/0 px 0/0', () => {
  const t = lonLatToTilePixel(-180, 85.05112878, 0);
  assert.deepEqual(t, { tx: 0, ty: 0, px: 0, py: 0 });
});

test('lonLatToTilePixel: clamps latitude beyond the Web-Mercator limit', () => {
  const atLimit = lonLatToTilePixel(0, 85.05112878, 3);
  const beyond = lonLatToTilePixel(0, 89.9, 3);
  assert.deepEqual(beyond, atLimit); // clamped, identical tiling
});

test('lonLatToTilePixel: tile indices and pixels stay in range at the edges', () => {
  const z = 4;
  const n = 2 ** z;
  for (const [lon, lat] of [[180, -85.05112878], [-180, 85.05112878], [179.999, -84]]) {
    const { tx, ty, px, py } = lonLatToTilePixel(lon, lat, z);
    assert.ok(tx >= 0 && tx <= n - 1, `tx ${tx} out of range`);
    assert.ok(ty >= 0 && ty <= n - 1, `ty ${ty} out of range`);
    assert.ok(px >= 0 && px <= 255, `px ${px} out of range`);
    assert.ok(py >= 0 && py <= 255, `py ${py} out of range`);
  }
});

test('lonLatToTilePixel: honours a custom tileSize', () => {
  const t = lonLatToTilePixel(-45, 0, 3, 512);
  // tx/ty independent of tileSize; px scales with it.
  const t256 = lonLatToTilePixel(-45, 0, 3, 256);
  assert.equal(t.tx, t256.tx);
  assert.equal(t.ty, t256.ty);
  assert.ok(t.px >= 0 && t.px <= 511);
});

// -------------------------------------------------------------------- uniqueTiles

test('uniqueTiles: dedups adjacent samples that fall in one tile, order preserved', () => {
  // Four samples: first two in the same z=2 tile, then two distinct tiles.
  const samples = [
    { lon: -170, lat: 80 }, // tile (0,0)
    { lon: -160, lat: 82 }, // tile (0,0) — same
    { lon: -90, lat: 45 },  // tile (1,1)
    { lon: 100, lat: -10 }, // tile (3,2)
  ];
  const tiles = uniqueTiles(samples, 2);
  assert.deepEqual(tiles, [
    { tx: 0, ty: 0, z: 2 },
    { tx: 1, ty: 1, z: 2 },
    { tx: 3, ty: 2, z: 2 },
  ]);
});

test('uniqueTiles: single sample yields one tile; empty input yields none', () => {
  assert.deepEqual(uniqueTiles([{ lon: 0, lat: 0 }], 1), [{ tx: 1, ty: 1, z: 1 }]);
  assert.deepEqual(uniqueTiles([], 5), []);
});

test('uniqueTiles: covers every tile a sampled transect crosses', () => {
  const s = sampleLine({ lon: -0.4, lat: 0.4 }, { lon: 0.4, lat: -0.4 }, 20);
  const tiles = uniqueTiles(s, 8);
  // Every sample's tile must be present in the returned set.
  for (const p of s) {
    const { tx, ty } = lonLatToTilePixel(p.lon, p.lat, 8);
    assert.ok(tiles.some((t) => t.tx === tx && t.ty === ty), `missing tile ${tx}/${ty}`);
  }
  // And the set is deduped.
  const keys = new Set(tiles.map((t) => `${t.tx}/${t.ty}`));
  assert.equal(keys.size, tiles.length);
});

// ------------------------------------------------------------------- buildProfile

test('buildProfile: throws when arrays differ in length', () => {
  const samples = sampleLine({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, 3);
  assert.throws(() => buildProfile(samples, [-10, -20]), RangeError);
});

test('buildProfile: min/max ignore an embedded null, which is carried into points', () => {
  const samples = sampleLine({ lon: 0, lat: 0 }, { lon: 4, lat: 0 }, 5);
  const elevations = [-100, -250, null, -180, -60];
  const p = buildProfile(samples, elevations);

  assert.equal(p.points.length, 5);
  assert.equal(p.points[2].elev, null);          // null carried through
  assert.equal(p.points[0].elev, -100);
  assert.equal(p.min, -250);                       // null skipped
  assert.equal(p.max, -60);
  assert.equal(p.length, samples[4].dist);         // last dist
  assert.ok(p.length > 0);

  // meanSlope = (max - min) / length
  assert.ok(Math.abs(p.meanSlope - (p.max - p.min) / p.length) < 1e-12);
});

test('buildProfile: points echo dist/lon/lat from the samples', () => {
  const samples = sampleLine({ lon: 10, lat: 20 }, { lon: 11, lat: 21 }, 3);
  const p = buildProfile(samples, [-5, -6, -7]);
  for (let i = 0; i < samples.length; i++) {
    assert.equal(p.points[i].dist, samples[i].dist);
    assert.equal(p.points[i].lon, samples[i].lon);
    assert.equal(p.points[i].lat, samples[i].lat);
  }
});

test('buildProfile: all-null elevations give null min/max and meanSlope 0', () => {
  const samples = sampleLine({ lon: 0, lat: 0 }, { lon: 2, lat: 0 }, 3);
  const p = buildProfile(samples, [null, null, null]);
  assert.equal(p.min, null);
  assert.equal(p.max, null);
  assert.equal(p.meanSlope, 0);
  assert.ok(p.length > 0);
});

test('buildProfile: empty transect has length 0 and meanSlope 0', () => {
  const p = buildProfile([], []);
  assert.equal(p.points.length, 0);
  assert.equal(p.length, 0);
  assert.equal(p.meanSlope, 0);
  assert.equal(p.min, null);
  assert.equal(p.max, null);
});

test('buildProfile: treats undefined elevation like null', () => {
  const samples = sampleLine({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, 2);
  const p = buildProfile(samples, [undefined, -30]);
  assert.equal(p.points[0].elev, null);
  assert.equal(p.min, -30);
  assert.equal(p.max, -30);
});

// ------------------------------------------------------------------- profileToCSV

test('profileToCSV: header + one row per point, null renders empty', () => {
  const samples = sampleLine({ lon: 0, lat: 0 }, { lon: 2, lat: 0 }, 3);
  const profile = buildProfile(samples, [-100, null, -300]);
  const csv = profileToCSV(profile);

  const lines = csv.split('\r\n');
  assert.equal(lines.length, profile.points.length + 1); // header + points
  assert.equal(lines[0], 'distance_m,longitude,latitude,elevation_m');

  // The null-elevation row ends with an empty field.
  assert.ok(lines[2].endsWith(','), `expected empty elevation, got "${lines[2]}"`);
  assert.equal(lines[2].split(',').length, 4);
  assert.equal(lines[2].split(',')[3], '');

  // A populated row carries the elevation.
  assert.equal(lines[1].split(',')[3], '-100');
  assert.equal(lines[3].split(',')[3], '-300');
});

test('profileToCSV: uses RFC-4180 CRLF terminators and no trailing newline', () => {
  const samples = sampleLine({ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, 2);
  const csv = profileToCSV(buildProfile(samples, [-1, -2]));
  assert.ok(csv.includes('\r\n'));
  assert.ok(!csv.endsWith('\r\n') && !csv.endsWith('\n'));
});

test('profileToCSV: header-only CSV for an empty profile', () => {
  const csv = profileToCSV(buildProfile([], []));
  assert.equal(csv, 'distance_m,longitude,latitude,elevation_m');
});
