/**
 * furniture.js — cartographic-furniture math: scale bars, graticules,
 * colorbar ticks, coordinate labels, and Web-Mercator canvas projection.
 *
 * Pure geometry and formatting only; all drawing happens elsewhere.
 * Geographic bounds objects are {west, south, east, north} in degrees, WGS84.
 */

/** Equatorial circumference of the WGS84 ellipsoid, in meters. */
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Latitude limit of the square Web-Mercator world: atan(sinh(PI)). */
const MAX_MERCATOR_LAT = 85.051128779806604;

const DEG2RAD = Math.PI / 180;

/** Candidate graticule steps in degrees, largest first. */
const GRATICULE_STEPS = [45, 30, 20, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01];

/** "Nice" mantissas for scale bars and ticks, i.e. 1|2|5 × 10^n. */
const NICE_MANTISSAS = [1, 2, 5];

/** Strip binary floating-point noise (0.30000000000000004 → 0.3). */
function clean(v) {
  return Number(v.toPrecision(12));
}

/** Mercator y = ln(tan(π/4 + φ/2)), with latitude clamped to the Web-Mercator limit. */
function mercatorY(latDeg) {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latDeg));
  return Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2));
}

/**
 * Web-Mercator ground resolution at a latitude and zoom level.
 * MapLibre zoom levels are 512px-tile based, hence the default tileSize.
 *
 * @param {number} latDeg latitude in degrees
 * @param {number} zoom map zoom level (may be fractional)
 * @param {number} [tileSize=512] tile size in pixels the zoom scale refers to
 * @returns {number} meters of ground distance per screen pixel
 */
export function metersPerPixel(latDeg, zoom, tileSize = 512) {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(latDeg * DEG2RAD)) / (tileSize * 2 ** zoom);
}

/**
 * Largest "nice" scale-bar length (1|2|5 × 10^n meters) that fits in maxPx.
 *
 * @param {number} mPerPx ground resolution in meters per pixel (> 0)
 * @param {number} maxPx maximum bar width in pixels (> 0)
 * @returns {{meters: number, px: number, label: string}} bar length in meters,
 *   its on-screen width in pixels, and a label like '500 m' or '50 km'
 * @throws {RangeError} if mPerPx or maxPx is not a positive finite number
 */
export function niceScaleBar(mPerPx, maxPx) {
  if (!Number.isFinite(mPerPx) || mPerPx <= 0) {
    throw new RangeError(`niceScaleBar: mPerPx must be a positive number, got ${mPerPx}`);
  }
  if (!Number.isFinite(maxPx) || maxPx <= 0) {
    throw new RangeError(`niceScaleBar: maxPx must be a positive number, got ${maxPx}`);
  }
  const maxMeters = mPerPx * maxPx;
  const e = Math.floor(Math.log10(maxMeters));
  let meters = 0;
  // Scan two decades downward so a log10 rounding error at exact powers of
  // ten can never skip the optimal candidate.
  outer: for (const exp of [e + 1, e]) {
    for (const m of [5, 2, 1]) {
      const candidate = clean(m * 10 ** exp);
      if (candidate <= maxMeters * (1 + 1e-9)) {
        meters = candidate;
        break outer;
      }
    }
  }
  const label = meters >= 1000 ? `${clean(meters / 1000)} km` : `${meters} m`;
  return { meters, px: meters / mPerPx, label };
}

/**
 * Choose a nice graticule step for a span of degrees, targeting roughly
 * 4–6 lines across the span.
 *
 * @param {number} spanDeg angular span in degrees (> 0)
 * @returns {number} step in degrees, one of
 *   45, 30, 20, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.02, 0.01
 * @throws {RangeError} if spanDeg is not a positive finite number
 */
export function graticuleInterval(spanDeg) {
  if (!Number.isFinite(spanDeg) || spanDeg <= 0) {
    throw new RangeError(`graticuleInterval: spanDeg must be a positive number, got ${spanDeg}`);
  }
  let best = GRATICULE_STEPS[GRATICULE_STEPS.length - 1];
  let bestScore = Infinity;
  for (const step of GRATICULE_STEPS) {
    const score = Math.abs(spanDeg / step - 5);
    if (score < bestScore) {
      bestScore = score;
      best = step;
    }
  }
  return best;
}

/** Build a two-point LineString feature for a graticule line. */
function lineFeature(kind, value, coordinates) {
  return {
    type: 'Feature',
    properties: { kind, value },
    geometry: { type: 'LineString', coordinates },
  };
}

/**
 * Graticule (meridian/parallel) lines snapped to multiples of intervalDeg
 * inside bounds. Each line is a two-point LineString (Web Mercator renders
 * meridians and parallels straight). Parallels — and the latitude extent of
 * meridians — are clamped to [-85, 85].
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 *   geographic bounds in degrees, WGS84
 * @param {number} intervalDeg line spacing in degrees (> 0)
 * @returns {object} GeoJSON FeatureCollection of LineStrings with
 *   properties {kind: 'meridian'|'parallel', value: number}
 * @throws {RangeError} if intervalDeg is not a positive finite number
 */
export function graticuleLines(bounds, intervalDeg) {
  if (!Number.isFinite(intervalDeg) || intervalDeg <= 0) {
    throw new RangeError(`graticuleLines: intervalDeg must be a positive number, got ${intervalDeg}`);
  }
  const { west, south, east, north } = bounds;
  const latMin = Math.max(south, -85);
  const latMax = Math.min(north, 85);
  const features = [];
  const eps = 1e-9;
  if (latMax > latMin && east > west) {
    const i0 = Math.ceil(west / intervalDeg - eps);
    const i1 = Math.floor(east / intervalDeg + eps);
    for (let i = i0; i <= i1; i++) {
      const lon = clean(i * intervalDeg);
      features.push(lineFeature('meridian', lon, [[lon, latMin], [lon, latMax]]));
    }
    const j0 = Math.ceil(latMin / intervalDeg - eps);
    const j1 = Math.floor(latMax / intervalDeg + eps);
    for (let j = j0; j <= j1; j++) {
      const lat = clean(j * intervalDeg);
      features.push(lineFeature('parallel', lat, [[west, lat], [east, lat]]));
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Nice colorbar tick values: multiples of 1|2|5 × 10^n lying within
 * [min, max], at most maxTicks of them, sorted ascending.
 *
 * @param {number} min lower end of the data range
 * @param {number} max upper end of the data range (>= min)
 * @param {number} [maxTicks=6] maximum number of ticks (>= 2)
 * @returns {number[]} tick values inside [min, max], ascending
 * @throws {RangeError} if the range is invalid or maxTicks < 2
 */
export function colorbarTicks(min, max, maxTicks = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    throw new RangeError(`colorbarTicks: invalid range [${min}, ${max}]`);
  }
  if (!Number.isFinite(maxTicks) || maxTicks < 2) {
    throw new RangeError(`colorbarTicks: maxTicks must be >= 2, got ${maxTicks}`);
  }
  if (max === min) return [clean(min)];
  const span = max - min;
  const e0 = Math.floor(Math.log10(span / maxTicks)) - 1;
  for (let e = e0; e <= e0 + 40; e++) {
    for (const m of NICE_MANTISSAS) {
      const step = clean(m * 10 ** e);
      const eps = step * 1e-9;
      const i0 = Math.ceil((min - eps) / step);
      const i1 = Math.floor((max + eps) / step);
      if (i1 - i0 + 1 <= maxTicks) {
        const ticks = [];
        for (let i = i0; i <= i1; i++) ticks.push(clean(i * step));
        return ticks;
      }
    }
  }
  /* c8 ignore next */
  return []; // unreachable: step eventually exceeds the span
}

/**
 * Format a coordinate as a degree label: '45°N', '12.5°W', '0°', '180°'.
 * Zero and ±180° longitude carry no hemisphere letter.
 *
 * @param {number} value coordinate in degrees (sign encodes hemisphere)
 * @param {'lat'|'lon'} axis which axis the value belongs to
 * @returns {string} degree label
 * @throws {RangeError} if axis is not 'lat' or 'lon'
 */
export function formatDegree(value, axis) {
  if (axis !== 'lat' && axis !== 'lon') {
    throw new RangeError(`formatDegree: axis must be 'lat' or 'lon', got ${axis}`);
  }
  const abs = clean(Math.abs(value));
  if (abs === 0) return '0°';
  if (axis === 'lon' && abs === 180) return '180°';
  const hemisphere = axis === 'lat' ? (value > 0 ? 'N' : 'S') : (value > 0 ? 'E' : 'W');
  return `${abs}°${hemisphere}`;
}

/**
 * Depth label from an elevation in meters: -1500 → '1,500 m'. Uses the
 * absolute value with en-US thousands separators; keeps one decimal only
 * when |m| < 10 and the value is non-integer.
 *
 * @param {number} m elevation in meters (negative below sea level)
 * @returns {string} depth label such as '1,500 m' or '3.8 m'
 * @throws {RangeError} if m is not a finite number
 */
export function formatDepth(m) {
  if (!Number.isFinite(m)) {
    throw new RangeError(`formatDepth: m must be a finite number, got ${m}`);
  }
  const abs = Math.abs(m);
  if (abs < 10 && !Number.isInteger(abs)) {
    const rounded = Math.round(abs * 10) / 10;
    return `${rounded.toLocaleString('en-US', { maximumFractionDigits: 1 })} m`;
  }
  return `${Math.round(abs).toLocaleString('en-US')} m`;
}

/**
 * Project a lon/lat into pixel coordinates of a canvas whose edges
 * correspond exactly to bounds under Web Mercator. x is linear in
 * longitude; y uses the Mercator latitude ln(tan(π/4 + φ/2)), so
 * (west, north) → [0, 0] and (east, south) → [widthPx, heightPx].
 * Latitudes are clamped to the Web-Mercator limit (±85.0511°).
 *
 * @param {number} lon longitude in degrees
 * @param {number} lat latitude in degrees
 * @param {{west: number, south: number, east: number, north: number}} bounds
 *   geographic bounds the canvas edges map to
 * @param {number} widthPx canvas width in pixels (> 0)
 * @param {number} heightPx canvas height in pixels (> 0)
 * @returns {[number, number]} [x, y] pixel coordinates (y grows downward)
 * @throws {RangeError} if bounds are degenerate or the canvas size is not positive
 */
export function lonLatToCanvasXY(lon, lat, bounds, widthPx, heightPx) {
  const { west, south, east, north } = bounds;
  if (!(east > west) || !(north > south)) {
    throw new RangeError(`lonLatToCanvasXY: degenerate bounds [${west}, ${south}, ${east}, ${north}]`);
  }
  if (!(widthPx > 0) || !(heightPx > 0)) {
    throw new RangeError(`lonLatToCanvasXY: canvas size must be positive, got ${widthPx}×${heightPx}`);
  }
  const x = ((lon - west) / (east - west)) * widthPx;
  const yTop = mercatorY(north);
  const yBottom = mercatorY(south);
  const y = ((yTop - mercatorY(lat)) / (yTop - yBottom)) * heightPx;
  return [x, y];
}
