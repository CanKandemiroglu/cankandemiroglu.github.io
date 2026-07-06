#!/usr/bin/env python3
"""Marine Map Tool — PyGMT render worker (Phase 3, optional paid path).

NOT DEPLOYED. This consumes render jobs enqueued by workers/render-queue and
produces the finished publication file (vector PDF / TIFF / EPS at the journal
spec) that a user who won't run code locally is paying for.

The figure state it receives is the SAME object the client uses to generate the
PyGMT script (see core/src/scripts/pygmt.js). This worker imports that figure
state, renders it with PyGMT/GMT 6, and uploads the result to R2/S3 under the
job's key. The free path (client export + downloadable PyGMT/R script) does not
use this worker at all.

Design only — the queue-polling and object-storage glue below is intentionally
left as clearly-marked stubs so a deployer can wire it to their own Cloudflare
Queue + R2 (S3-compatible) credentials.
"""
from __future__ import annotations

import json
import os
from typing import Any


def render_figure(state: dict[str, Any], out_path: str) -> None:
    """Render `state` to `out_path` using PyGMT. Mirrors the browser preview.

    `state` is the FigureState documented in core/src/scripts/pygmt.js:
    region, projection (GMT -J template with a WIDTH token), colormap/reverse,
    depthRange, contours, hillshade, stations, furniture, journal, citations.
    """
    import pygmt  # imported lazily so the module is importable without GMT

    region = state["region"]
    reg = [region["west"], region["east"], region["south"], region["north"]]
    journal = state.get("journal", {})
    width_cm = journal.get("widthMm", 168) / 10
    projection = state["projection"]["gmt"].replace("WIDTH", f"{width_cm:g}c")

    lon_span = region["east"] - region["west"]
    resolution = "10m" if lon_span >= 60 else "02m" if lon_span >= 20 else "30s" if lon_span >= 5 else "15s"
    grid = pygmt.datasets.load_earth_relief(resolution=resolution, region=reg)

    fig = pygmt.Figure()
    dr = state.get("depthRange", {"min": -6000, "max": 0})
    # Elevation axis runs deep-negative, so invert relative to the on-screen toggle.
    pygmt.makecpt(cmap=state["colormap"], series=[dr["min"], dr["max"]],
                  reverse=not state.get("reverse", False))
    shade = "+a315+nt0.6" if state.get("hillshade") else None
    fig.grdimage(grid=grid, cmap=True, region=reg, projection=projection, shading=shade)
    fig.coast(shorelines="1/0.25p,gray30", land="#e8e5e0")

    contours = state.get("contours")
    if contours:
        fig.grdcontour(grid=grid, levels=contours["interval"],
                       annotation=contours["annotInterval"], limit=[dr["min"], 0],
                       pen="0.25p,gray40")

    stations = state.get("stations")
    if stations and stations.get("rows"):
        lons = [r["lon"] for r in stations["rows"]]
        lats = [r["lat"] for r in stations["rows"]]
        fig.plot(x=lons, y=lats, style=f"c{stations.get('symbolMm', 2.5) / 10:.2f}c",
                 fill=stations.get("color", "#e4572e"), pen="0.5p,black")

    fig.colorbar(frame='xaf+l"Elevation (m)"')
    fig.savefig(out_path, dpi=journal.get("dpi", 600))


def main() -> None:
    queue_url = os.environ.get("RENDER_QUEUE_URL")
    if not queue_url:
        # No queue configured — render a single job from stdin for local testing:
        #   cat figure_state.json | python render.py
        import sys
        state = json.load(sys.stdin)
        out = os.environ.get("OUT", "marine_map.pdf")
        render_figure(state, out)
        print(f"wrote {out}")
        return

    # DEPLOY STUB: long-poll the Cloudflare Queue (HTTP pull consumer), render
    # each job, upload to R2 via the S3-compatible API using boto3, then flip
    # the job's KV status to 'done'. Left unimplemented on purpose — wire it to
    # your own credentials (see render/README.md).
    raise NotImplementedError(
        "Queue consumer not wired. Set up R2/S3 credentials and the Cloudflare "
        "Queue pull consumer, then implement the poll->render->upload loop."
    )


if __name__ == "__main__":
    main()
