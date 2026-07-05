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
| `/workers`, `/render` | Phase-3 placeholders (optional paid server render) |

### Reproducibility & citation

Every export embeds the required data citations (Terrain Tiles/ETOPO/GEBCO,
Natural Earth, cmocean). To cite the tool itself see [`CITATION.cff`](CITATION.cff)
— a Zenodo DOI will be minted with the first tagged release.

### Development

No build step. Serve the repo root and open `/app/`:

```sh
python3 -m http.server 8080     # then http://localhost:8080/app/
cd core && npm test             # core test suite (no dependencies)
```

Journal specs ship with `last_verified: "VERIFY-BEFORE-SHIP"` sentinels and
surface an "unverified" warning in the UI until each record is checked against
the journal's current author guidelines (see the checklist in the product spec).
