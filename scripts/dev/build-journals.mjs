#!/usr/bin/env node
/**
 * build-journals.mjs — generate the Phase-3 batch of marine/earth-science
 * journal figure-spec records and refresh data/journals/index.json.
 *
 *   node scripts/dev/build-journals.mjs
 *
 * The nine Phase-1 records are hand-authored and are NOT touched here; this
 * script only (re)writes the records listed in TABLE below and rebuilds
 * index.json to list every *.json in the directory in a stable order.
 *
 * Every value here is an approximate default transcribed from the publisher's
 * artwork guidelines and carries last_verified: "VERIFY-BEFORE-SHIP" — the
 * engine surfaces that as an "unverified spec" warning until each record is
 * checked against the journal's current guidelines (see the ship checklist).
 */
import { writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/journals');

// Compact publisher-family templates. dpi = {photo, combination, line}.
const ELSEVIER = {
  publisher: 'Elsevier',
  canvas: { single: 90, double: 190, height: 240 },
  dpi: { photo: 300, combination: 500, line: 1000 },
  map: ['pdf', 500], formats: ['tiff', 'eps', 'pdf'], colour: 'RGB or CMYK', font: 7,
  note: 'Elsevier artwork: line 1000 dpi, combination (halftone + line, e.g. a map) 500 dpi, photo 300 dpi. Single column ~90 mm, double column ~190 mm. Colour figures may be requested in CMYK — cmocean is RGB-defined, so export RGB and check the CMYK proof.',
  url: 'https://www.elsevier.com/authors/policies-and-guidelines/artwork-and-media-instructions',
};
const COPERNICUS = {
  publisher: 'Copernicus Publications (on behalf of EGU)',
  canvas: { single: 83, double: 170, height: 230 },
  dpi: { photo: 300, combination: 600, line: 1200 },
  map: ['pdf', 600], formats: ['pdf', 'eps'], colour: 'RGB', font: 7,
  note: 'Copernicus prefers vector graphics (PDF/EPS) with embedded fonts; raster only where unavoidable (photos 300 dpi, maps/combination 600 dpi). Single column ~83 mm, double column ~170 mm.',
  url: 'https://publications.copernicus.org/for_authors/manuscript_preparation.html',
};
const AGU = {
  publisher: 'American Geophysical Union (Wiley)',
  canvas: { single: 95, double: 190, height: 230 },
  dpi: { photo: 300, combination: 600, line: 1200 },
  map: ['pdf', 600], formats: ['pdf', 'eps', 'ai'], colour: 'RGB', font: 7,
  note: 'AGU accepts PDF/EPS/AI; maps are combination figures at 300–600 dpi or vector. Single column ~95 mm (one column), full width ~190 mm. Use a sans-serif font ≥ 6 pt at final size.',
  url: 'https://www.agu.org/publish-with-agu/publish/author-resources/graphic-requirements',
};
const WILEY = {
  publisher: 'Wiley',
  canvas: { single: 80, double: 166, height: 225 },
  dpi: { photo: 300, combination: 600, line: 1000 },
  map: ['pdf', 600], formats: ['pdf', 'eps', 'tiff'], colour: 'RGB', font: 7,
  note: 'Wiley: combination figures (maps) at 600 dpi or vector PDF; halftones 300 dpi; line art 1000 dpi. Single column ~80 mm, double column ~166 mm.',
  url: 'https://authorservices.wiley.com/asset/photos/electronic_artwork_guidelines.pdf',
};

/** id -> { title, base template, and any per-journal overrides }. */
const TABLE = {
  // --- Elsevier marine / geochemistry family ---
  'deep-sea-research-part-i': { title: 'Deep-Sea Research Part I: Oceanographic Research Papers', base: ELSEVIER },
  'progress-in-oceanography': { title: 'Progress in Oceanography', base: ELSEVIER },
  'marine-chemistry': { title: 'Marine Chemistry', base: ELSEVIER },
  'organic-geochemistry': { title: 'Organic Geochemistry', base: ELSEVIER },
  'marine-geology': { title: 'Marine Geology', base: ELSEVIER },
  'earth-and-planetary-science-letters': { title: 'Earth and Planetary Science Letters', base: ELSEVIER },
  'geochimica-et-cosmochimica-acta': { title: 'Geochimica et Cosmochimica Acta', base: ELSEVIER },
  'estuarine-coastal-and-shelf-science': { title: 'Estuarine, Coastal and Shelf Science', base: ELSEVIER },
  // --- Copernicus / EGU family ---
  'biogeosciences': { title: 'Biogeosciences', base: COPERNICUS },
  'earth-system-science-data': { title: 'Earth System Science Data', base: COPERNICUS },
  'ocean-science': { title: 'Ocean Science', base: COPERNICUS },
  // --- AGU family ---
  'global-biogeochemical-cycles': { title: 'Global Biogeochemical Cycles', base: AGU },
  'paleoceanography-and-paleoclimatology': { title: 'Paleoceanography and Paleoclimatology', base: AGU },
  // --- Wiley family ---
  'global-change-biology': { title: 'Global Change Biology', base: WILEY },
  'journal-of-phycology': { title: 'Journal of Phycology', base: WILEY, colour: 'RGB' },
  // --- Society / other publishers (distinct specs) ---
  'marine-ecology-progress-series': {
    title: 'Marine Ecology Progress Series', publisher: 'Inter-Research Science Center',
    canvas: { single: 87, double: 180, height: 230 }, dpi: { photo: 300, combination: 600, line: 1200 },
    map: ['tiff', 600], formats: ['tiff', 'eps', 'pdf'], colour: 'RGB', font: 8,
    note: 'MEPS (Inter-Research): halftone/combination 300–600 dpi, line art 1200 dpi; TIFF or EPS. Single column ~87 mm, double column ~180 mm.',
    url: 'https://www.int-res.com/journals/meps/guidelines-for-meps-authors/',
  },
  'ices-journal-of-marine-science': {
    title: 'ICES Journal of Marine Science', publisher: 'Oxford University Press (on behalf of ICES)',
    canvas: { single: 84, double: 174, height: 230 }, dpi: { photo: 300, combination: 600, line: 1200 },
    map: ['tiff', 600], formats: ['tiff', 'eps', 'pdf'], colour: 'RGB', font: 7,
    note: 'OUP: combination figures 600 dpi, halftones 300 dpi, line art 1200 dpi. Single column ~84 mm, double column ~174 mm.',
    url: 'https://academic.oup.com/icesjms/pages/General_Instructions',
  },
  'scientific-reports': {
    title: 'Scientific Reports', publisher: 'Springer Nature',
    canvas: { single: 88, double: 180, height: 240 }, dpi: { photo: 300, combination: 450, line: 600 },
    map: ['pdf', 600], formats: ['tiff', 'eps', 'pdf'], colour: 'RGB', font: 7,
    note: 'Springer Nature: figures at 300–600 dpi (line art up to 600); max width ~180 mm. RGB colour space.',
    url: 'https://www.nature.com/srep/author-instructions/submission-guidelines',
  },
  'communications-earth-environment': {
    title: 'Communications Earth & Environment', publisher: 'Springer Nature',
    canvas: { single: 88, double: 180, height: 240 }, dpi: { photo: 300, combination: 600, line: 600 },
    map: ['pdf', 600], formats: ['pdf', 'eps', 'tiff'], colour: 'RGB', font: 7,
    note: 'Nature Portfolio open-access earth-science title: combination/line up to 600 dpi or vector; single column ~88 mm, double ~180 mm; RGB.',
    url: 'https://www.nature.com/commsenv/submission-guidelines',
  },
  'pnas': {
    title: 'Proceedings of the National Academy of Sciences (PNAS)', publisher: 'National Academy of Sciences',
    canvas: { single: 87, double: 178, height: 230 }, dpi: { photo: 300, combination: 600, line: 1200 },
    map: ['pdf', 600], formats: ['tiff', 'eps', 'pdf'], colour: 'RGB', font: 6,
    note: 'PNAS column widths: 1-column ~8.7 cm, 1.5-column ~11.4 cm, 2-column ~17.8 cm; 300–600 dpi or vector; RGB. Minimum 6–8 pt type at final size.',
    url: 'https://www.pnas.org/author-center/submitting-your-manuscript',
  },
};

function record(id, spec) {
  const base = spec.base || spec;
  const canvas = spec.canvas || base.canvas;
  const dpi = spec.dpi || base.dpi;
  const map = spec.map || base.map;
  return {
    id,
    title: spec.title,
    publisher: spec.publisher || base.publisher,
    canvas: {
      single_column_mm: canvas.single,
      double_column_mm: canvas.double,
      max_height_mm: canvas.height,
    },
    raster_dpi: { photo: dpi.photo, combination: dpi.combination, line: dpi.line },
    map_target: { recommended_format: map[0], recommended_dpi: map[1] },
    formats_accepted: spec.formats || base.formats,
    colour_mode: spec.colour || base.colour,
    min_font_pt: spec.font || base.font,
    font_family_hint: spec.font_family_hint || base.font_family_hint || 'Arial/Helvetica',
    notes: spec.note || base.note,
    source_url: spec.url || base.url,
    last_verified: 'VERIFY-BEFORE-SHIP',
  };
}

let written = 0;
for (const [id, spec] of Object.entries(TABLE)) {
  const rec = record(id, spec);
  await writeFile(path.join(DIR, `${id}.json`), `${JSON.stringify(rec, null, 2)}\n`);
  written++;
}

// Rebuild index.json from every record file, keeping the hand-authored
// Phase-1 records first in their original display order.
const PHASE1 = [
  'limnology-oceanography-methods', 'methods-in-ecology-and-evolution', 'nature', 'science',
  'plos-one', 'elsevier-standard', 'frontiers-in-marine-science', 'copernicus-egu', 'agu-journals',
];
const files = (await readdir(DIR))
  .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'schema.json')
  .map((f) => f.replace(/\.json$/, ''));
const rest = files.filter((id) => !PHASE1.includes(id)).sort();
const journals = [...PHASE1.filter((id) => files.includes(id)), ...rest];
await writeFile(path.join(DIR, 'index.json'), `${JSON.stringify({ journals }, null, 2)}\n`);

console.log(`wrote ${written} records; index lists ${journals.length} journals`);
