/**
 * Full Mediterranean figure state shared by the script-generator tests and
 * the sample-script regeneration tool (scripts/dev/build-examples.mjs). The
 * committed samples in /scripts (example-figure.py / example-figure.R) are
 * generated from this exact fixture — the sync test in scripts.test.js fails
 * if they drift.
 */
export const FIXTURE = {
  title: 'Mediterranean Sea — Bathymetry and Stations',
  region: { west: -6, south: 30, east: 36, north: 46 },
  projection: {
    id: 'lambert-conic',
    name: 'Lambert conformal conic',
    gmt: '-JL15/38/32.7/43.3/WIDTH',
    note:
      'Conformal conic projection; scale is true along the two standard ' +
      'parallels (32.7° and 43.3°), ideal for east–west elongated ' +
      'mid-latitude regions.',
  },
  colormap: 'deep',
  reverse: false,
  depthRange: { min: -6000, max: 0 },
  contours: { interval: 500, annotInterval: 1000 },
  hillshade: true,
  stations: {
    rows: [
      { lon: 21.13, lat: 36.57, name: 'Calypso Deep', value: -5267 },
      { lon: 21.38, lat: 35.3, name: "L'Atalante Basin", value: -3600 },
    ],
    symbolMm: 2.5,
    color: '#e4572e',
    label: true,
  },
  furniture: { scaleBar: true, northArrow: true, graticuleDeg: 5, inset: true },
  journal: {
    title: 'Deep-Sea Research Part I',
    widthMm: 168,
    dpi: 600,
    format: 'pdf',
    minFontPt: 7,
  },
  citations: [
    'GEBCO Compilation Group (2024). The GEBCO_2024 Grid. NERC EDS British Oceanographic Data Centre NOC. doi:10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f',
    'Thyng, K. M., Greene, C. A., Hetland, R. D., Zimmerle, H. M., & DiMarco, S. F. (2016). True colors of oceanography: Guidelines for effective and accurate colormap selection. Oceanography, 29(3), 9-13. doi:10.5670/oceanog.2016.66',
    'NOAA National Centers for Environmental Information (2022). ETOPO 2022 15 Arc-Second Global Relief Model. doi:10.25921/fd45-gt74',
  ],
  accessedDate: '2026-07-05',
};
