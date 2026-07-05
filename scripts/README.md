# scripts/

Two unrelated-but-cohabiting things live here: **development generators** used to
build vendored data for `/core`, and **sample output** of the reproducible-script
export — the flagship feature of the Marine Map Tool.

## Contents

| Path | What it is |
| --- | --- |
| `dev/build-cmocean.mjs` | Dev-time generator that produces the vendored cmocean colormap data (`core/src/cmocean-data.js`). Run it only when updating the colormap tables; its output is committed. |
| `example-figure.py` | Sample **PyGMT** export produced by `generatePyGMT()` in `core/src/scripts/pygmt.js`. |
| `example-figure.R` | Sample **R (ggplot2)** export produced by `generateRScript()` in `core/src/scripts/rscript.js`. |

The two `example-figure.*` files are *generated artifacts*, committed so that
reviewers and users can see exactly what an export looks like without running the
app. They reproduce the same figure — a Mediterranean bathymetry map with depth
contours, two stations, scale bar, north arrow and a global inset, targeted at a
168 mm / 600 dpi / PDF journal figure. Do not edit them by hand: the test suite
(`core/test/scripts.test.js`) regenerates the same figure state and fails if the
committed files drift from the generator output.

## Running the PyGMT sample

```sh
pip install pygmt        # or: conda install -c conda-forge pygmt
python3 example-figure.py
```

Requires network access on first run: PyGMT downloads the GMT remote
earth-relief tiles for the mapped region (the resolution is chosen automatically
from the region size). GMT ≥ 6 ships the cmocean colormaps natively, so no extra
colormap files are needed. Output: `marine_map.pdf` at the exact physical width
stated in the script header.

## Running the R sample

```r
install.packages(c("terra", "sf", "ggplot2", "cmocean",
                   "rnaturalearth", "rnaturalearthdata", "ggspatial"))
```

```sh
Rscript example-figure.R
```

The R script downloads an ETOPO 2022 netCDF subset for the mapped region from
NOAA ERDDAP into `bathy.nc`, then renders with the ggplot2 stack. Note the
honesty caveat in its header: this stack draws in plate carrée (unprojected
WGS84); the suggested map projection is recorded as a comment, and the PyGMT
script is the one that renders in that projection. The (GPL-licensed) `marmap`
package is deliberately not used.

## Regenerating the samples

The fixture lives in `core/test/scripts.test.js` (`FIXTURE`). To regenerate the
committed samples after changing a generator, run a small Node script that calls
both generators with that same fixture and writes the results here, e.g.:

```js
import fs from 'node:fs';
import { generatePyGMT } from '../core/src/scripts/pygmt.js';
import { generateRScript } from '../core/src/scripts/rscript.js';

const state = /* copy of FIXTURE from core/test/scripts.test.js */;
fs.writeFileSync('scripts/example-figure.py', generatePyGMT(state));
fs.writeFileSync('scripts/example-figure.R', generateRScript(state));
```

Then run `cd core && node --test test/scripts.test.js` — the sync test confirms
the committed files match the generators byte-for-byte.

## Citations travel with the figure

Every script the app exports embeds its own provenance as header comments: the
journal target (width/dpi/format), the projection choice, the data **citations**
(bathymetry source, cmocean colormap paper, station data where applicable) and
the data-access date. Copying the script is copying the citation record — that
is the point of the feature.
