/**
 * stations.js — station-table parsing: delimited text (CSV / TSV / semicolon)
 * or pre-split rows (e.g. SheetJS array-of-arrays) -> validated stations.
 *
 * Pure string/number processing only; no DOM, no I/O.
 * A station is {lon, lat, name, value} with coordinates in degrees, WGS84.
 */

/** Delimiters considered by the sniffer, in tie-break preference order. */
const DELIMITER_CANDIDATES = [',', ';', '\t'];

/** How many non-empty lines the delimiter sniffer inspects. */
const MAX_SNIFF_LINES = 10;

/** Maximum number of row-error messages kept before summarising the rest. */
const MAX_ERRORS = 20;

/** Recognised header spellings, pre-normalised (lowercase, alphanumeric only). */
const LAT_NAMES = ['latitude', 'lat', 'y', 'declat', 'decimallatitude'];
const LON_NAMES = ['longitude', 'lon', 'long', 'lng', 'x', 'declon', 'decimallongitude'];
const NAME_NAMES = ['name', 'station', 'stationid', 'id', 'label', 'site', 'sample'];
const VALUE_NAMES = [
  'depth', 'z', 'value', 'temp', 'temperature', 'salinity',
  'conc', 'concentration', 'abundance',
];

/** Count occurrences of ch in line that fall outside double-quoted sections. */
function countOutsideQuotes(line, ch) {
  let n = 0;
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ch && !inQuotes) n++;
  }
  return n;
}

/**
 * Guess the field delimiter of a block of delimited text.
 *
 * Counts each candidate (',' ';' '\t') outside quoted sections on the first
 * up-to-10 non-empty lines and prefers the candidate whose per-line count is
 * most consistent (ties broken by higher column count, then by ',' > ';' > tab).
 *
 * @param {string} text raw file contents
 * @returns {','|';'|'\t'} the most plausible delimiter; ',' when undecidable
 */
export function sniffDelimiter(text) {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r\n|[\r\n]/)
    .filter((l) => l.trim() !== '')
    .slice(0, MAX_SNIFF_LINES);

  let best = ',';
  let bestScore = 0; // lines agreeing on the modal count
  let bestMode = 0; // that modal per-line count
  for (const d of DELIMITER_CANDIDATES) {
    const freq = new Map(); // per-line count (>= 1) -> number of lines
    for (const line of lines) {
      const c = countOutsideQuotes(line, d);
      if (c >= 1) freq.set(c, (freq.get(c) || 0) + 1);
    }
    let mode = 0;
    let score = 0;
    for (const [count, f] of freq) {
      if (f > score || (f === score && count > mode)) {
        score = f;
        mode = count;
      }
    }
    if (score > bestScore || (score === bestScore && mode > bestMode)) {
      best = d;
      bestScore = score;
      bestMode = mode;
    }
  }
  return bestScore >= 1 ? best : ',';
}

/**
 * Parse RFC-4180-ish delimited text into headers and data rows.
 *
 * Double-quoted fields may contain delimiters, newlines, and escaped quotes
 * (""). Handles CRLF line endings, strips a leading UTF-8 BOM, and skips
 * blank lines. The first non-blank record becomes the (trimmed) header row;
 * data-row fields are returned verbatim.
 *
 * @param {string} text raw file contents
 * @param {string|null} [delimiter=null] field delimiter; null = sniffDelimiter(text)
 * @returns {{headers: string[], rows: string[][]}} header names and data rows
 */
export function parseDelimited(text, delimiter = null) {
  let src = String(text ?? '');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const delim = delimiter || sniffDelimiter(src);

  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delim) {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonBlank = records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (nonBlank.length === 0) return { headers: [], rows: [] };
  return { headers: nonBlank[0].map((h) => h.trim()), rows: nonBlank.slice(1) };
}

/** Lowercase a header, drop parenthesised units, keep alphanumerics only. */
function normalizeHeader(header) {
  return String(header ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // 'Latitude (deg)' -> 'latitude '
    .replace(/[^a-z0-9]+/g, ''); // spaces, underscores, punctuation
}

/**
 * First unclaimed column matching a candidate list: exact matches win over
 * prefix matches ('depthm' matches 'depth'); prefixes need >= 3 chars so
 * single-letter candidates like 'x'/'y'/'z' only ever match exactly.
 */
function findColumn(normalized, candidates, used) {
  for (let i = 0; i < normalized.length; i++) {
    if (!used.has(i) && candidates.includes(normalized[i])) return i;
  }
  for (let i = 0; i < normalized.length; i++) {
    if (used.has(i)) continue;
    if (candidates.some((c) => c.length >= 3 && normalized[i].startsWith(c))) return i;
  }
  return -1;
}

/**
 * Guess which columns hold latitude, longitude, station name, and value.
 *
 * Matching is case-, space-, and underscore-insensitive and ignores
 * parenthesised units ('Latitude (deg)' matches 'latitude'). When no value
 * candidate matches, the first column not claimed by lat/lon/name is used.
 *
 * @param {string[]} headers header row from parseDelimited (or a spreadsheet)
 * @returns {{lat: number, lon: number, name: number, value: number}}
 *   column indices, each -1 when no plausible column exists
 */
export function guessColumns(headers) {
  const normalized = (headers || []).map(normalizeHeader);
  const used = new Set();
  const pick = (candidates) => {
    const idx = findColumn(normalized, candidates, used);
    if (idx >= 0) used.add(idx);
    return idx;
  };
  const lat = pick(LAT_NAMES);
  const lon = pick(LON_NAMES);
  const name = pick(NAME_NAMES);
  let value = pick(VALUE_NAMES);
  if (value < 0) {
    for (let i = 0; i < normalized.length; i++) {
      if (!used.has(i)) {
        value = i;
        break;
      }
    }
  }
  return { lat, lon, name, value };
}

/**
 * Strip degree symbols and whitespace, then apply the European decimal-comma
 * rule: a string with no '.' and exactly one ',' reads the comma as a decimal
 * point ('41,25' -> '41.25').
 */
function normalizeNumericString(s) {
  let t = s.replace(/[°º]/g, '').replace(/\s+/g, '');
  if (!t.includes('.')) {
    const first = t.indexOf(',');
    if (first !== -1 && first === t.lastIndexOf(',')) {
      t = `${t.slice(0, first)}.${t.slice(first + 1)}`;
    }
  }
  return t;
}

/**
 * Parse one coordinate cell to signed decimal degrees.
 * Accepts numbers (spreadsheet cells) and strings with degree symbols,
 * decimal commas, and N/S/E/W suffixes (S and W flip the sign). A hemisphere
 * letter from the wrong axis (e.g. 'E' on a latitude) is rejected.
 *
 * @param {*} raw cell value
 * @param {'lat'|'lon'} axis which axis the cell belongs to
 * @returns {number} decimal degrees, or NaN when unreadable
 */
function parseCoordinate(raw, axis) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (s === '') return NaN;
  let sign = 1;
  const suffix = s[s.length - 1].toUpperCase();
  if ('NSEW'.includes(suffix)) {
    if (!(axis === 'lat' ? 'NS' : 'EW').includes(suffix)) return NaN;
    if (suffix === 'S' || suffix === 'W') sign = -1;
    s = s.slice(0, -1);
  }
  const t = normalizeNumericString(s);
  if (t === '') return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? sign * v : NaN;
}

/** Parse a value cell to a finite number, or null when absent/unreadable. */
function parseValue(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  const t = normalizeNumericString(String(raw).trim());
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Wrap a longitude into [-180, 180]; +180 and 0-360 inputs are accepted. */
function normalizeLongitude(lon) {
  if (lon >= -180 && lon <= 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Render a cell for an error message. */
function describeCell(raw) {
  const s = raw == null ? '' : String(raw).trim();
  return s === '' ? '(empty)' : `"${s}"`;
}

/**
 * Convert a header row plus data rows into validated stations.
 *
 * Rows may come from parseDelimited (strings) or a spreadsheet reader
 * (numbers and strings mixed). Coordinates accept decimal commas, degree
 * symbols, and hemisphere suffixes; longitudes are wrapped into [-180, 180]
 * (0-360 input is fine). Latitude must land in [-90, 90]. Invalid rows are
 * skipped with a message in errors (capped at 20, then '…and N more');
 * fully blank rows are skipped silently. Row numbers in names and error
 * messages are 1-based over the data rows (headers excluded).
 *
 * @param {string[]} headers header row (used for column guessing and only
 *   when mapping is null)
 * @param {Array<Array<*>>} rows data rows
 * @param {{lat?: number, lon?: number, name?: number, value?: number}|null}
 *   [mapping=null] explicit column indices replacing guessColumns(headers);
 *   omitted or negative entries mean "no such column"
 * @returns {{stations: Array<{lon: number, lat: number, name: string,
 *   value: number|null}>, errors: string[]}}
 */
export function toStations(headers, rows, mapping = null) {
  const guessed = mapping || guessColumns(headers || []);
  const cols = {};
  for (const key of ['lat', 'lon', 'name', 'value']) {
    const v = guessed[key];
    cols[key] = Number.isInteger(v) && v >= 0 ? v : -1;
  }
  if (cols.lat < 0 || cols.lon < 0) {
    return {
      stations: [],
      errors: [
        'No latitude/longitude columns found — expected headers like '
          + '"lat"/"latitude" and "lon"/"longitude", or pass an explicit column mapping.',
      ],
    };
  }

  const stations = [];
  const errors = [];
  let overflow = 0;
  const fail = (msg) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
    else overflow++;
  };

  (rows || []).forEach((row, i) => {
    const rowNo = i + 1;
    if (!Array.isArray(row)) return fail(`Row ${rowNo}: not a list of cells`);
    if (row.every((cell) => (cell == null ? '' : String(cell).trim()) === '')) return; // blank

    const lat = parseCoordinate(row[cols.lat], 'lat');
    if (Number.isNaN(lat)) {
      return fail(`Row ${rowNo}: unreadable latitude ${describeCell(row[cols.lat])}`);
    }
    if (lat < -90 || lat > 90) {
      return fail(`Row ${rowNo}: latitude ${lat} outside [-90, 90]`);
    }
    const lonRaw = parseCoordinate(row[cols.lon], 'lon');
    if (Number.isNaN(lonRaw)) {
      return fail(`Row ${rowNo}: unreadable longitude ${describeCell(row[cols.lon])}`);
    }
    const lon = normalizeLongitude(lonRaw);

    let name = cols.name >= 0 && row[cols.name] != null ? String(row[cols.name]).trim() : '';
    if (name === '') name = `S${rowNo}`;
    const value = cols.value >= 0 ? parseValue(row[cols.value]) : null;
    stations.push({ lon, lat, name, value });
  });

  if (overflow > 0) errors.push(`…and ${overflow} more`);
  return { stations, errors };
}

/**
 * Convert stations to a GeoJSON Point FeatureCollection.
 *
 * @param {Array<{lon: number, lat: number, name: string, value: number|null}>}
 *   stations output of toStations
 * @returns {{type: 'FeatureCollection', features: Array<object>}} features
 *   with Point geometry [lon, lat] and properties {name, value}
 */
export function stationsToGeoJSON(stations) {
  return {
    type: 'FeatureCollection',
    features: (stations || []).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { name: s.name, value: s.value },
    })),
  };
}
