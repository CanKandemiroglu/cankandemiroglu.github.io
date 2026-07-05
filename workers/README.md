# /workers — optional paid render queue (Phase 3, not yet built)

Placeholder for the optional server-render path from the product spec:
a Cloudflare Worker that queues a figure job, hands it to a small PyGMT
container (see `/render`), and returns the finished publication file as a
pay-per-export artifact.

Deliberately empty in Phase 1 — the free path (client export + PyGMT/R
script export) ships first and is the citable core of the tool. Nothing in
`/app` or `/core` depends on this directory.
