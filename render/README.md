# /render — optional PyGMT render container (Phase 3, not yet built)

Placeholder for the optional server-side renderer: a small container image
with GMT 6 + PyGMT that executes the same script `/core` generates for users
and returns the finished file (vector PDF / TIFF at journal spec).

Licensing note (from the product spec): GMT core is LGPL — it is invoked
here as an external executable/service, never statically linked into or
bundled with the closed-source parts of the product.
