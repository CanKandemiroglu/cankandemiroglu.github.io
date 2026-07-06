/**
 * transect.js — bathymetric transect / depth-profile geometry.
 *
 * The browser lets the user draw a line across the map; the seafloor
 * elevation along that line is sampled from Terrarium-encoded DEM tiles
 * (AWS Terrain Tiles). This module is the PURE geometry + assembly half of
 * that feature:
 *
 *   1. densify the drawn segment into evenly spaced sample points,
 *   2. work out which slippy DEM tiles those points fall in (so the app can
 *      fetch them), and
 *   3. assemble the app-decoded elevations back into a distance/elevation
 *      profile plus a CSV export.
 *
 * The app owns all I/O: it fetches the tiles named by {@link uniqueTiles},
 * decodes each pixel with the terrarium formula
 * (elevation_m = R*256 + G + B/256 - 32768, see terrain.js), and hands the
 * decoded elevations back to {@link buildProfile}. Nothing here touches the
 * DOM, the network, or a clock — same inputs always give the same output.
 *
 * Conventions (shared across the library):
 * - Points are `{lon, lat}` in degrees, WGS84 (`{lon, lat, dist}` once sampled,
 *   where `dist` is cumulative great-circle metres from the start).
 * - Slippy tiles are standard XYZ / Web-Mercator; latitude is clamped to the
 *   Web-Mercator limit ±85.05112878° before tiling.
 */

/**
 * IUGG mean Earth radius in metres, used for great-circle distances. Matches
 * the radius the marine-map-core distance math is specified against.
 */
const EARTH_RADIUS_M = 6371008.8;

/** Web-Mercator latitude limit (degrees): the square-world cutoff. */
const MERCATOR_LAT_LIMIT = 85.05112878;

const DEG2RAD = Math.PI / 180;

/**
 * Clamp a number into an inclusive range.
 * @param {number} v Value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} `v` clamped to `[lo, hi]`.
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Great-circle distance between two lon/lat points via the haversine formula
 * on a sphere of radius {@link EARTH_RADIUS_M}.
 *
 * @param {{lon: number, lat: number}} a First point, degrees WGS84.
 * @param {{lon: number, lat: number}} b Second point, degrees WGS84.
 * @returns {number} Distance in metres (≥ 0).
 */
export function haversineMeters(a, b) {
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = (b.lon - a.lon) * DEG2RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Densify a segment a→b into `n` evenly spaced sample points. Longitude and
 * latitude are linearly interpolated by fraction along the segment (fine for
 * the short lines a marine transect draws); the endpoints are returned exactly
 * (no floating-point drift). Each point carries `dist`, the cumulative
 * great-circle distance in metres from `a` (`dist[0] === 0`, monotonically
 * non-decreasing).
 *
 * @param {{lon: number, lat: number}} a Start point, degrees WGS84.
 * @param {{lon: number, lat: number}} b End point, degrees WGS84.
 * @param {number} n Number of samples, an integer ≥ 2 (inclusive of both ends).
 * @returns {Array<{lon: number, lat: number, dist: number}>} The `n` samples.
 * @throws {RangeError} If `n` is not an integer ≥ 2.
 */
export function sampleLine(a, b, n) {
  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError(`sampleLine: n must be an integer >= 2, got ${n}`);
  }
  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;
  const out = new Array(n);
  let prev;
  let dist = 0;
  for (let i = 0; i < n; i++) {
    let lon;
    let lat;
    if (i === 0) {
      lon = a.lon;
      lat = a.lat;
    } else if (i === n - 1) {
      lon = b.lon;
      lat = b.lat;
    } else {
      const t = i / (n - 1);
      lon = a.lon + dLon * t;
      lat = a.lat + dLat * t;
    }
    const point = { lon, lat };
    if (i > 0) dist += haversineMeters(prev, point);
    out[i] = { lon, lat, dist };
    prev = point;
  }
  return out;
}

/**
 * Map a lon/lat to its Web-Mercator slippy tile and the pixel within that tile
 * (standard XYZ scheme). Latitude is clamped to ±85.05112878° before tiling.
 * Tile indices are clamped to the valid `[0, 2^z - 1]` range and the pixel is
 * clamped to `[0, tileSize - 1]`, so the antimeridian / poles fold onto the
 * last row/column rather than overflowing.
 *
 * @param {number} lon Longitude in degrees, WGS84.
 * @param {number} lat Latitude in degrees, WGS84.
 * @param {number} z Integer zoom level (`n = 2^z` tiles per axis).
 * @param {number} [tileSize=256] Tile edge length in pixels.
 * @returns {{tx: number, ty: number, px: number, py: number}} Tile indices
 *   (`tx`, `ty`) and integer pixel offsets (`px`, `py`) in `[0, tileSize - 1]`.
 */
export function lonLatToTilePixel(lon, lat, z, tileSize = 256) {
  const n = 2 ** z;
  const latClamped = clamp(lat, -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT);
  const latRad = latClamped * DEG2RAD;

  const txf = ((lon + 180) / 360) * n;
  const tyf = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;

  let tx = Math.floor(txf);
  let ty = Math.floor(tyf);
  let px = Math.floor((txf - tx) * tileSize);
  let py = Math.floor((tyf - ty) * tileSize);

  if (tx < 0) { tx = 0; px = 0; }
  else if (tx > n - 1) { tx = n - 1; px = tileSize - 1; }
  if (ty < 0) { ty = 0; py = 0; }
  else if (ty > n - 1) { ty = n - 1; py = tileSize - 1; }

  return { tx, ty, px, py };
}

/**
 * The distinct DEM tiles the app must fetch to cover every sample, deduped and
 * ordered by first appearance along the transect (so adjacent samples that
 * fall in the same tile collapse to one entry).
 *
 * @param {Array<{lon: number, lat: number}>} samples Sample points (e.g. from
 *   {@link sampleLine}).
 * @param {number} z Integer zoom level.
 * @param {number} [tileSize=256] Tile edge length in pixels.
 * @returns {Array<{tx: number, ty: number, z: number}>} Unique `{tx, ty, z}`
 *   tiles in first-seen order.
 */
export function uniqueTiles(samples, z, tileSize = 256) {
  const seen = new Set();
  const tiles = [];
  for (const s of samples) {
    const { tx, ty } = lonLatToTilePixel(s.lon, s.lat, z, tileSize);
    const key = `${tx}/${ty}`;
    if (!seen.has(key)) {
      seen.add(key);
      tiles.push({ tx, ty, z });
    }
  }
  return tiles;
}

/**
 * Assemble sampled points and their app-decoded elevations into a depth
 * profile. `elevations[i]` is the seafloor elevation (metres, negative below
 * sea level) at `samples[i]`; `null` marks a sample whose DEM tile was missing.
 * Null elevations are carried into `points` but skipped when computing
 * `min`/`max`.
 *
 * @param {Array<{lon: number, lat: number, dist: number}>} samples Sampled
 *   points, as produced by {@link sampleLine}.
 * @param {Array<number|null>} elevations Elevation per sample, aligned by index;
 *   `null` (or `undefined`) means no data.
 * @returns {{points: Array<{dist: number, lon: number, lat: number,
 *   elev: number|null}>, length: number, min: number|null, max: number|null,
 *   meanSlope: number}} The profile: `points` in order, `length` = last point's
 *   `dist` (0 if empty), `min`/`max` over the non-null elevations (`null` when
 *   all are null), and `meanSlope` = (max − min) / length as a dimensionless
 *   rise-over-run (0 when `length` is 0 or no elevation data).
 * @throws {RangeError} If `samples` and `elevations` differ in length.
 */
export function buildProfile(samples, elevations) {
  if (samples.length !== elevations.length) {
    throw new RangeError(
      `buildProfile: samples (${samples.length}) and elevations ` +
        `(${elevations.length}) must be the same length`,
    );
  }

  const points = new Array(samples.length);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const raw = elevations[i];
    const elev = raw == null ? null : raw;
    points[i] = { dist: s.dist, lon: s.lon, lat: s.lat, elev };
    if (elev !== null) {
      if (elev < min) min = elev;
      if (elev > max) max = elev;
    }
  }

  const hasData = min !== Infinity;
  const length = points.length ? points[points.length - 1].dist : 0;
  const range = hasData ? max - min : 0;
  const meanSlope = length === 0 ? 0 : range / length;

  return {
    points,
    length,
    min: hasData ? min : null,
    max: hasData ? max : null,
    meanSlope,
  };
}

/**
 * Serialise a profile as an RFC-4180 CSV string (CRLF row terminators, no
 * trailing newline). The header is
 * `distance_m,longitude,latitude,elevation_m` followed by one row per point;
 * a `null` elevation renders as an empty field.
 *
 * @param {{points: Array<{dist: number, lon: number, lat: number,
 *   elev: number|null}>}} profile A profile from {@link buildProfile}.
 * @returns {string} The CSV text (`points.length + 1` records).
 */
export function profileToCSV(profile) {
  const rows = ['distance_m,longitude,latitude,elevation_m'];
  for (const p of profile.points) {
    const elev = p.elev == null ? '' : p.elev;
    rows.push(`${p.dist},${p.lon},${p.lat},${elev}`);
  }
  return rows.join('\r\n');
}
