# /workers — optional paid render queue + checkout (Phase 3)

This is the **paid** server-render path from the product spec. It is fully
scaffolded but **not deployed** — the free path (client-side PNG/PDF/SVG export
plus the downloadable PyGMT/R script) is the core of the tool and needs none of
this. Ship this only if you want to sell a "finished publication file" to users
who won't run code locally; the per-export fee covers the render compute.

```
render-queue/
  wrangler.toml     Cloudflare Worker config (queue + R2 + KV bindings)
  src/index.js      /checkout, /webhook (Stripe), /status endpoints
```

The Worker enqueues a paid render job and hands back a Stripe (or Lemon
Squeezy) checkout URL; on `checkout.session.completed` it verifies the webhook
signature, marks the job paid, and pushes it onto the `marine-render-jobs`
queue. The container in [`/render`](../render/) consumes the queue, runs PyGMT,
writes the file to R2, and flips the job status to `done`.

## Deploying to your Cloudflare account

You already host the site on Cloudflare, so this drops in alongside it. From a
machine where you're logged in (`wrangler login`):

```sh
cd workers/render-queue
npm i -g wrangler
wrangler queues create marine-render-jobs
wrangler r2 bucket create marine-render-out
wrangler kv namespace create JOBS         # paste the id into wrangler.toml
wrangler secret put STRIPE_SECRET_KEY      # from dashboard.stripe.com
wrangler secret put STRIPE_WEBHOOK_SECRET  # from the webhook you create below
wrangler deploy
```

Then in the Stripe dashboard add a webhook to `https://<your-worker>/webhook`
for the `checkout.session.completed` event, and set the app's render endpoint
to the deployed Worker URL. Set `ALLOWED_ORIGIN`, `PRICE_CENTS`, and `CURRENCY`
in `wrangler.toml` to match your product.

**Lemon Squeezy instead of Stripe** (merchant-of-record; handles EU/German VAT
for you): swap the `/checkout` call for a Lemon Squeezy checkout create and the
`/webhook` verifier for their `X-Signature` HMAC — the job/queue plumbing is
identical.

## What I could not do from the build session

I don't have access to your Cloudflare, Stripe, or Zenodo accounts and can't run
the interactive `wrangler login` / OAuth flows, so nothing here is live. The
code is deploy-ready; run the steps above when you want to turn the paid tier
on. Keep single publication-quality figures free forever — that's the citation
engine.
