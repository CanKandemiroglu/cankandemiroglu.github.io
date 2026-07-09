/**
 * marine-render-queue — optional paid server-render endpoint (Phase 3).
 *
 * NOT DEPLOYED. Deploy to your own Cloudflare account per workers/README.md.
 *
 * Flow (pay-per-export; the fee covers the render compute):
 *   POST /checkout   { figureState }        -> { jobId, checkoutUrl }
 *   POST /webhook    (Stripe/Lemon Squeezy) -> marks the job paid, enqueues render
 *   GET  /status?job=<id>                    -> { status, downloadUrl? }
 *
 * The free path (client-side PNG/PDF/SVG + PyGMT/R script export) never touches
 * this Worker. This exists only for users who want a finished vector/TIFF file
 * without running code locally.
 *
 * The container in /render consumes RENDER_JOBS, runs PyGMT, writes the result
 * to R2 (RENDER_OUT) under the job key, and flips the job status to 'done'.
 */

const json = (obj, status = 200, origin = '*') =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || '*';
    if (request.method === 'OPTIONS') return json({}, 204, origin);

    try {
      if (url.pathname === '/checkout' && request.method === 'POST') {
        return await createCheckout(request, env, origin);
      }
      if (url.pathname === '/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env);
      }
      if (url.pathname === '/status' && request.method === 'GET') {
        return await jobStatus(url, env, origin);
      }
      return json({ error: 'not found' }, 404, origin);
    } catch (err) {
      return json({ error: String(err.message || err) }, 500, origin);
    }
  },

  /** Queue consumer entry — wired when the /render container isn't used. */
  async queue(batch, env) {
    for (const msg of batch.messages) {
      // The render container normally handles this; a Worker-side stub could
      // call an external PyGMT service here. Left intentionally unimplemented.
      console.log('render job received', msg.body?.jobId);
      msg.ack();
    }
  },
};

async function createCheckout(request, env, origin) {
  const { figureState } = await request.json();
  if (!figureState || typeof figureState !== 'object') {
    return json({ error: 'figureState required' }, 400, origin);
  }
  const jobId = crypto.randomUUID();
  const r2Key = `jobs/${jobId}/marine_map.pdf`;
  await env.JOBS.put(
    jobId,
    JSON.stringify({ status: 'awaiting_payment', r2Key, figureState, paid: false }),
    { expirationTtl: 60 * 60 * 24 }, // 24 h
  );

  // Create a Stripe Checkout Session (swap for Lemon Squeezy if you prefer a
  // merchant-of-record that handles EU VAT). Requires STRIPE_SECRET_KEY secret.
  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': env.CURRENCY || 'eur',
    'line_items[0][price_data][product_data][name]': 'Marine Map Tool — publication render',
    'line_items[0][price_data][unit_amount]': env.PRICE_CENTS || '300',
    'line_items[0][quantity]': '1',
    success_url: `${origin}/app/?render=${jobId}`,
    cancel_url: `${origin}/app/?render=cancelled`,
    'metadata[jobId]': jobId,
    client_reference_id: jobId,
  });
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const session = await resp.json();
  if (!resp.ok) return json({ error: session.error?.message || 'checkout failed' }, 502, origin);
  return json({ jobId, checkoutUrl: session.url }, 200, origin);
}

async function handleWebhook(request, env) {
  // Verify the Stripe signature (HMAC-SHA256 over `${timestamp}.${payload}`)
  // before trusting the event. Implemented with Web Crypto so it runs on
  // Workers. Set STRIPE_WEBHOOK_SECRET via `wrangler secret put`.
  const payload = await request.text();
  const sig = request.headers.get('stripe-signature') || '';
  const ok = await verifyStripe(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response('bad signature', { status: 400 });

  const event = JSON.parse(payload);
  // Only enqueue on a genuinely PAID session (delayed-notification methods can
  // fire completed while still 'unpaid'), and handle the settlement event too.
  const settled = (event.type === 'checkout.session.completed'
    || event.type === 'checkout.session.async_payment_succeeded')
    && event.data.object.payment_status === 'paid';
  if (settled) {
    const jobId = event.data.object.metadata?.jobId
      || event.data.object.client_reference_id;
    const raw = jobId && (await env.JOBS.get(jobId));
    if (raw) {
      const job = JSON.parse(raw);
      // Idempotent: a duplicate/replayed delivery must not re-enqueue compute.
      if (job.status !== 'queued' && job.status !== 'done') {
        job.paid = true;
        job.status = 'queued';
        await env.JOBS.put(jobId, JSON.stringify(job), { expirationTtl: 60 * 60 * 24 });
        await env.RENDER_JOBS.send({ jobId, r2Key: job.r2Key, figureState: job.figureState });
      }
    }
  }
  return new Response('ok', { status: 200 });
}

async function jobStatus(url, env, origin) {
  const jobId = url.searchParams.get('job');
  const raw = jobId && (await env.JOBS.get(jobId));
  if (!raw) return json({ error: 'unknown job' }, 404, origin);
  const job = JSON.parse(raw);
  const out = { status: job.status };
  if (job.status === 'done') {
    // Presign a short-lived R2 GET (r2 signed URL via the S3-compatible API,
    // or serve through this Worker). Placeholder: serve via a /download route.
    out.downloadUrl = `${url.origin}/download?job=${jobId}`;
  }
  return json(out, 200, origin);
}

const WEBHOOK_TOLERANCE_S = 300; // Stripe's default replay window

/** Verify a Stripe webhook signature with timestamp freshness + constant-time compare. */
async function verifyStripe(payload, header, secret) {
  if (!secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  // Reject stale or future-dated signatures (replay protection).
  if (Math.abs(Date.now() / 1000 - t) > WEBHOOK_TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, v1);
}

/** Length-checked, non-early-exit string comparison. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
