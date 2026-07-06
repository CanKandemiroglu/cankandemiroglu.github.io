/**
 * occurrences.js — GBIF and OBIS species-occurrence query building and
 * response parsing for the marine map tool (a home for the displaced
 * SimpleMappr audience).
 *
 * Pure URL construction and JSON parsing: no DOM, no fetch, no I/O. The
 * calling app performs the actual CORS requests (both APIs return
 * Access-Control-Allow-Origin: *) and feeds the parsed points back through
 * these helpers. Bounds are {west, south, east, north} in degrees, WGS84.
 * A parsed occurrence is {lon, lat, name, value, date, source}; a station is
 * {lon, lat, name, value}.
 */

/** GBIF species/name fuzzy-match endpoint. */
const GBIF_MATCH = 'https://api.gbif.org/v1/species/match';
/** GBIF occurrence search endpoint. */
const GBIF_OCCURRENCE = 'https://api.gbif.org/v1/occurrence/search';
/** OBIS occurrence endpoint. */
const OBIS_OCCURRENCE = 'https://api.obis.org/v3/occurrence';

/** Clamp a value into the inclusive range [lo, hi]. */
function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Coerce a value to a finite integer inside [lo, hi], truncating fractions.
 * Non-numeric or non-finite input yields the supplied fallback (then clamped).
 */
function clampInt(value, lo, hi, fallback) {
  const n = Number(value);
  const base = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return clamp(base, lo, hi);
}

/** Return x as a finite number, or null for anything non-numeric/blank. */
function toFiniteOrNull(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Trimmed string form of a name-ish value, or '' when absent. */
function cleanName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

/**
 * Validate a bounds object, throwing a TypeError when it is missing or not a
 * geographic {west, south, east, north} rectangle in WGS84 degrees.
 * @param {*} bounds candidate bounds
 * @returns {{west: number, south: number, east: number, north: number}} bounds
 */
function assertBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    throw new TypeError('bounds is required and must be a {west, south, east, north} object');
  }
  for (const key of ['west', 'south', 'east', 'north']) {
    if (!Number.isFinite(bounds[key])) {
      throw new TypeError(`bounds.${key} must be a finite number`);
    }
  }
  if (bounds.west < -180 || bounds.west > 180 || bounds.east < -180 || bounds.east > 180) {
    throw new TypeError('bounds west/east must lie within [-180, 180]');
  }
  if (bounds.south < -90 || bounds.south > 90 || bounds.north < -90 || bounds.north > 90) {
    throw new TypeError('bounds south/north must lie within [-90, 90]');
  }
  return bounds;
}

/** Round to 5 decimal places (WKT coordinate precision), avoiding -0. */
function round5(x) {
  const r = Math.round(x * 1e5) / 1e5;
  return r === 0 ? 0 : r;
}

/**
 * Join a base URL with an ordered list of [key, preEncodedValue] pairs.
 * Pairs whose value is null/undefined are omitted; values are inserted
 * verbatim, so callers encode anything that needs encoding beforehand.
 */
function buildURL(base, pairs) {
  const query = pairs
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return query ? `${base}?${query}` : base;
}

/**
 * Build the GBIF taxon-match URL for a scientific name.
 * @param {string} name scientific name to resolve (e.g. "Thunnus thynnus")
 * @returns {string} the GBIF species/match request URL
 */
export function gbifTaxonMatchURL(name) {
  return `${GBIF_MATCH}?name=${encodeURIComponent(String(name ?? ''))}`;
}

/**
 * Build a GBIF occurrence-search URL restricted to a bounding box.
 *
 * Emits, in order: scientificName (only when non-empty), decimalLatitude as
 * "south,north", decimalLongitude as "west,east", hasCoordinate=true, the
 * limit clamped to [1, 300], and the offset (>= 0). The name is percent-
 * encoded; range commas are left literal (valid in a query string).
 *
 * @param {object} params
 * @param {string|null} [params.scientificName=null] filter by name; omitted when blank
 * @param {{west: number, south: number, east: number, north: number}} params.bounds required bbox
 * @param {number} [params.limit=200] page size, clamped to [1, 300]
 * @param {number} [params.offset=0] page offset, clamped to >= 0
 * @returns {string} the GBIF occurrence/search request URL
 * @throws {TypeError} when bounds is missing or invalid
 */
export function gbifOccurrenceURL({ scientificName = null, bounds, limit = 200, offset = 0 } = {}) {
  const { west, south, east, north } = assertBounds(bounds);
  const name = cleanName(scientificName);
  return buildURL(GBIF_OCCURRENCE, [
    ['scientificName', name !== '' ? encodeURIComponent(name) : null],
    ['decimalLatitude', `${south},${north}`],
    ['decimalLongitude', `${west},${east}`],
    ['hasCoordinate', 'true'],
    ['limit', String(clampInt(limit, 1, 300, 200))],
    ['offset', String(clampInt(offset, 0, Number.MAX_SAFE_INTEGER, 0))],
  ]);
}

/**
 * Build the closed WKT polygon ring for a bounding box.
 *
 * The ring runs west-south, east-south, east-north, west-north and back to
 * west-south (counter-clockwise, first point repeated to close it); every
 * coordinate is rounded to 5 decimal places.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds bbox
 * @returns {string} a 'POLYGON((lon lat, ...))' string
 * @throws {TypeError} when bounds is missing or invalid
 */
export function bboxWKT(bounds) {
  const { west, south, east, north } = assertBounds(bounds);
  const w = round5(west);
  const s = round5(south);
  const e = round5(east);
  const n = round5(north);
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

/**
 * Build an OBIS occurrence URL restricted to a bounding box.
 *
 * Emits, in order: scientificname (only when non-empty), geometry as the
 * percent-encoded closed WKT polygon of the bounds (see bboxWKT), and size
 * clamped to [1, 10000].
 *
 * @param {object} params
 * @param {string|null} [params.scientificName=null] filter by name; omitted when blank
 * @param {{west: number, south: number, east: number, north: number}} params.bounds required bbox
 * @param {number} [params.size=1000] result cap, clamped to [1, 10000]
 * @returns {string} the OBIS occurrence request URL
 * @throws {TypeError} when bounds is missing or invalid
 */
export function obisOccurrenceURL({ scientificName = null, bounds, size = 1000 } = {}) {
  const wkt = bboxWKT(bounds);
  const name = cleanName(scientificName);
  return buildURL(OBIS_OCCURRENCE, [
    ['scientificname', name !== '' ? encodeURIComponent(name) : null],
    ['geometry', encodeURIComponent(wkt)],
    ['size', String(clampInt(size, 1, 10000, 1000))],
  ]);
}

/**
 * Shared row mapper for GBIF/OBIS occurrence responses.
 * Skips rows without finite decimal coordinates; clamps surviving
 * coordinates into valid geographic range.
 */
function parseOccurrences(json, source, pickDepth) {
  const results = json && Array.isArray(json.results) ? json.results : [];
  const out = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const lat = toFiniteOrNull(r.decimalLatitude);
    const lon = toFiniteOrNull(r.decimalLongitude);
    if (lat === null || lon === null) continue;
    out.push({
      lon: clamp(lon, -180, 180),
      lat: clamp(lat, -90, 90),
      name: r.scientificName || r.species || 'occurrence',
      value: toFiniteOrNull(pickDepth(r)),
      date: r.eventDate ?? null,
      source,
    });
  }
  return out;
}

/**
 * Parse a GBIF occurrence-search response into normalised points.
 *
 * Reads json.results; each kept row becomes
 * {lon, lat, name, value, date, source:'GBIF'} where name falls back
 * scientificName -> species -> 'occurrence', value is a finite depth or null,
 * and date is eventDate or null. Rows lacking finite coordinates are dropped.
 *
 * @param {{results?: Array<object>}} json GBIF response JSON
 * @returns {Array<{lon: number, lat: number, name: string, value: number|null,
 *   date: string|null, source: 'GBIF'}>} parsed occurrences
 */
export function parseGBIF(json) {
  return parseOccurrences(json, 'GBIF', (r) => r.depth);
}

/**
 * Parse an OBIS occurrence response into normalised points.
 *
 * Identical shape to parseGBIF but with source:'OBIS' and depth taken from
 * depth ?? minimumDepthInMeters.
 *
 * @param {{results?: Array<object>}} json OBIS response JSON
 * @returns {Array<{lon: number, lat: number, name: string, value: number|null,
 *   date: string|null, source: 'OBIS'}>} parsed occurrences
 */
export function parseOBIS(json) {
  return parseOccurrences(json, 'OBIS', (r) => r.depth ?? r.minimumDepthInMeters);
}

/**
 * Reduce parsed occurrences to bare stations, dropping date and source so the
 * points can flow through the existing station pipeline.
 *
 * @param {Array<{lon: number, lat: number, name: string, value: number|null}>} list occurrences
 * @returns {Array<{lon: number, lat: number, name: string, value: number|null}>} stations
 */
export function occurrencesToStations(list) {
  return (Array.isArray(list) ? list : []).map(
    ({ lon, lat, name, value }) => ({ lon, lat, name, value }),
  );
}

/**
 * Remove duplicate occurrences that share a name and, once rounded, the same
 * longitude and latitude. Order is preserved and the first of each group is
 * kept — useful for collapsing GBIF/OBIS overlap or grid-snapped repeats.
 *
 * @param {Array<{lon: number, lat: number, name: string}>} list occurrences
 * @param {number} [precisionDp=4] decimal places used when comparing coordinates
 * @returns {Array<object>} the de-duplicated list (same element references)
 */
export function dedupeOccurrences(list, precisionDp = 4) {
  const items = Array.isArray(list) ? list : [];
  const factor = 10 ** precisionDp;
  const round = (v) => {
    const r = Math.round(Number(v) * factor) / factor;
    return r === 0 ? 0 : r;
  };
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const key = `${item.name}|${round(item.lon)}|${round(item.lat)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
