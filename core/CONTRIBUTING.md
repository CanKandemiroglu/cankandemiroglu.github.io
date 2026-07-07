# Contributing to marine-map-core

Thanks for your interest! `marine-map-core` is the open-source figure engine
behind the [Marine Map Tool](https://osmancankandemiroglu.com/app/). Bug
reports, journal-spec corrections, and new features are all welcome.

## Reporting problems & getting help

Open an issue on the repository's GitHub issue tracker. Please include:

- what you did (input region/table/journal, or the failing function call),
- what you expected, and what happened instead,
- for app problems: browser + version; for library problems: Node version.

A wrong journal specification (widths, dpi, fonts) is a **data bug** — see
"Journal records" below; those fixes are especially valuable.

## Development setup

There is nothing to install. The library is dependency-free ES modules and the
tests use Node's built-in runner (Node ≥ 18, ≥ 20 recommended):

```sh
git clone <repo>
cd <repo>/core
npm test          # = node --test
```

The companion app is a static page; serve the repo root and open `/app/`:

```sh
python3 -m http.server 8080   # http://localhost:8080/app/
```

## Ground rules for code changes

- **No runtime dependencies, no DOM, no network** in `core/src/` — everything
  must run unchanged in browsers and Node. (Tests may use `node:fs` etc.)
- **Determinism**: same inputs → same outputs. No randomness, no clocks inside
  the figure path; timestamps are passed in as arguments.
- Every exported function carries JSDoc and tests. PRs without tests for the
  changed behaviour will be asked to add them.
- Generated files (`src/cmocean-data.js`, `/scripts/example-figure.*`) are
  rebuilt with `node scripts/dev/build-cmocean.mjs` /
  `node scripts/dev/build-examples.mjs` — never edited by hand.

## Journal records (`/data/journals`)

Records store **facts** (column widths, dpi, formats, colour mode, font floor)
plus provenance. When adding or correcting a record:

1. Read the journal's *current* author guidelines (link them in `source_url` —
   never copy or rehost guideline text/PDFs; short paraphrase in `notes` only).
2. Set `last_verified` to the date you checked (ISO `YYYY-MM-DD`). The
   `VERIFY-BEFORE-SHIP` sentinel marks unverified defaults and keeps the UI
   warning on.
3. Add the record id to `index.json`; run the tests (`journals.test.js`
   validates every shipped record against the schema and engine).

## Pull requests

Fork → branch → `npm test` green → PR with a short description of what changed
and why. CI runs the test suite on Node 20 and 22. By contributing you agree
your work is released under the repository's MIT licence.
