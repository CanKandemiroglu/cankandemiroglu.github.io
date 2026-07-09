/**
 * rscript.js — reproducible R script generation.
 *
 * Companion to pygmt.js: given the same FigureState shape (documented as the
 * `FigureState` typedef in pygmt.js), emit a runnable R script that
 * reproduces the on-screen figure with the ggplot2 stack (terra + sf +
 * ggplot2 + cmocean + rnaturalearth + ggspatial). The GPL-licensed `marmap`
 * package is deliberately NOT used.
 *
 * Honesty note baked into the output: this R stack draws in plate carrée
 * (unprojected WGS84 lon/lat) via `coord_sf()`. The suggested map projection
 * is recorded as a comment, and users are pointed at the companion PyGMT
 * script when they need the figure rendered in that projection.
 *
 * Bathymetry comes from the NOAA ERDDAP griddap service as an ETOPO 2022
 * netCDF subset, so the script has no binary payload and stays reproducible.
 *
 * Everything here is deterministic string building: the same state always
 * yields byte-identical output. No I/O, no clock, no randomness, no DOM.
 */

/** Column at which wrapped header comments break. */
const WRAP_COL = 78;

/** Horizontal rule used to delimit the header comment block. */
const RULE = `# ${'='.repeat(WRAP_COL - 2)}`;

/** ERDDAP griddap dataset URL for the ETOPO 2022 15 arc-second relief grid. */
const ERDDAP_BASE = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.nc';

/** File formats ggsave() writes reliably with this stack. */
const GGSAVE_FORMATS = new Set(['png', 'pdf', 'tiff']);

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
 * Quote a value as an R double-quoted string literal, escaping backslashes,
 * double quotes and newlines. Apostrophes need no escaping inside double
 * quotes, which keeps names like "L'Atalante" readable.
 *
 * @param {*} s - Value to stringify and quote.
 * @returns {string} A valid R string literal including the quotes.
 */
function rStr(s) {
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
 * @returns {string[]} Zero or more comment lines.
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
 * Validate the parts of a FigureState this generator relies on. Mirrors the
 * checks in pygmt.js so both generators reject the same malformed inputs.
 *
 * @param {object} state - The state to check (FigureState shape).
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
 * First multiple of `step` at or above `from` (used for graticule breaks).
 *
 * @param {number} from - Lower bound.
 * @param {number} step - Positive step.
 * @returns {number} The first multiple.
 */
function firstMultiple(from, step) {
  return Math.ceil(from / step) * step;
}

/**
 * Last multiple of `step` at or below `to` (used for graticule breaks).
 *
 * @param {number} to - Upper bound.
 * @param {number} step - Positive step.
 * @returns {number} The last multiple.
 */
function lastMultiple(to, step) {
  return Math.floor(to / step) * step;
}

/* ---------------------------------------------------------------- exports -- */

/**
 * Generate a runnable R script (ggplot2 stack) that reproduces the figure
 * described by `state`.
 *
 * The script downloads an ETOPO 2022 netCDF subset from NOAA ERDDAP (slice
 * order `z[(south):(north)][(west):(east)]`), rasterises it with terra,
 * and renders bathymetry, contours, land, stations and cartographic
 * furniture with ggplot2 + ggspatial. The cmocean colormap is taken from the
 * CRAN `cmocean` package, so colours match the PyGMT output.
 *
 * Output format: 'png', 'pdf' and 'tiff' pass straight to `ggsave()`;
 * anything else (e.g. 'eps', 'ai') falls back to PDF with an explanatory
 * comment, because this stack cannot write those formats reliably.
 *
 * @param {import('./pygmt.js').FigureState} state - Complete figure
 *   description (same shape as for generatePyGMT; see the typedef in
 *   pygmt.js).
 * @returns {string} The R script text (UTF-8, trailing newline);
 *   deterministic for a given state.
 * @throws {TypeError|RangeError} If the state is malformed (see message).
 */
export function generateRScript(state) {
  checkState(state, 'generateRScript');

  const { region, projection, journal, depthRange } = state;
  const furniture = isObject(state.furniture) ? state.furniture : {};
  const minFontPt = isFiniteNumber(journal.minFontPt) ? journal.minFontPt : 7;

  const requestedFormat = String(journal.format || 'pdf').toLowerCase();
  const format = GGSAVE_FORMATS.has(requestedFormat) ? requestedFormat : 'pdf';

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

  const L = ['#!/usr/bin/env Rscript'];

  /* Header ------------------------------------------------------------- */
  L.push(RULE);
  L.push('# Reproducible marine map figure — generated by Marine Map Tool');
  L.push('#');
  L.push(`# Journal target : ${oneLine(journal.title ?? 'Generic (no journal)')}`);
  L.push(
    `#   width ${num(journal.widthMm)} mm | ${num(journal.dpi)} dpi | ` +
      `${requestedFormat.toUpperCase()}`,
  );
  L.push(`# Suggested projection : ${oneLine(projection.name ?? projection.id ?? 'unspecified')}`);
  if (projection.note) L.push(...wrapComment(projection.note));
  L.push('#');
  L.push('# NOTE: coord_sf() below draws in plate carrée (unprojected WGS84 lon/lat).');
  L.push('#       To render the figure in the suggested projection above, use the');
  L.push('#       companion PyGMT script exported alongside this one.');
  const citations = Array.isArray(state.citations) ? state.citations : [];
  if (citations.length > 0) {
    L.push('#', '# Cite the data and colormaps used in this figure:');
    for (const c of citations) L.push(...wrapComment(c));
  }
  if (state.accessedDate) L.push(`# Data accessed  : ${oneLine(state.accessedDate)}`);
  L.push('#');
  L.push('# install.packages(c("terra", "sf", "ggplot2", "cmocean",');
  L.push('#                    "rnaturalearth", "rnaturalearthdata", "ggspatial"))');
  L.push(RULE);

  /* Data --------------------------------------------------------------- */
  L.push('');
  L.push('library(terra)');
  L.push('library(sf)');
  L.push('library(ggplot2)');
  L.push('library(ggspatial)');

  L.push('');
  L.push('# --- Bathymetry: ETOPO 2022 (15 arc-second) subset from NOAA ERDDAP ---------');
  L.push('# griddap slice order is z[(south):stride:(north)][(west):stride:(east)].');
  // ETOPO 2022 has 240 cells/degree; stride the request so the downloaded
  // grid stays near ~2400 columns (a full 15" pull of a wide region would be
  // hundreds of MB to GB).
  const lonCells = (region.east - region.west) * 240;
  const stride = Math.max(1, Math.ceil(lonCells / 2400));
  L.push(`# stride ${stride} keeps the grid ≈${Math.round(lonCells / stride)} columns wide (raise for more detail).`);
  L.push('bathy_url <- paste0(');
  L.push(`  ${rStr(ERDDAP_BASE)},`);
  L.push(
    `  ${rStr(
      `?z%5B(${num(region.south)}):${stride}:(${num(region.north)})%5D` +
        `%5B(${num(region.west)}):${stride}:(${num(region.east)})%5D`,
    )}`,
  );
  L.push(')');
  L.push('download.file(bathy_url, destfile = "bathy.nc", mode = "wb")');
  L.push('');
  L.push('bathy <- terra::rast("bathy.nc")');
  L.push('bathy_df <- as.data.frame(bathy, xy = TRUE)');
  L.push('names(bathy_df) <- c("lon", "lat", "z")');

  L.push('');
  L.push('# Land polygons (Natural Earth, medium scale) drawn over the raster so land');
  L.push('# masks the offshore relief.');
  L.push('land <- rnaturalearth::ne_countries(scale = "medium", returnclass = "sf")');

  if (stations) {
    L.push('');
    L.push(`# Stations (${stations.rows.length}).`);
    L.push('stations <- data.frame(');
    L.push(`  lon = c(${stations.rows.map((r) => num(r.lon)).join(', ')}),`);
    L.push(`  lat = c(${stations.rows.map((r) => num(r.lat)).join(', ')}),`);
    L.push(`  name = c(${stations.rows.map((r) => rStr(r.name ?? '')).join(', ')}),`);
    L.push(
      `  value = c(${stations.rows
        .map((r) => (isFiniteNumber(r.value) ? num(r.value) : 'NA'))
        .join(', ')})`,
    );
    L.push(')');
  }

  /* Plot --------------------------------------------------------------- */
  const parts = [];
  parts.push('ggplot()');
  parts.push('geom_raster(data = bathy_df, aes(x = lon, y = lat, fill = z))');
  parts.push(
    [
      `# cmocean ${rStr(state.colormap)} — the same perceptually uniform colormap as`,
      '  # the on-screen preview. The fill axis is elevation (deep = minimum), so the',
      '  # direction is inverted relative to the on-screen "reverse" toggle.',
      '  scale_fill_gradientn(',
      `    colours = cmocean::cmocean(${rStr(state.colormap)}, direction = ${
        state.reverse ? 1 : -1
      })(256),`,
      `    limits = c(${num(depthRange.min)}, ${num(depthRange.max)}),`,
      '    oob = scales::squish,',
      '    name = "Elevation (m)"',
      '  )',
    ].join('\n'),
  );

  if (contours) {
    parts.push(
      [
        'geom_contour(',
        '    data = bathy_df,',
        '    aes(x = lon, y = lat, z = z),',
        `    breaks = seq(${num(depthRange.min)}, 0, by = ${num(contours.interval)}),`,
        '    colour = "gray40",',
        '    linewidth = 0.2',
        '  )',
      ].join('\n'),
    );
  }

  parts.push('geom_sf(data = land, fill = "#e8e5e0", colour = "gray30", linewidth = 0.2)');

  if (stations) {
    parts.push(
      [
        'geom_point(',
        '    data = stations,',
        '    aes(x = lon, y = lat),',
        '    shape = 21,',
        `    size = ${num(stations.symbolMm ?? 2.5)},  # symbol diameter in mm`,
        `    fill = ${rStr(stations.color ?? '#e4572e')},`,
        '    colour = "black",',
        '    stroke = 0.4',
        '  )',
      ].join('\n'),
    );
    if (stations.label) {
      parts.push(
        [
          'geom_text(',
          '    data = stations,',
          '    aes(x = lon, y = lat, label = name),',
          '    hjust = -0.3,',
          `    size = ${num(minFontPt)} / .pt,  # ${num(minFontPt)} pt labels`,
          '    family = "Helvetica"',
          '  )',
        ].join('\n'),
      );
    }
  }

  const grat = furniture.graticuleDeg;
  if (isFiniteNumber(grat) && grat > 0) {
    const x0 = firstMultiple(region.west, grat);
    const x1 = lastMultiple(region.east, grat);
    const y0 = firstMultiple(region.south, grat);
    const y1 = lastMultiple(region.north, grat);
    if (x0 <= x1 && y0 <= y1) {
      parts.push(
        `# ${num(grat)}° graticule.\n` +
          `  scale_x_continuous(breaks = seq(${num(x0)}, ${num(x1)}, by = ${num(grat)}))`,
      );
      parts.push(`scale_y_continuous(breaks = seq(${num(y0)}, ${num(y1)}, by = ${num(grat)}))`);
    }
  }

  if (furniture.scaleBar) {
    parts.push('annotation_scale(location = "bl")');
  }
  if (furniture.northArrow) {
    parts.push(
      'annotation_north_arrow(\n' +
        '    location = "tr",\n' +
        '    height = unit(0.9, "cm"),\n' +
        '    width = unit(0.9, "cm")\n' +
        '  )',
    );
  }

  parts.push(
    [
      '# Plate carrée frame; see the header for the suggested projection.',
      '  coord_sf(',
      `    xlim = c(${num(region.west)}, ${num(region.east)}),`,
      `    ylim = c(${num(region.south)}, ${num(region.north)}),`,
      '    expand = FALSE,',
      '    crs = sf::st_crs(4326)',
      '  )',
    ].join('\n'),
  );

  if (state.title) {
    parts.push(`labs(title = ${rStr(oneLine(state.title))})`);
  }
  parts.push(
    `theme_minimal(base_size = ${num(minFontPt + 1)}, base_family = "Helvetica")`,
  );

  L.push('');
  L.push(`p <- ${parts.join(' +\n  ')}`);

  /* Save --------------------------------------------------------------- */
  L.push('');
  if (format !== requestedFormat) {
    L.push(
      `# Requested format "${requestedFormat}" cannot be written reliably by ggsave()`,
    );
    L.push('# with this stack; writing PDF instead (convert downstream if needed).');
  }
  L.push(`# Final physical width: ${num(journal.widthMm)} mm at ${num(journal.dpi)} dpi.`);
  L.push(
    `ggsave(${rStr(`marine_map.${format}`)}, plot = p, ` +
      `width = ${num(journal.widthMm)}, units = "mm", dpi = ${num(journal.dpi)})`,
  );

  return `${L.join('\n')}\n`;
}
