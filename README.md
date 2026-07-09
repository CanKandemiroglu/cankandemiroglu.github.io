# osmancankandemiroglu.com

Personal academic site of Osman Can Kandemiroglu (marine molecular
biogeochemistry) — plus the **Marine Map Tool**, a browser-based generator of
publication-quality marine maps.

## Marine Map Tool (`/app`)

Turn a region into a publication-ready bathymetric map: GEBCO/ETOPO-derived
bathymetry coloured with exact [cmocean](https://doi.org/10.5670/oceanog.2016.66)
colormaps, isobaths, hillshade, station uploads (CSV/TSV/XLSX), scale bar,
north arrow, graticule, inset locator — exported to a chosen journal's figure
spec (width in mm, dpi, format, font floor) as PNG/PDF/SVG, together with the
**PyGMT or R script that reproduces the figure**.

Also (Phase 3): draw a line to read an in-browser **bathymetric depth
profile**, toggle **EEZ boundaries** (Marine Regions), and import **GBIF/OBIS**
species occurrences as stations.

- Live: <https://osmancankandemiroglu.com/app/>
- Everything renders client-side; no login, no API keys, no tracking.
- The figure engine is open source: [`/core`](core/) (MIT, dependency-free ES
  modules, tested with `node --test`).

| Path | What it is |
|---|---|
| `/app` | The static client app (MapLibre GL JS + vendored libs, no build step) |
| `/core` | `marine-map-core` — open-source figure engine (MIT) |
| `/data/journals` | Journal figure-spec database (deterministic JSON, no AI) |
| `/data/attrib` | Data-source attribution/citation registry |
| `/scripts` | Dev generators + sample exported PyGMT/R scripts |
| `/core/paper` | JOSS paper draft + submission checklist (Phase 2) |
| `/manuscripts/lo-methods` | L&O: Methods manuscript draft (Phase 2) |
| `/workers`, `/render` | Phase-3 placeholders (optional paid server render) |

### How to cite the tool

To cite the Marine Map Tool itself, use the author + version from
[`CITATION.cff`](CITATION.cff) (a Zenodo DOI is minted with the first tagged
release). The app's "How to cite" box shows this short form.

### Data sources & attribution

Figures made with this tool draw on openly-licensed data and libraries. The
required credits are printed compactly on every exported figure; the full list
is kept here (and in the Zenodo record) so the tool's own citation stays short:

| Source | Used for | Licence |
|---|---|---|
| [GEBCO](https://www.gebco.net/) / [ETOPO 2022](https://doi.org/10.25921/fd45-gt74) via [Terrain Tiles (AWS/Mapzen)](https://registry.opendata.aws/terrain-tiles/) | bathymetry & relief | public domain (cite DOI) |
| [Natural Earth](https://www.naturalearthdata.com/) | coastlines / land | public domain |
| [cmocean](https://doi.org/10.5670/oceanog.2016.66) — Thyng et al. (2016) | colormaps | MIT |
| [Marine Regions](https://www.marineregions.org/) (VLIZ) | EEZ boundaries (optional layer) | CC-BY 4.0 |
| [GBIF](https://www.gbif.org/) / [OBIS](https://obis.org/) | species occurrences (optional layer) | per-dataset (mostly CC0/CC-BY) |
| MapLibre GL JS, PyGMT/GMT, pdf-lib, SheetJS, maplibre-contour | rendering / export | BSD-3 / LGPL / MIT / Apache-2.0 |

When you publish a figure, keep the credits printed on it in your figure
caption — that satisfies the CC-BY / data-use requirements. Full per-source
citations and DOIs live in [`/data/attrib/attributions.json`](data/attrib/attributions.json).

### Development

No build step. Serve the repo root and open `/app/`:

```sh
python3 -m http.server 8080     # then http://localhost:8080/app/
cd core && npm test             # core test suite (no dependencies)
```

Journal specs ship with `last_verified: "VERIFY-BEFORE-SHIP"` sentinels and
surface an "unverified" warning in the UI until each record is checked against
the journal's current author guidelines (see the checklist in the product spec).
