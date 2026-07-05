/**
 * cmocean.js — perceptually-uniform oceanographic colormaps for the browser.
 *
 * Data: cmocean (MIT), Thyng, K.M., Greene, C.A., Hetland, R.D., Zimmerle, H.M.
 * & DiMarco, S.F. (2016). True colors of oceanography: Guidelines for effective
 * and accurate colormap selection. Oceanography 29(3):9–13,
 * https://doi.org/10.5670/oceanog.2016.66
 */
import { CMOCEAN_DATA } from './cmocean-data.js';

const lutCache = new Map();

/** List available colormaps: [{ id, kind }] with kind sequential|diverging|cyclic|other. */
export function listColormaps() {
  return Object.entries(CMOCEAN_DATA).map(([id, { kind }]) => ({ id, kind }));
}

/**
 * Get a 256-entry RGB lookup table as a Uint8Array of length 768
 * (r0,g0,b0, r1,g1,b1, …). Cached; do not mutate the returned array.
 */
export function getLUT(id, { reverse = false } = {}) {
  const key = `${id}:${reverse ? 1 : 0}`;
  const hit = lutCache.get(key);
  if (hit) return hit;
  const entry = CMOCEAN_DATA[id];
  if (!entry) throw new Error(`Unknown cmocean colormap: ${id}`);
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    const src = reverse ? 255 - i : i;
    lut[i * 3] = parseInt(entry.hex.slice(src * 6, src * 6 + 2), 16);
    lut[i * 3 + 1] = parseInt(entry.hex.slice(src * 6 + 2, src * 6 + 4), 16);
    lut[i * 3 + 2] = parseInt(entry.hex.slice(src * 6 + 4, src * 6 + 6), 16);
  }
  lutCache.set(key, lut);
  return lut;
}

/** Sample a colormap at t ∈ [0,1] → [r, g, b] (0–255). Clamps t. */
export function sampleColormap(id, t, { reverse = false } = {}) {
  const lut = getLUT(id, { reverse });
  const i = Math.max(0, Math.min(255, Math.round(t * 255)));
  return [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];
}

/** CSS linear-gradient string for UI swatches. */
export function colormapCSSGradient(id, { reverse = false, stops = 16 } = {}) {
  const parts = [];
  for (let s = 0; s < stops; s++) {
    const t = s / (stops - 1);
    const [r, g, b] = sampleColormap(id, t, { reverse });
    parts.push(`rgb(${r},${g},${b}) ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/**
 * Colormap stops for style expressions: [[t0,[r,g,b]], …] with n evenly
 * spaced stops — useful for MapLibre interpolate expressions.
 */
export function colormapStops(id, { reverse = false, stops = 32 } = {}) {
  const out = [];
  for (let s = 0; s < stops; s++) {
    const t = s / (stops - 1);
    out.push([t, sampleColormap(id, t, { reverse })]);
  }
  return out;
}
