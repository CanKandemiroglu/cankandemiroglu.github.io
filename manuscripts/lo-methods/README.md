# L&O: Methods manuscript (Phase 2 draft)

`manuscript.md` is the working draft of the *Limnology & Oceanography:
Methods* paper describing the Marine Map Tool and `marine-map-core`. It
follows the journal's section structure (Abstract, Introduction, Materials
and Procedures, Assessment, Discussion, Comments and Recommendations).

## Before submission

Search the draft for `TODO:` — each marks something only the author can
supply or decide:

1. **Affiliation & correspondence** — institutional line and email for print.
2. **Figures** (all three are producible with the tool itself):
   - Fig. 1: architecture schematic (redraw the diagram from the product spec).
   - Fig. 2: Black Sea demo export at the L&O:M 168 mm / 600 dpi spec
     (load demo stations in the app → select *Limnology & Oceanography:
     Methods* → export PDF).
   - Fig. 3: the same figure state rendered by the exported PyGMT script
     (run `marine_map_figure.py` locally) for the browser/script A-B panel.
3. **Assessment** — optionally add a small time-to-figure user comparison;
   everything currently claimed is backed by the repo's tests.
4. **Zenodo DOI** — mint with the first tagged release (see
   `core/paper/SUBMISSION-CHECKLIST.md` step 3) and fill it in.
5. **Abstract length** — trim to the journal's word limit on the final pass.
6. Verify the journal-spec records you cite ship without the
   `VERIFY-BEFORE-SHIP` sentinel (our own checklist item).

Note: L&O:M is itself one of the journal records in `/data/journals` — the
figures for this paper should be exported with its own spec selected. That is
the demo.
