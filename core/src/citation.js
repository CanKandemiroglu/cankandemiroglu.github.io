/**
 * citation.js — the "How to cite" engine and attribution registry.
 *
 * Every export the Marine Map Tool produces embeds correct data citations so
 * that users stay licence-compliant and credit propagates with the figure.
 * This module is the single source of truth for those citations:
 *
 *   - {@link DATA_SOURCES}: one registry entry per data source / software
 *     dependency (bathymetry grids, basemap data, colormaps, script targets).
 *   - {@link buildCitationText}: the plain-text "How to cite this figure" box.
 *   - {@link buildBibTeX}: concatenated BibTeX for reference managers.
 *   - {@link attributionLine}: the short one-line credit for a map corner.
 *
 * The registry is mirrored verbatim in data/attrib/attributions.json (as
 * {"sources": [...]} in the same order); a test asserts deep equality between
 * the two so they cannot drift. If you edit an entry here, regenerate the JSON:
 *
 *   node -e "import('./src/citation.js').then(m => process.stdout.write(
 *     JSON.stringify({ sources: Object.values(m.DATA_SOURCES) }, null, 2) + '\n'
 *   ))" > ../data/attrib/attributions.json
 *
 * Everything is a pure function of its inputs — no I/O, no clock — matching
 * the rest of marine-map-core.
 */

/**
 * Placeholder token embedded in the tool's citation and BibTeX strings.
 * Replaced with the running tool version by {@link buildCitationText} and
 * {@link buildBibTeX}.
 * @type {string}
 */
const VERSION_PLACEHOLDER = '{version}';

/** Header line of the plain-text citation block. */
const CITATION_HEADER = 'How to cite this figure';

/**
 * Registry of every citable data source and software dependency.
 *
 * Keyed by source id. Each entry is:
 * {
 *   id:          string        — stable identifier (same as the key),
 *   name:        string        — human-readable source name,
 *   licence:     string        — licence / terms summary,
 *   url:         string        — canonical landing page,
 *   doi:         string|null   — DOI (bare, no resolver prefix) when one exists,
 *   citation:    string        — one-line plain-text citation,
 *   bibtex:      string|null   — BibTeX entry, or null when no canonical entry
 *                                exists (see `note` for what to cite instead),
 *   attribution: string        — very short credit for a map corner,
 *   note:        string|null   — caveats, incl. VERIFY items to check before
 *                                a layer ships.
 * }
 *
 * The tool's own entry ('tool') carries a '{version}' placeholder in its
 * citation and bibtex; the builder functions substitute the running version.
 *
 * Deep-frozen: treat as immutable.
 * @type {Readonly<Object<string, object>>}
 */
export const DATA_SOURCES = deepFreeze({
  tool: {
    id: 'tool',
    name: 'Marine Map Tool',
    licence: 'MIT',
    url: 'https://osmancankandemiroglu.com/app/',
    doi: null,
    citation:
      'Kandemiroglu, O.C. (2026). Marine Map Tool (v{version}). ' +
      'https://osmancankandemiroglu.com/app/ — DOI pending (Zenodo, see CITATION.cff).',
    bibtex:
      '@software{kandemiroglu_marine_map_tool,\n' +
      '  author  = {Kandemiroglu, Osman Can},\n' +
      '  title   = {Marine Map Tool},\n' +
      '  version = {{version}},\n' +
      '  year    = {2026},\n' +
      '  url     = {https://osmancankandemiroglu.com/app/},\n' +
      '  note    = {DOI pending (Zenodo, see CITATION.cff)}\n' +
      '}',
    attribution: 'Marine Map Tool',
    note:
      'DOI pending — mint a version-specific DOI via Zenodo on the first ' +
      'tagged release (see CITATION.cff), then update this entry.',
  },

  terrainTiles: {
    id: 'terrainTiles',
    name: 'Terrain Tiles on AWS Open Data',
    licence: 'Public domain sources / Mapzen attribution requested',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    doi: null,
    citation:
      'Terrain Tiles on AWS Open Data (Mapzen/Linux Foundation). DEM sources ' +
      'include ETOPO1 (NOAA), SRTM (NASA), GMTED2010 (USGS), and others. ' +
      'https://registry.opendata.aws/terrain-tiles/',
    bibtex: null,
    attribution: 'Bathymetry: Terrain Tiles (Mapzen/AWS)',
    note:
      'Composite of public-domain DEMs; the underlying source varies by ' +
      'location and zoom level.',
  },

  etopo2022: {
    id: 'etopo2022',
    name: 'ETOPO 2022 15 Arc-Second Global Relief Model',
    licence: 'Public domain (U.S. Government work)',
    url: 'https://www.ncei.noaa.gov/products/etopo-global-relief-model',
    doi: '10.25921/fd45-gt74',
    citation:
      'NOAA National Centers for Environmental Information (2022): ETOPO 2022 ' +
      '15 Arc-Second Global Relief Model. NOAA NCEI. ' +
      'https://doi.org/10.25921/fd45-gt74',
    bibtex:
      '@misc{etopo2022,\n' +
      '  author    = {{NOAA National Centers for Environmental Information}},\n' +
      '  title     = {ETOPO 2022 15 Arc-Second Global Relief Model},\n' +
      '  year      = {2022},\n' +
      '  publisher = {NOAA NCEI},\n' +
      '  doi       = {10.25921/fd45-gt74},\n' +
      '  url       = {https://doi.org/10.25921/fd45-gt74}\n' +
      '}',
    attribution: 'Bathymetry: ETOPO 2022 (NOAA)',
    note: null,
  },

  gebco: {
    id: 'gebco',
    name: 'GEBCO 2024 Grid',
    licence: 'Public domain',
    url: 'https://www.gebco.net/',
    doi: '10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f',
    citation:
      'GEBCO Compilation Group (2024): GEBCO 2024 Grid. ' +
      'https://doi.org/10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f',
    bibtex:
      '@misc{gebco2024,\n' +
      '  author = {{GEBCO Compilation Group}},\n' +
      '  title  = {GEBCO 2024 Grid},\n' +
      '  year   = {2024},\n' +
      '  doi    = {10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f},\n' +
      '  url    = {https://doi.org/10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f}\n' +
      '}',
    attribution: 'Bathymetry: GEBCO 2024',
    note:
      'VERIFY current grid release before shipping — GEBCO issues a new grid ' +
      'most years.',
  },

  naturalEarth: {
    id: 'naturalEarth',
    name: 'Natural Earth',
    licence: 'Public domain',
    url: 'https://www.naturalearthdata.com/',
    doi: null,
    citation:
      'Natural Earth. Free vector and raster map data. ' +
      'https://www.naturalearthdata.com/ (public domain).',
    bibtex: null,
    attribution: 'Made with Natural Earth',
    note: 'No attribution legally required; credit appreciated.',
  },

  cmocean: {
    id: 'cmocean',
    name: 'cmocean colormaps',
    licence: 'MIT',
    url: 'https://matplotlib.org/cmocean/',
    doi: '10.5670/oceanog.2016.66',
    citation:
      'Thyng, K.M., Greene, C.A., Hetland, R.D., Zimmerle, H.M., & DiMarco, ' +
      'S.F. (2016). True colors of oceanography: Guidelines for effective and ' +
      'accurate colormap selection. Oceanography 29(3):9-13. ' +
      'https://doi.org/10.5670/oceanog.2016.66',
    bibtex:
      '@article{thyng2016truecolors,\n' +
      '  author  = {Thyng, Kristen M. and Greene, Chad A. and Hetland, ' +
      'Robert D. and Zimmerle, Heather M. and DiMarco, Steven F.},\n' +
      '  title   = {True colors of oceanography: Guidelines for effective ' +
      'and accurate colormap selection},\n' +
      '  journal = {Oceanography},\n' +
      '  volume  = {29},\n' +
      '  number  = {3},\n' +
      '  pages   = {9--13},\n' +
      '  year    = {2016},\n' +
      '  doi     = {10.5670/oceanog.2016.66}\n' +
      '}',
    attribution: 'cmocean colormaps (Thyng et al. 2016)',
    note: null,
  },

  emodnet: {
    id: 'emodnet',
    name: 'EMODnet Digital Bathymetry (DTM)',
    licence: 'CC-BY 4.0',
    url: 'https://emodnet.ec.europa.eu/en/bathymetry',
    doi: null,
    citation:
      'EMODnet Bathymetry Consortium: EMODnet Digital Bathymetry (DTM). ' +
      'https://emodnet.ec.europa.eu/en/bathymetry',
    bibtex: null,
    attribution: 'Bathymetry: EMODnet DTM',
    note:
      'VERIFY the DTM release year + DOI when the EMODnet layer ships ' +
      '(Phase 3).',
  },

  marineRegions: {
    id: 'marineRegions',
    name: 'MarineRegions.org',
    licence: 'CC-BY 4.0',
    url: 'https://www.marineregions.org/',
    doi: null,
    citation:
      'Flanders Marine Institute — MarineRegions.org (EEZ/IHO products). ' +
      'https://www.marineregions.org/',
    bibtex: null,
    attribution: 'Boundaries: MarineRegions.org',
    note: 'Phase 3 overlay; per-product citation required when used.',
  },

  gmt: {
    id: 'gmt',
    name: 'Generic Mapping Tools (GMT)',
    licence: 'LGPL-3.0-or-later',
    url: 'https://www.generic-mapping-tools.org/',
    doi: '10.1029/2019GC008515',
    citation:
      'Wessel, P., et al. (2019). The Generic Mapping Tools version 6. ' +
      'Geochemistry, Geophysics, Geosystems, 20, 5556-5564. ' +
      'https://doi.org/10.1029/2019GC008515',
    bibtex:
      '@article{wessel2019gmt6,\n' +
      '  author  = {Wessel, Paul and Luis, Joaquim F. and Uieda, Leonardo ' +
      'and Scharroo, Remko and Wobbe, Florian and Smith, Walter H. F. and ' +
      'Tian, Dongdong},\n' +
      '  title   = {The Generic Mapping Tools version 6},\n' +
      '  journal = {Geochemistry, Geophysics, Geosystems},\n' +
      '  volume  = {20},\n' +
      '  pages   = {5556--5564},\n' +
      '  year    = {2019},\n' +
      '  doi     = {10.1029/2019GC008515}\n' +
      '}',
    attribution: 'GMT 6',
    note: null,
  },

  pygmt: {
    id: 'pygmt',
    name: 'PyGMT',
    licence: 'BSD-3-Clause',
    url: 'https://www.pygmt.org/',
    doi: null,
    citation:
      'Uieda, L., et al. PyGMT: A Python interface for the Generic Mapping ' +
      'Tools. https://www.pygmt.org/',
    bibtex: null,
    attribution: 'PyGMT',
    note:
      'Cite the version-specific Zenodo DOI of the PyGMT release you run ' +
      '(see pygmt.org).',
  },
});

/**
 * Build the plain-text "How to cite this figure" block.
 *
 * Layout: the header line, a blank line, the tool's own citation (with
 * `toolVersion` substituted for the '{version}' placeholder), one line per
 * requested source in the given order, and — when `accessedDate` is provided —
 * a trailing 'Data accessed {accessedDate}.' line.
 *
 * Unknown source ids are skipped silently. 'tool' is skipped inside the list
 * because the tool citation always leads the block.
 *
 * @param {object} opts - Options.
 * @param {string[]} [opts.sources=[]] - Source ids from {@link DATA_SOURCES},
 *   in the order they should appear.
 * @param {string|null} [opts.accessedDate=null] - Access date to record,
 *   e.g. '2026-07-05'. Omitted from the output when null/empty.
 * @param {string} [opts.toolVersion='0.1.0'] - Version substituted into the
 *   tool citation.
 * @returns {string} Multi-line plain-text citation block.
 */
export function buildCitationText({ sources = [], accessedDate = null, toolVersion = '0.1.0' } = {}) {
  const lines = [CITATION_HEADER, ''];
  lines.push(substituteVersion(DATA_SOURCES.tool.citation, toolVersion));

  for (const src of resolveSources(sources)) {
    if (src.id === 'tool') continue; // always emitted first, never repeated
    lines.push(src.citation);
  }

  if (typeof accessedDate === 'string' && accessedDate.trim().length > 0) {
    lines.push(`Data accessed ${accessedDate}.`);
  }

  return lines.join('\n');
}

/**
 * Build a BibTeX bibliography for the figure.
 *
 * The tool's @software entry comes first (with `toolVersion` substituted for
 * the '{version}' placeholder), followed by the BibTeX of each requested
 * source in the given order. Sources with `bibtex: null` and unknown ids are
 * skipped silently; 'tool' inside the list is skipped to avoid duplication.
 * Entries are separated by blank lines.
 *
 * @param {object} opts - Options.
 * @param {string[]} [opts.sources=[]] - Source ids from {@link DATA_SOURCES},
 *   in the order their entries should appear.
 * @param {string} [opts.toolVersion='0.1.0'] - Version substituted into the
 *   tool's @software entry.
 * @returns {string} Concatenated BibTeX entries.
 */
export function buildBibTeX({ sources = [], toolVersion = '0.1.0' } = {}) {
  const entries = [substituteVersion(DATA_SOURCES.tool.bibtex, toolVersion)];

  for (const src of resolveSources(sources)) {
    if (src.id === 'tool' || src.bibtex === null) continue;
    entries.push(src.bibtex);
  }

  return entries.join('\n\n');
}

/**
 * Build the short one-line credit for a map corner.
 *
 * Joins each requested source's `attribution` (falling back to `name` when no
 * short attribution is set) with ' · '. Unknown ids are skipped silently.
 *
 * @param {string[]} sources - Source ids from {@link DATA_SOURCES}, in the
 *   order they should appear.
 * @returns {string} e.g. 'Bathymetry: GEBCO 2024 · Made with Natural Earth'.
 */
export function attributionLine(sources) {
  return resolveSources(sources)
    .map((src) => src.attribution || src.name)
    .join(' · ');
}

/* ---------------------------------------------------------------- helpers -- */

/**
 * Map an array of source ids to registry entries, silently dropping ids that
 * are not in {@link DATA_SOURCES}.
 * @param {string[]} sources - Source ids (a non-array yields []).
 * @returns {object[]} Matching registry entries, in input order.
 */
function resolveSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((id) => DATA_SOURCES[id]).filter((src) => src !== undefined);
}

/**
 * Replace every '{version}' placeholder in `text` with `version`.
 * @param {string} text - Text containing zero or more placeholders.
 * @param {string} version - Version string to substitute.
 * @returns {string} Text with placeholders substituted.
 */
function substituteVersion(text, version) {
  return text.replaceAll(VERSION_PLACEHOLDER, String(version));
}

/**
 * Recursively freeze an object (and any nested objects) in place.
 * @param {object} obj - Object to freeze.
 * @returns {object} The same object, deep-frozen.
 */
function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}
