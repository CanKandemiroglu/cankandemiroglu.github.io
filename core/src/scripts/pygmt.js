/**
 * pygmt.js — reproducible PyGMT script generation.
 *
 * The flagship export of the library: given a {@link FigureState} — the
 * complete, serialisable description of the on-screen figure — emit a
 * runnable Python 3 script built on PyGMT/GMT 6 that reproduces the figure
 * at publication quality.
 *
 * Everything here is deterministic string building: the same state always
 * yields byte-identical output. No I/O, no clock, no randomness, no DOM.
 *
 * Conventions (shared across the library):
 * - Bounds are `{west, south, east, north}` in degrees, WGS84. `west > east`
 *   denotes an antimeridian-crossing box; the east edge is unfolded to
 *   `east + 360` for span/centre computations.
 * - `state.projection.gmt` is a GMT `-J` template containing the literal
 *   token `WIDTH` (see projection.js). The substitution happens HERE: the
 *   token becomes the physical width in cm, and the leading `-J` is stripped
 *   because PyGMT expects the -J *value* (e.g. `"M16.8c"`, not `"-JM16.8c"`).
 */

/**
 * Complete description of an on-screen figure. Both script generators
 * ({@link generatePyGMT} here and `generateRScript` in rscript.js) accept
 * this same shape.
 *
 * @typedef {object} FigureState
 * @property {string|null} title Figure title, or null for none.
 * @property {{west: number, south: number, east: number, north: number}} region
 *   Mapped region in degrees, WGS84.
 * @property {{id: string, name: string, gmt: string, note: string}} projection
 *   Projection suggestion; `gmt` is a GMT -J template containing the literal
 *   token `WIDTH` (see projection.js).
 * @property {string} colormap cmocean colormap name (e.g. 'deep'). GMT >= 6
 *   and the R `cmocean` package ship these natively, so the name is embedded
 *   as-is — no colour tables are inlined into the script.
 * @property {boolean} reverse Reverse the colormap direction.
 * @property {{min: number, max: number}} depthRange Colour range in metres
 *   (negative = below sea level), e.g. `{min: -6000, max: 0}`.
 * @property {{interval: number, annotInterval: number}|null} contours Depth
 *   contour interval and annotated-contour interval in metres, or null for
 *   no contours.
 * @property {boolean} hillshade Apply hillshade illumination to the relief.
 * @property {{rows: Array<{lon: number, lat: number, name: string, value: number}>,
 *   symbolMm: number, color: string, label: boolean}|null} stations Station
 *   overlay: data rows, symbol diameter in mm, fill colour (CSS hex), and
 *   whether to draw name labels. Null (or empty rows) for no stations.
 * @property {{scaleBar: boolean, northArrow: boolean, graticuleDeg: number,
 *   inset: boolean}} furniture Cartographic furniture toggles; `graticuleDeg`
 *   is the graticule annotation interval in degrees (0/non-finite = auto).
 * @property {{title: string|null, widthMm: number, dpi: number, format: string,
 *   minFontPt: number}} journal Journal export target: title (null = generic),
 *   physical figure width in mm, raster resolution in dpi, file format
 *   ('pdf', 'png', ...), and minimum label font size in points.
 * @property {string[]} citations Plain-text citation lines embedded as header
 *   comments so the provenance travels with the script.
 * @property {string} accessedDate Data access date, 'YYYY-MM-DD'.
 */

/** Column at which wrapped header comments break. */
const WRAP_COL = 78;

/** Horizontal rule used to delimit the header comment block. */
const RULE = `# ${'='.repeat(WRAP_COL - 2)}`;

/* ---------------------------------------------------------------- helpers -- */

/** @returns {boolean} true if `v` is a plain (non-array) object. */
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @returns {boolean} true if `v` is a finite number. */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Render a number compactly and deterministically (max 6 decimals, no
 * trailing zeros, never `-0`).
 *
 * @param {number} n - The value to format.
 * @returns {string} Compact decimal string.
 */
function num(n) {
  const r = Math.round(n * 1e6) / 1e6;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * Round a degree value to 1 decimal for embedding in GMT parameter strings.
 *
 * @param {number} deg - Angle in degrees.
 * @returns {string} Rounded value as a string (never `-0`).
 */
function deg1(deg) {
  const r = Math.round(deg * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * Quote a value as a Python double-quoted string literal, escaping
 * backslashes, double quotes and newlines. Apostrophes need no escaping
 * inside double quotes, which keeps names like "L'Atalante" readable.
 *
 * @param {*} s - Value to stringify and quote.
 * @returns {string} A valid Python string literal including the quotes.
 */
function pyStr(s) {
  const escaped = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n');
  return `"${escaped}"`;
}

/**
 * Collapse whitespace/newlines so a value is safe on a single comment line.
 *
 * @param {*} s - Value to flatten.
 * @returns {string} Single-line string.
 */
function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Word-wrap free text into comment lines with the given prefix.
 *
 * @param {string} text - Text to wrap (whitespace is normalised).
 * @param {string} [prefix='#   '] - Prefix for every emitted line.
 * @returns {string[]} Zero or more comment lines, each <= ~WRAP_COL chars
 *   (single words longer than the width are kept intact).
 */
function wrapComment(text, prefix = '#   ') {
  const words = oneLine(text).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  let line = prefix + words[0];
  for (const w of words.slice(1)) {
    if (line.length + 1 + w.length > WRAP_COL) {
      lines.push(line);
      line = prefix + w;
    } else {
      line += ` ${w}`;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Validate the parts of a FigureState both generators rely on.
 *
 * @param {FigureState} state - The state to check.
 * @param {string} fn - Calling function name, for error messages.
 * @throws {TypeError} If the state (or a required field) is malformed.
 * @throws {RangeError} If region latitudes are inverted or out of range.
 */
function checkState(state, fn) {
  if (!isObject(state)) {
    throw new TypeError(`${fn}: state must be a FigureState object`);
  }
  if (!isObject(state.region)) {
    throw new TypeError(`${fn}: state.region must be {west, south, east, north}`);
  }
  for (const key of ['west', 'south', 'east', 'north']) {
    if (!isFiniteNumber(state.region[key])) {
      throw new TypeError(`${fn}: state.region.${key} must be a finite number (degrees)`);
    }
  }
  if (state.region.south < -90 || state.region.north > 90) {
    throw new RangeError(`${fn}: region latitudes must lie within [-90, 90]`);
  }
  if (state.region.south >= state.region.north) {
    throw new RangeError(`${fn}: region.south must be less than region.north`);
  }
  if (
    !isObject(state.projection) ||
    typeof state.projection.gmt !== 'string' ||
    !state.projection.gmt.includes('WIDTH')
  ) {
    throw new TypeError(
      `${fn}: state.projection.gmt must be a GMT -J template containing the WIDTH token`,
    );
  }
  if (typeof state.colormap !== 'string' || state.colormap.trim() === '') {
    throw new TypeError(`${fn}: state.colormap must be a cmocean colormap name`);
  }
  if (
    !isObject(state.depthRange) ||
    !isFiniteNumber(state.depthRange.min) ||
    !isFiniteNumber(state.depthRange.max)
  ) {
    throw new TypeError(`${fn}: state.depthRange must be {min, max} in metres`);
  }
  if (
    !isObject(state.journal) ||
    !isFiniteNumber(state.journal.widthMm) ||
    state.journal.widthMm <= 0 ||
    !isFiniteNumber(state.journal.dpi) ||
    state.journal.dpi <= 0
  ) {
    throw new TypeError(`${fn}: state.journal must provide positive widthMm and dpi`);
  }
}

/**
 * Derive centre/span geometry from a bounds object, unfolding
 * antimeridian-crossing boxes (west > east) by adding 360 to the east edge.
 *
 * @param {{west: number, south: number, east: number, north: number}} region
 * @returns {{lonSpan: number, latSpan: number, centerLon: number, centerLat: number}}
 */
function deriveGeometry(region) {
  const unfoldedEast = region.west > region.east ? region.east + 360 : region.east;
  const lonSpan = unfoldedEast - region.west;
  const latSpan = region.north - region.south;
  let centerLon = (region.west + unfoldedEast) / 2;
  if (centerLon > 180) centerLon -= 360;
  const centerLat = (region.south + region.north) / 2;
  return { lonSpan, latSpan, centerLon, centerLat };
}

/**
 * Pick the GMT earth-relief resolution for a given longitude span so the
 * download stays proportionate to the mapped area.
 *
 * @param {number} lonSpanDeg - Longitude span in degrees.
 * @returns {string} One of '10m', '02m', '30s', '15s'.
 */
function reliefResolution(lonSpanDeg) {
  if (lonSpanDeg >= 60) return '10m';
  if (lonSpanDeg >= 20) return '02m';
  if (lonSpanDeg >= 5) return '30s';
  return '15s';
}

/**
 * Compute a "nice" scale-bar length: a 1, 2 or 5 × 10^n km value close to
 * one quarter of the region width at the centre latitude (great-circle:
 * 111.32 km/° × cos(lat) × lonSpan / 4).
 *
 * @param {number} lonSpanDeg - Longitude span in degrees.
 * @param {number} centerLatDeg - Centre latitude in degrees.
 * @returns {number} Scale-bar length in km (>= smallest representable nice
 *   value; falls back to 1 near the poles where cos(lat) → 0).
 */
function niceScaleKm(lonSpanDeg, centerLatDeg) {
  const raw = (111.32 * Math.cos((centerLatDeg * Math.PI) / 180) * lonSpanDeg) / 4;
  if (!(raw > 0)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exp;
  const nice = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10;
  return nice * 10 ** exp;
}

/**
 * Build the shared header comment block (identity, journal target,
 * projection, citations, data-access date) followed by an install hint.
 *
 * @param {FigureState} state - The figure state.
 * @param {string} installHint - Full install-hint comment line(s), pre-prefixed.
 * @returns {string[]} Header lines including the closing rule.
 */
function headerLines(state, installHint) {
  const { journal, projection } = state;
  const fmt = String(journal.format || 'pdf');
  const lines = [
    RULE,
    '# Reproducible marine map figure — generated by Marine Map Tool',
    '#',
    `# Journal target : ${oneLine(journal.title ?? 'Generic (no journal)')}`,
    `#   width ${num(journal.widthMm)} mm | ${num(journal.dpi)} dpi | ${fmt.toUpperCase()}`,
    `# Projection     : ${oneLine(projection.name ?? projection.id ?? 'unspecified')}`,
  ];
  if (projection.note) lines.push(...wrapComment(projection.note));
  const citations = Array.isArray(state.citations) ? state.citations : [];
  if (citations.length > 0) {
    lines.push('#', '# Cite the data and colormaps used in this figure:');
    for (const c of citations) lines.push(...wrapComment(c));
  }
  if (state.accessedDate) {
    lines.push(`# Data accessed  : ${oneLine(state.accessedDate)}`);
  }
  lines.push('#', installHint, RULE);
  return lines;
}

/* ---------------------------------------------------------------- exports -- */

/**
 * Generate a runnable PyGMT (Python 3) script that reproduces the figure
 * described by `state` at publication quality.
 *
 * The emitted script is self-documenting: a header comment block records the
 * journal target, the projection choice and the data citations, so the
 * provenance travels with the code. Bathymetry comes from GMT's remote
 * earth-relief grids at a resolution matched to the region size; the
 * colormap is referenced by its cmocean name (GMT >= 6 ships them natively).
 *
 * @param {FigureState} state - Complete figure description (see typedef).
 * @returns {string} The Python script text (UTF-8, trailing newline). Always
 *   valid Python 3 syntax; deterministic for a given state.
 * @throws {TypeError|RangeError} If the state is malformed (see message).
 */
export function generatePyGMT(state) {
  checkState(state, 'generatePyGMT');

  const { region, projection, journal, depthRange } = state;
  const furniture = isObject(state.furniture) ? state.furniture : {};
  const geo = deriveGeometry(region);

  const widthCm = Math.round((journal.widthMm / 10) * 100) / 100;
  const projValue = projection.gmt.replace(/^-J/, '').replaceAll('WIDTH', `${num(widthCm)}c`);
  const resolution = reliefResolution(geo.lonSpan);
  const fmt = String(journal.format || 'pdf').toLowerCase();
  const labelFont = `${num(journal.minFontPt ?? 7)}p,Helvetica,black`;

  const stations =
    isObject(state.stations) &&
    Array.isArray(state.stations.rows) &&
    state.stations.rows.length > 0
      ? state.stations
      : null;
  const contours =
    isObject(state.contours) && isFiniteNumber(state.contours.interval)
      ? state.contours
      : null;

  const L = ['#!/usr/bin/env python3'];
  L.push(
    ...headerLines(state, '# pip install pygmt  (or conda install -c conda-forge pygmt)'),
  );

  L.push('');
  L.push('import pygmt');

  L.push('');
  L.push('# Region of interest (degrees, WGS84) in GMT order: [west, east, south, north].');
  L.push(
    `region = [${num(region.west)}, ${num(region.east)}, ` +
      `${num(region.south)}, ${num(region.north)}]`,
  );

  L.push('');
  L.push(`# Physical width from the journal target: ${num(journal.widthMm)} mm = ${num(widthCm)} cm.`);
  L.push('# GMT -J projection value (PyGMT takes it without the "-J" prefix).');
  L.push(`projection = ${pyStr(projValue)}`);

  L.push('');
  L.push(`# Earth relief resolution chosen from the ${num(geo.lonSpan)}° longitude span.`);
  L.push(`grid = pygmt.datasets.load_earth_relief(resolution=${pyStr(resolution)}, region=region)`);

  L.push('');
  L.push('fig = pygmt.Figure()');

  L.push('');
  L.push('# GMT >= 6 ships the cmocean colormaps natively, so the name resolves directly.');
  L.push('# The on-screen tool maps colormap position 0 to the SHALLOW end, but the CPT');
  L.push('# series here runs over elevation (deep = minimum), so the direction flag is');
  L.push('# inverted relative to the on-screen "reverse" toggle.');
  const cptArgs = [
    `cmap=${pyStr(state.colormap)}`,
    `series=[${num(depthRange.min)}, ${num(depthRange.max)}]`,
  ];
  if (!state.reverse) cptArgs.push('reverse=True');
  L.push(`pygmt.makecpt(${cptArgs.join(', ')})`);

  L.push('');
  L.push('fig.grdimage(');
  L.push('    grid=grid,');
  L.push('    cmap=True,');
  L.push('    region=region,');
  L.push('    projection=projection,');
  if (state.hillshade) L.push(`    shading=${pyStr('+a315+nt0.6')},`);
  L.push(')');

  L.push('');
  L.push('# Coastlines and land fill AFTER grdimage so land masks the offshore relief.');
  L.push(`fig.coast(shorelines=${pyStr('1/0.25p,gray30')}, land=${pyStr('#e8e5e0')})`);

  if (contours) {
    L.push('');
    L.push(
      `# Depth contours every ${num(contours.interval)} m, ` +
        `annotated every ${num(contours.annotInterval)} m (seafloor only).`,
    );
    L.push('fig.grdcontour(');
    L.push('    grid=grid,');
    L.push(`    levels=${num(contours.interval)},`);
    L.push(`    annotation=${num(contours.annotInterval)},`);
    L.push(`    limit=[${num(depthRange.min)}, 0],`);
    L.push(`    pen=${pyStr('0.25p,gray40')},`);
    L.push(')');
  }

  if (stations) {
    const symbolCm = ((stations.symbolMm ?? 2.5) / 10).toFixed(2);
    L.push('');
    L.push(`# Stations (${stations.rows.length}); symbol diameter ${num(stations.symbolMm ?? 2.5)} mm.`);
    L.push(`station_lons = [${stations.rows.map((r) => num(r.lon)).join(', ')}]`);
    L.push(`station_lats = [${stations.rows.map((r) => num(r.lat)).join(', ')}]`);
    if (stations.label) {
      L.push(`station_names = [${stations.rows.map((r) => pyStr(r.name ?? '')).join(', ')}]`);
    }
    L.push('fig.plot(');
    L.push('    x=station_lons,');
    L.push('    y=station_lats,');
    L.push(`    style=${pyStr(`c${symbolCm}c`)},`);
    L.push(`    fill=${pyStr(stations.color ?? '#e4572e')},`);
    L.push(`    pen=${pyStr('0.5p,black')},`);
    L.push(')');
    if (stations.label) {
      L.push('for lon, lat, name in zip(station_lons, station_lats, station_names):');
      L.push(
        '    fig.text(x=lon, y=lat, text=name, justify="LM", ' +
          `offset="0.25c/0c", font=${pyStr(labelFont)})`,
      );
    }
  }

  const grat =
    isFiniteNumber(furniture.graticuleDeg) && furniture.graticuleDeg > 0
      ? num(furniture.graticuleDeg)
      : '';
  const edges = state.title ? `WSen+t"${oneLine(state.title)}"` : 'WSen';
  L.push('');
  L.push(grat ? `# Frame with ${grat}° graticule annotations.` : '# Frame (auto graticule).');
  L.push(`fig.basemap(frame=[${pyStr(`xa${grat}f`)}, ${pyStr(`ya${grat}f`)}, ${pyStr(edges)}])`);

  if (furniture.scaleBar) {
    const km = niceScaleKm(geo.lonSpan, geo.centerLat);
    L.push('');
    L.push(
      `# Scale bar: ~1/4 of the region width at the centre latitude, rounded to ${num(km)} km.`,
    );
    L.push(`fig.basemap(map_scale=${pyStr(`jBL+w${num(km)}k+o0.4c/0.4c+f+lkm`)})`);
  }

  if (furniture.northArrow) {
    L.push('');
    L.push('# North arrow.');
    L.push(`fig.basemap(rose=${pyStr('jTR+w1.1c+o0.3c')})`);
  }

  L.push('');
  L.push(`fig.colorbar(frame=${pyStr('xaf+l"Elevation (m)"')})`);

  if (furniture.inset) {
    const ring = [
      [region.west, region.south],
      [region.east, region.south],
      [region.east, region.north],
      [region.west, region.north],
      [region.west, region.south],
    ];
    L.push('');
    L.push('# Global-overview inset with the mapped region outlined in red.');
    L.push(`with fig.inset(position=${pyStr('jTL+w3.2c+o0.25c')}, box=${pyStr('+gwhite+p0.5p')}):`);
    L.push(
      '    fig.coast(region="g", ' +
        `projection=${pyStr(`G${deg1(geo.centerLon)}/${deg1(geo.centerLat)}/3.2c`)}, ` +
        'land="gray80", water="white")',
    );
    L.push('    fig.plot(');
    L.push('        data=[');
    for (const [lon, lat] of ring) L.push(`            [${num(lon)}, ${num(lat)}],`);
    L.push('        ],');
    L.push(`        pen=${pyStr('1p,red')},`);
    L.push('    )');
  }

  L.push('');
  L.push(
    `# Final physical width: ${num(journal.widthMm)} mm (${num(widthCm)} cm) ` +
      `at ${num(journal.dpi)} dpi.`,
  );
  L.push(`fig.savefig(${pyStr(`marine_map.${fmt}`)}, dpi=${num(journal.dpi)})`);

  return `${L.join('\n')}\n`;
}
