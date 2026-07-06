# /render — PyGMT render container (Phase 3, optional paid path)

The server-side renderer for the optional paid tier. **Not deployed.** It runs
the same figure state the client uses to generate the PyGMT script (see
[`core/src/scripts/pygmt.js`](../core/src/scripts/pygmt.js)) and produces the
finished vector/TIFF/EPS file at the journal spec — the artifact a paying user
who won't run code locally receives.

```
Dockerfile   conda-forge PyGMT + GMT 6 image
render.py    render_figure(state, out_path) + queue-consumer entrypoint (stub)
```

## Licensing

GMT core is LGPL. It is invoked here as an external executable via PyGMT — never
statically linked into or bundled with the closed-source parts of the product,
per the ship checklist.

## Local test (no queue, no cloud)

```sh
# Build once (needs Docker):
docker build -t marine-render render/
# Render one figure from a saved figure-state JSON:
cat figure_state.json | docker run --rm -i -e OUT=/dev/stdout marine-render > marine_map.pdf
```

`figure_state.json` is the object the app builds for script export — you can log
it from the browser (`window.__mmt.buildFigureState()`).

## Deploying

Push the image to a registry and run it as a Cloudflare Container (or any
container host) with `RENDER_QUEUE_URL` and R2/S3 credentials injected, so it
long-polls the `marine-render-jobs` queue created in
[`/workers`](../workers/README.md). The poll→render→upload loop in `render.py`
is a clearly-marked stub — wire it to your own R2 credentials before going live.

I couldn't build or push the image from the build session (no Docker daemon, no
registry credentials); everything here is ready to `docker build` on your side.
