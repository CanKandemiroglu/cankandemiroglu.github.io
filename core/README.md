# marine-map-core

`marine-map-core` is the open-source figure engine behind the
[Marine Map Tool](https://osmancankandemiroglu.com/app/), a browser-based tool
that turns coordinates or a region into a publication-quality marine map and
the script that reproduces it. Everything that decides what a figure looks
like — colormaps, journal specifications, cartographic furniture, terrain
colouring, station parsing, citations, script generation — lives here. The UI
in `/app` is a thin layer over these functions.

## Design principles

- **Dependency-free pure ES modules.** No runtime dependencies, no build step,
  no DOM or network access in `src/`. Every module runs unchanged in the
  browser and in Node (>= 18).
- **Deterministic.** The same inputs always produce the same figure spec,
  colours, and scripts. There is no AI/LLM anywhere in the figure path.
- **Facts are data, not code.** Journal figure requirements live in
  `/data/journals/*.json` with `source_url` and `last_verified` fields, so
  they can be audited and updated without touching the engine.

## Statement of need

Researchers routinely need bathymetric site and station maps that comply with
a specific journal's figure requirements (column widths, minimum font sizes,
raster DPI, colour mode), rendered with perceptually uniform colormaps and
accompanied by a script that reproduces the figure for review and archival.
Doing this today means assembling a GIS or a PyGMT/marmap environment,
transcribing figure specifications from author guidelines by hand, and
re-checking font sizes at final column width — a workflow that is slow,
error-prone, and hard to reproduce. `marine-map-core` packages the
deterministic parts of that workflow — cmocean colormap lookup tables, a
journal figure-spec engine, scale-bar/graticule/colorbar mathematics, DEM
decoding and recolouring, station-file parsing, citation assembly, and
PyGMT/R script generation — as a small, testable, dependency-free library
usable from any browser or Node application.

## Install and use

The package is plain ES modules; import directly from source
(npm publication is planned):

```js
import { getLUT, selectJournal, generatePyGMT } from './core/src/index.js';
```

## Modules

| Module | Exports | Purpose |
| --- | --- | --- |
| `cmocean` | `listColormaps`, `getLUT`, `sampleColormap`, `colormapCSSGradient`, `colormapStops` | 22 perceptually uniform colormaps as 8-bit LUTs (`Uint8Array(768)`, 256 RGB triplets) |
| `journals` | `validateJournalRecord`, `selectJournal`, `checkFontFloor`, `FALLBACK_SPEC` | Deterministic journal figure-spec engine driven by `/data/journals/*.json` |
| `furniture` | `metersPerPixel`, `niceScaleBar`, `graticuleInterval`, `graticuleLines`, `colorbarTicks`, `formatDegree`, `formatDepth`, `lonLatToCanvasXY` | Scale-bar, graticule, colorbar, and degree-formatting math plus Web-Mercator canvas projection |
| `projection` | `suggestProjection` | Map `{west, south, east, north}` bounds (degrees, WGS84) to a GMT `-J` template with a rationale |
| `terrain` | `terrariumToElevation`, `elevationToTerrarium`, `terrariumStats`, `applyColormapToTerrarium` | Terrarium-encoded DEM decode/encode and colormap recolouring |
| `stations` | `sniffDelimiter`, `parseDelimited`, `guessColumns`, `toStations`, `stationsToGeoJSON` | Delimiter sniffing, RFC 4180 parsing, lat/lon column guessing, validation, GeoJSON output |
| `citation` | `DATA_SOURCES`, `buildCitationText`, `buildBibTeX`, `attributionLine` | Data-source registry and citation/attribution builders |
| `scripts` | `generatePyGMT`, `generateRScript` | Reproducible-figure script exports |

## Example

Illustrative sketch — see each module's JSDoc for exact signatures:

```js
import { getLUT, selectJournal, generatePyGMT } from './core/src/index.js';

// 256-entry RGB lookup table for the cmocean "deep" colormap
const lut = getLUT('deep', { reverse: true });

// Resolve a journal's figure spec (falls back to FALLBACK_SPEC if unknown)
const spec = selectJournal('nature', journalRecords);

// Generate the PyGMT script that reproduces the figure
const py = generatePyGMT({
  bounds: { west: 25.0, south: 39.5, east: 27.5, north: 41.0 },
  colormap: 'deep',
  journal: spec,
  stations,
});
```

## Testing

```sh
cd core && npm test
```

Tests use Node's built-in `node:test` runner — no test framework or other
dependencies are installed.

## Data provenance and licences

- **Colormaps** are derived from [cmocean](https://github.com/matplotlib/cmocean)
  (MIT): Thyng, K. M., Greene, C. A., Hetland, R. D., Zimmerle, H. M. &
  DiMarco, S. F. (2016). True colors of oceanography: Guidelines for effective
  and accurate colormap selection. *Oceanography* 29(3), 9–13.
  [doi:10.5670/oceanog.2016.66](https://doi.org/10.5670/oceanog.2016.66)
- **Journal figure specifications** (`/data/journals/*.json`) are facts
  transcribed from publishers' author guidelines. Each record carries a
  `source_url` and a `last_verified` field; records still marked
  `VERIFY-BEFORE-SHIP` have not been re-checked against the publisher's
  current guidelines and must be verified before relying on them.
- Bathymetry, coastline, and other map data consumed by the app (GEBCO/ETOPO,
  Natural Earth) carry their own licences; `DATA_SOURCES` and the citation
  helpers exist to keep those attributions correct in exported figures.

## How to cite

See [`/CITATION.cff`](../CITATION.cff) at the repository root (a Zenodo DOI
will be minted on the first tagged release). Please also cite the data
sources listed in a figure's "How to cite" box.

## Contributing

Issues and pull requests are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md)
(dev setup, ground rules, how journal records are verified) and the project
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). In short: keep `src/`
dependency-free and deterministic, add a `node:test` case for every change,
and run `npm test` before submitting.

## Paper

A JOSS paper describing this library lives in [`paper/`](./paper/)
(`paper.md` + `paper.bib`); [`paper/SUBMISSION-CHECKLIST.md`](./paper/SUBMISSION-CHECKLIST.md)
tracks the submission steps (Zenodo archive, verification of journal records,
review readiness).

## Licence

MIT — see [`LICENSE`](./LICENSE).
