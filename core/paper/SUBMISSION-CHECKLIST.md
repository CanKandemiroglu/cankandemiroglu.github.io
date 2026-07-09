# JOSS submission checklist (do these in order)

Everything below except the account actions is already in the repo. The steps
marked **[you]** need the author's own accounts and cannot be automated.

## 0. Pre-flight (already done in this repo)

- [x] OSI licence for the software: `core/LICENSE` (MIT), mirrored in `core/package.json`.
- [x] Tests + CI: `cd core && npm test` (155 tests, zero deps); `.github/workflows/core-tests.yml` runs Node 20 + 22.
- [x] Documentation: `core/README.md` (statement of need, install, usage, module table), JSDoc on all exports.
- [x] Community guidelines: `core/CONTRIBUTING.md`, `core/CODE_OF_CONDUCT.md`.
- [x] Paper: `core/paper/paper.md` + `core/paper/paper.bib` (JOSS format, ~800 words).
- [x] Citation metadata: `/CITATION.cff`, `/.zenodo.json`.

## 1. Decide the repository scope **[you]**

JOSS reviews a software repository. Two workable options:

- **Submit this monorepo** (simplest): the paper says the library lives in `/core`
  of the site repository. Reviewers will see the personal site alongside — that
  is acceptable but slightly noisy.
- **Split `/core` into its own repository** (cleaner, recommended before
  submission): `git subtree split --prefix=core` (or a fresh repo copying
  `/core`, `/data/journals`, `/data/attrib`, `/scripts/dev`, the CI workflow,
  `CITATION.cff`, `.zenodo.json`), keep the app pulling the library in as
  today. Update `repository` in `core/package.json` and `CITATION.cff` if split.

## 2. Verify the journal records **[you]** — required by our own spec

Before submission, check each `data/journals/*.json` against the journal's
current author guidelines and replace `"VERIFY-BEFORE-SHIP"` with the check
date. Reviewers *will* click those `source_url` links. (`npm test` keeps
records/schema/index consistent.)

## 3. Archive a release on Zenodo **[you]**

1. Log in to <https://zenodo.org> with GitHub; enable the repository under
   *GitHub* in your Zenodo account (flip the toggle **before** tagging).
2. Tag and publish a GitHub release: `v0.1.0`. Zenodo archives it and mints a
   version DOI + a concept DOI (`.zenodo.json` provides the metadata).
3. Put the **concept DOI** into:
   - `CITATION.cff` (uncomment the `doi:` line),
   - `core/src/citation.js` (`DATA_SOURCES.tool` — replaces "DOI pending"),
   - the app's "How to cite" box picks it up from there automatically.
4. Commit, and tag `v0.1.1` if you changed files after the archived tag.

## 4. Submit **[you]**

1. Preview the paper first: <https://preview.openjournals.org> (paste the repo
   URL/branch; it compiles `core/paper/paper.md`).
2. Submit at <https://joss.theoj.org/papers/new>: repository URL, branch,
   software version (v0.1.0), and the Zenodo archive DOI.
3. Suggested review topics/tags: `oceanography`, `cartography`, `JavaScript`,
   `visualization`, `reproducibility`.

## 5. What JOSS reviewers will check (be ready)

- Install/run from a clean machine using only the README (it is: `git clone`,
  `cd core`, `npm test` — no installs).
- Substantial scholarly effort: point at the journal-spec engine + script
  generators + 155-test suite + the deployed application.
- Claims in the paper match the software (they do — keep them in sync if the
  API changes during review).
- An example they can execute: `scripts/example-figure.py` / `.R` and the live
  app both serve; the README shows a library-level snippet too.

## 6. After acceptance

- Add the JOSS DOI badge to `core/README.md`, cite the JOSS paper from the
  site, and add the paper to the app's "How to cite" box as the preferred
  software citation.
