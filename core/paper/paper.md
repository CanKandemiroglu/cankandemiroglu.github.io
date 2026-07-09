---
title: 'marine-map-core: a deterministic figure engine for publication-quality, journal-compliant marine maps in the browser'
tags:
  - JavaScript
  - oceanography
  - bathymetry
  - cartography
  - scientific figures
  - reproducibility
authors:
  - name: Osman Can Kandemiroglu
    orcid: 0000-0002-4453-3613
    affiliation: 1
affiliations:
  - name: University of Bremen, Bremen, Germany
    index: 1
date: 5 July 2026
bibliography: paper.bib
---

# Summary

Almost every observational marine-science publication opens with the same figure: a bathymetric
map of the study area with sampling stations, a scale bar, a north arrow, an inset locator, and a
depth colorbar — rendered at a specific journal's column width, resolution, and font floor.
`marine-map-core` is a small, dependency-free JavaScript library that packages the deterministic
parts of producing that figure: perceptually uniform `cmocean` colormap lookup tables
[@thyng2016], a journal figure-specification engine driven by an auditable JSON database
(column widths in mm, raster dpi, accepted formats, colour mode, minimum font size), cartographic
furniture mathematics (scale-bar sizing, graticule intervals, colorbar ticks, Web-Mercator
projection of annotations), decoding and recolouring of Terrarium-encoded digital elevation
tiles derived from ETOPO 2022 and GEBCO [@etopo2022; @gebco2024], tolerant parsing of
station tables (delimiter sniffing, hemisphere suffixes, European decimal commas), citation and
attribution assembly for the underlying data products, and generation of runnable PyGMT
[@wessel2019; @uieda2021] and R scripts that reproduce the figure outside the browser.

The library is pure ES modules with no runtime dependencies and no DOM or network access, so it
runs unchanged in browsers and in Node.js. It powers the Marine Map Tool
(<https://osmancankandemiroglu.com/app/>), a free, login-free web application in which the entire
figure — bathymetry colouring included — is rendered client-side, but it is equally usable from
any JavaScript environment. Every function is covered by a `node:test` suite (155 tests) that
runs without installing anything.

# Statement of need

Producing a journal-compliant site map today typically means assembling a desktop GIS such as
QGIS [@qgis], or a scripting stack such as PyGMT [@uieda2021] or R with `marmap` [@pante2013] —
capable tools with real learning curves — and then hand-transcribing figure requirements from
author guidelines: column widths, minimum font sizes at final size, combination-figure dpi,
colour-mode caveats. Two failure modes are common and costly. First, figures are submitted
that silently violate the journal's specification and bounce at technical check. Second,
rainbow-like or otherwise perceptually non-uniform colormaps continue to distort published
bathymetry despite well-documented harms [@thyng2016; @crameri2020].

Lightweight web mappers exist — SimpleMappr [@shorthouse2010] produces clean point maps —
but none combine bathymetry with correct oceanographic colormaps, none know journal figure
specifications, and none hand back a script that reproduces the figure. `marine-map-core`
treats those requirements as *data and deterministic code*, not judgement: the journal
database records facts with `source_url` and `last_verified` fields and the engine turns a
record into an export configuration (canvas size, dpi, format, font floor, warnings such as
CMYK degradation of RGB-defined colormaps) with no model, heuristic, or network call in the
path. The script generators emit self-contained PyGMT and R programs whose headers embed the
data citations (GEBCO, ETOPO 2022, Natural Earth, cmocean), so the reproducibility artefact —
not just the raster — travels with the paper and the underlying data providers are credited
correctly.

The intended users are working marine scientists and students who need a correct,
publication-ready site map in minutes, and developers of scientific web tools who need
journal-spec, colormap, or DEM-recolouring machinery as a tested library rather than
application-locked code.

# Design

Three decisions shape the library. **Deterministic core:** identical inputs yield identical
specifications, colours, and scripts; there is no AI component. **Facts as data:** journal
requirements live in versioned JSON records carrying provenance (`source_url`,
`last_verified`), so a stale specification is an auditable data bug, not a code archaeology
exercise. **Zero dependencies:** the browser application that embeds the library renders
bathymetry fully client-side, so the library takes no dependency it cannot guarantee in that
environment; tests run on the Node.js standard library alone.

# Acknowledgements

The library redistributes colormap data from the MIT-licensed `cmocean` project [@thyng2016]
and builds on openly licensed data products: GEBCO [@gebco2024], ETOPO 2022 [@etopo2022],
Natural Earth, and the AWS Open Data Terrain Tiles. MapLibre GL JS [@maplibre] renders the
interactive preview in the companion application.

# References
