# The Marine Map Tool: publication-quality, journal-compliant bathymetric maps and reproducible figure scripts in the browser

**Draft manuscript for *Limnology & Oceanography: Methods*** — status: working
draft (v0.1, 2026-07-06). TODO markers indicate content the author must supply
or confirm before submission. Target sections follow the journal's structure
(Abstract, Introduction, Materials and Procedures, Assessment, Discussion,
Comments and Recommendations).

Author: Osman Can Kandemiroglu¹ (ORCID 0000-0002-4453-3613)
¹ University of Bremen, Bremen, Germany
Correspondence: see https://osmancankandemiroglu.com/contact.html
<!-- TODO: institutional email + full affiliation line as it should appear in print -->

---

## Abstract

Nearly every observational study in aquatic science begins with a bathymetric
site map, yet producing one that satisfies a journal's figure specification —
exact column width, raster resolution, minimum font size, an appropriate
colormap — still requires either desktop GIS expertise or a scripting stack
such as PyGMT or R, plus manual transcription of author guidelines. We present
the Marine Map Tool (https://osmancankandemiroglu.com/app/), a free,
browser-based application, and its open-source engine `marine-map-core`, which
together turn a geographic region and an optional station table into a
publication-ready marine map. Global relief derived from ETOPO 2022 and GEBCO
is coloured client-side through exact, perceptually uniform cmocean lookup
tables; cartographic furniture (scale bar, north arrow, graticule, inset
locator, depth colorbar) is composed deterministically; and a journal
specification engine — a curated, provenance-tracked JSON database of figure
requirements — drives the export canvas so the downloaded PNG, PDF, or SVG
arrives at the journal's column width, dpi, and font floor. Critically, every
figure can be exported *as a script*: the tool generates runnable PyGMT and R
programs that reproduce the figure outside the browser, with the required data
citations embedded in their headers. The application requires no login, no API
key, and no server-side rendering; the engine is dependency-free, MIT-licensed,
and covered by 155 automated tests. We describe the architecture, assess
specification fidelity and colormap accuracy, and discuss how treating journal
figure requirements as auditable data reduces a common source of technical
rejections while making the reproducibility artefact — not just the image —
the primary output.

<!-- TODO: L&O:M abstracts are typically ≤ 250 words; trim to fit on final pass. -->

## Introduction

The site map is the most ubiquitous figure in aquatic science: reviewers and
readers orient every observational result against bathymetry, station
positions, and geographic context. Despite this ubiquity, the figure is
disproportionately expensive to produce well. Desktop GIS packages (e.g., QGIS;
QGIS Development Team 2026) are powerful but carry a learning curve that is
hard to justify for a single figure; scripting stacks — the Generic Mapping
Tools and PyGMT (Wessel et al. 2019; Uieda et al. 2021), or R with `marmap`
(Pante and Simon-Bouhet 2013) — are reproducible but demand environment setup
and cartographic-code fluency that many students and field-focused researchers
do not have. Web-based alternatives remove the installation burden but not the
correctness burden: point-mapping services such as SimpleMappr (Shorthouse
2010) produce clean occurrence maps yet offer neither bathymetry, nor
perceptually uniform oceanographic colormaps, nor any awareness of journal
figure requirements.

Two quiet failure modes result. First, submissions bounce at technical check —
or worse, print badly — because the figure violates specifications that were
never machine-readable in the first place: single- versus double-column widths
in millimetres, minimum label sizes at final size, distinct dpi floors for
line, combination, and photographic figures. Second, perceptually non-uniform
colormaps continue to distort published bathymetry and hydrography, despite a
decade of documentation of the harm they do to quantitative reading and to
readers with colour-vision deficiency (Thyng et al. 2016; Crameri et al.
2020).

We built the Marine Map Tool around a simple claim: for the standard marine
site figure, both failure modes are eliminable by *deterministic software*,
with no expertise demanded of the user. Journal requirements are facts, so we
store them as data with provenance and let an engine — not the user's memory —
set the canvas. Colormap correctness is a solved problem, so the tool ships
only perceptually uniform cmocean maps, applied identically on screen and in
export. Reproducibility is a deliverable, so the tool exports not only the
finished raster or vector file but a runnable PyGMT or R script that recreates
the figure, embedding the citations for every data product used. This paper
describes the method (architecture and design decisions), assesses its
fidelity (specification compliance, colormap accuracy, reproducibility of the
scripted output), and discusses scope and limitations.

## Materials and procedures

### Architecture overview

The system has two parts (Fig. 1).

`marine-map-core` (MIT licence) is a dependency-free JavaScript library of
pure ES modules with no DOM, network, or model access: cmocean colormap lookup
tables; the journal specification engine; cartographic-furniture mathematics;
Terrarium DEM decoding and recolouring; station-table parsing; citation
assembly; and PyGMT/R script generation. Because the modules are pure, the
entire engine runs identically in browsers and in Node.js, where a 155-test
suite exercises it with no installation step (`node --test` on the standard
library alone).

The Marine Map Tool is a static web application over that engine. There is no
backend: the application is served as files, and all computation — including
bathymetry colouring and figure rasterisation — happens in the user's browser.
This makes the free tier structurally free to operate and removes any
requirement for accounts, API keys, or usage tracking.

*Figure 1. TODO: architecture schematic (browser-side pipeline: DEM tiles →
cmocean LUT → MapLibre render → furniture composition → journal-spec export;
side channel: figure state → PyGMT/R script). A draft of this diagram exists
in the product specification.*

### Bathymetry rendering

The interactive basemap is rendered by MapLibre GL JS from Terrarium-encoded
elevation tiles (Terrain Tiles on AWS Open Data; oceanic cells derive from
ETOPO1/ETOPO 2022 and GEBCO compilations). A custom tile protocol intercepts
each 256 × 256 tile, decodes per-pixel elevation
(elev = R·256 + G + B/256 − 32768), and maps water depths through a 256-entry
cmocean lookup table quantised from the upstream MIT-licensed RGB tables
(Thyng et al. 2016); land pixels are flattened to a neutral grey, yielding a
pixel-accurate coastline from the DEM itself. Hillshade is computed by the
renderer from the same tiles, and isobaths are contoured in a web worker
(maplibre-contour), so depth structure remains legible at every zoom.
Twenty-two cmocean colormaps are available; `deep` (reversed convention:
shallow light, deep dark) is the default for bathymetry.

### The journal specification engine

Journal figure requirements live in `/data/journals/*.json`, one record per
journal or publisher family, each holding only facts: single/double column
widths (mm), maximum height, dpi floors for photograph/combination/line
figures, accepted formats, colour mode, minimum font size, and a
`font_family_hint`. Each record carries `source_url` (a link to the journal's
author guidelines — guideline text is never copied or rehosted) and
`last_verified` (an ISO date, or the sentinel `VERIFY-BEFORE-SHIP`, which the
engine converts into an explicit "unverified specification" warning in the
interface). Selecting a journal deterministically fixes the export
configuration: canvas width from the chosen column count, dpi and format from
the record, a font floor enforced during composition, and warnings where facts
demand them — most notably that cmocean colormaps are RGB-defined and degrade
under CMYK conversion. Nine records ship at the time of writing (Wiley/ASLO,
Wiley/BES, Nature portfolio, Science, PLOS ONE, Elsevier standard artwork,
Frontiers, Copernicus/EGU, AGU). The database is versioned, auditable, and
correctable by pull request; a wrong width is a data bug, not buried code.

### Figure composition and export

Exports are composed at the target physical size. The region is re-rendered
off-screen at the specification's resolution (e.g., a 168-mm double column at
600 dpi is a 3,969-pixel-wide render), and furniture is drawn onto the canvas
in device pixels derived from millimetres: neatline, graticule ticks and
degree labels, an alternating-segment scale bar sized by "nice number" rules
at the map's central latitude, a north arrow, a depth colorbar with tick
values from the active range, station symbols with optional labels, a global
inset locator with the region outlined, and a mandatory attribution line
crediting the data products. PNG exports embed true resolution metadata (a
pHYs chunk), PDF pages are set at exact millimetre dimensions, and SVG exports
keep the furniture as vectors over the embedded raster map. Labels never fall
below the journal's minimum font size.

### Reproducible script export

Every figure state can be exported as a runnable PyGMT (Python) or R script.
The generators are deterministic string builders over the same state that
drives the interface: region, projection (auto-suggested from latitude and
extent — e.g., Lambert conformal conic for mid-latitude east–west regions,
polar stereographic poleward of 65°), colormap and depth range, contour
intervals, stations, furniture, and the journal target. The PyGMT script
renders through GMT 6 (which ships the cmocean colormaps natively; Wessel et
al. 2019) at the journal's physical width and dpi; the R script obtains an
ETOPO 2022 subset directly from a NOAA ERDDAP endpoint (with an automatic
request stride so wide regions download megabytes, not gigabytes) and renders
through ggplot2/terra/sf with the R `cmocean` package. Both scripts embed, as
header comments, the citations for every data product used — GEBCO, ETOPO
2022, Natural Earth, cmocean — plus the journal target and access date, so
provenance travels with the artefact. The direction convention is handled
explicitly: because the scripted colour axis is elevation (deep = minimum),
the generators invert the colormap direction flag relative to the on-screen
toggle, and the scripted figure matches the screen.

### Station data

Station tables are parsed entirely client-side (nothing is uploaded). The
parser sniffs delimiters (comma, semicolon, tab), honours RFC-4180 quoting,
strips byte-order marks, accepts European decimal commas and hemisphere
suffixes (41.25 S), normalises 0–360° longitudes, and guesses
latitude/longitude/name/value columns from headers with a manual override.
Invalid rows are reported individually rather than failing the file. Excel
workbooks are read via SheetJS and fed through the same pipeline.

## Assessment

<!-- TODO: this section reports what is verifiable today; extend with a small
user study (e.g., time-to-figure for N students vs. QGIS/PyGMT baseline)
before submission if feasible. -->

**Specification fidelity.** For each shipped journal record, the export
pipeline was verified to produce (i) canvases whose pixel dimensions equal the
record's column width at the recorded dpi (mm × dpi / 25.4, exact to the
rounding pixel), (ii) PNG resolution metadata matching the declared dpi, and
(iii) PDF page boxes at exact millimetre size. Label sizes are floored at the
record's minimum font size by construction. The engine's warning paths (CMYK
degradation; unverified records; requested format not accepted) are covered by
unit tests.

**Colormap accuracy.** The shipped lookup tables are generated
programmatically from the upstream cmocean RGB tables (256 entries; 512-entry
upstream tables are linearly resampled) and quantised to 8-bit, bounding the
per-channel error at ≤ 1/255 relative to the published colormaps. The
generation script and upstream commit provenance are committed with the data,
so the tables are regenerable and diffable.

**Reproducibility of scripted output.** Generated Python scripts are
syntax-verified (`py_compile`) in the automated test suite, string-escaping is
tested against hostile inputs (quotes/apostrophes in titles and station
names), and the R script's ERDDAP request pattern (dataset, variable, slice
order, stride) was validated against the live NOAA CoastWatch server.
Committed sample scripts are regenerated from a shared fixture and a test
fails if they drift from the generators.
<!-- TODO: add a visual A/B panel — app export vs. PyGMT-rendered output for
the same figure state — as Fig. 2/3 evidence. -->

**Engineering assessment.** The engine comprises 155 automated tests across
nine modules, runs on the Node.js standard library alone, and is exercised in
continuous integration on two Node versions. The application was additionally
driven end-to-end in a headless browser (map initialisation, journal database
load, station ingest, full export pipeline) as part of the development
process.

*Figure 2. TODO: worked example — Black Sea demo region with stations,
exported at the L&O:M double-column specification (168 mm, 600 dpi), shown at
print size.*

*Figure 3. TODO: the same figure state rendered by the exported PyGMT script,
demonstrating browser/script agreement.*

## Discussion

The tool's central design decision is to treat correctness constraints as
data and deterministic code rather than user knowledge. This has three
consequences worth drawing out.

First, *journal specifications become auditable*. Every record carries its
source link and verification date, the interface surfaces unverified records
rather than hiding uncertainty, and a correction is a one-line pull request
that immediately benefits every subsequent user. We contrast this with the
status quo, in which each laboratory re-transcribes the same author
guidelines, and errors are discovered at submission time.

Second, *the reproducibility artefact is the script, not the pixels*. The
exported PyGMT/R program is simultaneously the "methods" record for the
figure, the upgrade path to fully vector output and journal-specific formats
(EPS/TIFF) that browsers cannot produce natively, and the citation vehicle:
data credits ride in the script header and in the figure's attribution line.
A reader can regenerate, restyle, or extend the figure without the tool.

Third, *client-side rendering aligns incentives with accessibility*. Because
the browser does all the work, the free tier costs approximately nothing to
operate and requires no accounts; there is no pressure to paywall the core
scientific function. The same property guarantees privacy for unpublished
station data, which never leaves the user's machine.

**Limitations.** The interactive preview and raster exports are Web Mercator;
the suggested projection (Lambert conic, polar stereographic, etc.) is applied
in the exported scripts rather than in the browser view. Client-side exports
are raster-embedded PDF/PNG/SVG-with-raster — journals requiring pure vector
or TIFF are served via the script path. The bundled global relief resolves to
the underlying compilation (~15 arc-second at best); regional products such as
EMODnet Bathymetry are a planned overlay, not yet integrated. The journal
database ships with nine publisher families and deliberately marks all of
them unverified until each is checked against current guidelines; it depends
on community maintenance to stay current. Finally, the tool is not a GIS: it
makes one figure very well and does not attempt spatial analysis.

## Comments and recommendations

For authors: a single publication-quality site figure — bathymetry, stations,
furniture, correct colormap, journal-exact canvas — takes minutes in a
browser, and we recommend exporting the companion script alongside the figure
and archiving both with the manuscript. For journals and reviewers:
machine-readable figure specifications would eliminate this entire class of
technical rejection; until then, the community-maintained JSON database in
this project is a start, and corrections are welcome by pull request. For
educators: because the tool requires no installation or login, it drops the
cost of teaching correct marine cartography (colormap choice, scale bars,
projections) to essentially zero — the Quick mode was designed so that a
student's first map is also a defensible one.

The application is free at https://osmancankandemiroglu.com/app/; the engine
is MIT-licensed with archived releases (Zenodo DOI: TODO after first tagged
release; see CITATION.cff in the repository).

## Acknowledgments

The tool builds on openly licensed data and software: GEBCO Compilation Group
grids, the NOAA ETOPO 2022 relief model, Natural Earth, Terrain Tiles on AWS
Open Data (Mapzen), the cmocean colormaps (Thyng et al. 2016), MapLibre GL
JS, GMT/PyGMT, and the R spatial stack. <!-- TODO: funding statement, if any;
colleagues/beta testers to acknowledge. -->

## References

Crameri, F., G. E. Shephard, and P. J. Heron. 2020. The misuse of colour in
science communication. Nat. Commun. 11: 5444. doi:10.1038/s41467-020-19160-7

GEBCO Compilation Group. 2024. GEBCO 2024 Grid. NERC EDS British
Oceanographic Data Centre NOC. doi:10.5285/1c44ce99-0a0d-5f4f-e063-7086abc0ea0f

NOAA National Centers for Environmental Information. 2022. ETOPO 2022 15
arc-second global relief model. doi:10.25921/fd45-gt74

Pante, E., and B. Simon-Bouhet. 2013. marmap: A package for importing,
plotting and analyzing bathymetric and topographic data in R. PLoS ONE 8:
e73051. doi:10.1371/journal.pone.0073051

QGIS Development Team. 2026. QGIS Geographic Information System. Open Source
Geospatial Foundation Project. https://qgis.org

Shorthouse, D. P. 2010. SimpleMappr, an online tool to produce
publication-quality point maps. https://www.simplemappr.net

Thyng, K. M., C. A. Greene, R. D. Hetland, H. M. Zimmerle, and S. F. DiMarco.
2016. True colors of oceanography: Guidelines for effective and accurate
colormap selection. Oceanography 29: 9–13. doi:10.5670/oceanog.2016.66

Uieda, L., and others. 2021. PyGMT: A Python interface for the Generic
Mapping Tools. Zenodo. doi:10.5281/zenodo.3781524

Wessel, P., J. F. Luis, L. Uieda, R. Scharroo, F. Wobbe, W. H. F. Smith, and
D. Tian. 2019. The Generic Mapping Tools version 6. Geochem. Geophys.
Geosyst. 20: 5556–5564. doi:10.1029/2019GC008515
