/**
 * terrain.js — Terrarium-encoded DEM tile decoding and colormap shading.
 *
 * Terrarium PNG encoding (AWS Terrain Tiles / Mapzen):
 *   elevation_m = (R * 256 + G + B / 256) - 32768
 * which resolves 1/256 m steps over [-32768, 32767.99609375] m.
 *
 * Pure array math over RGBA pixel buffers (ImageData.data in the browser,
 * plain typed arrays in tests) — no DOM, no I/O.
 */

/** Elevation offset baked into the terrarium encoding, metres. */
const TERRARIUM_OFFSET = 32768;

/** Largest encodable value in 1/256 m units (2^24 - 1). */
const MAX_CODE = 0xffffff;

/**
 * Decode one terrarium-encoded pixel to elevation.
 *
 * @param {number} r Red channel value (0–255).
 * @param {number} g Green channel value (0–255).
 * @param {number} b Blue channel value (0–255).
 * @returns {number} Elevation in metres.
 */
export function terrariumToElevation(r, g, b) {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET;
}

/**
 * Encode an elevation as a terrarium RGB triplet (inverse of
 * {@link terrariumToElevation}). Values are rounded to the nearest 1/256 m
 * and clamped to the encodable range [-32768, 32767.99609375] m, so the
 * round trip is exact for any in-range multiple of 1/256 m (all integers
 * included).
 *
 * @param {number} meters Elevation in metres (±Infinity clamps; NaN throws).
 * @returns {number[]} [r, g, b] integers, each 0–255.
 */
export function elevationToTerrarium(meters) {
  if (typeof meters !== 'number' || Number.isNaN(meters)) {
    throw new TypeError('elevationToTerrarium: meters must be a number');
  }
  let code = Math.round((meters + TERRARIUM_OFFSET) * 256);
  if (code < 0) code = 0;
  else if (code > MAX_CODE) code = MAX_CODE;
  return [code >>> 16, (code >>> 8) & 0xff, code & 0xff];
}

/**
 * Elevation range of a terrarium RGBA tile. Fully transparent pixels
 * (alpha === 0) are ignored — decoded tiles use them for nodata.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba Pixel buffer, length divisible by 4.
 * @returns {{min: number, max: number}} Elevation extremes in metres;
 *   both NaN when every pixel is transparent (or the buffer is empty).
 */
export function terrariumStats(rgba) {
  assertRGBA(rgba, 'terrariumStats');
  let min = Infinity;
  let max = -Infinity;
  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] === 0) continue;
    const e = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - TERRARIUM_OFFSET;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  return min === Infinity ? { min: NaN, max: NaN } : { min, max };
}

/**
 * Recolour a terrarium RGBA tile in place through a 256-entry RGB LUT
 * (e.g. from cmocean getLUT()).
 *
 * Water (elevation ≤ 0) maps onto the LUT with
 *   t = (max - min) === 0 ? 0 : (max - clamp(e, min, max)) / (max - min)
 * so t = 0 (LUT index 0) is the shallowest colour at e === max, and index
 * 255 the deepest at e === min; index = round(t * 255), alpha = 255.
 *
 * Land (elevation > 0) is, in order of precedence:
 *   - hypsometric: coloured through opts.landLut with
 *     t = clamp(e, 0, landMax) / landMax, alpha 255 (overrides opts.land);
 *   - land 'flat': painted opts.landColor, alpha 255;
 *   - land 'transparent': alpha set to 0 (RGB left as-is).
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba Pixel buffer, length divisible by 4;
 *   modified in place.
 * @param {Uint8Array|number[]} lut Water colormap: ≥768 values (256 RGB triplets).
 * @param {object} [opts]
 * @param {number} [opts.min=-8000] Elevation mapped to LUT index 255 (deep), metres.
 * @param {number} [opts.max=0] Elevation mapped to LUT index 0 (shallow), metres.
 * @param {'flat'|'transparent'} [opts.land='flat'] Treatment of elevation > 0.
 * @param {number[]} [opts.landColor=[232, 229, 224]] RGB used when land is 'flat'.
 * @param {boolean} [opts.hypsometric=false] Colour land through a second LUT.
 * @param {number} [opts.landMax=3000] Elevation mapped to landLut index 255, metres.
 * @param {Uint8Array|number[]} [opts.landLut] Land colormap (≥768 values);
 *   required when hypsometric is true.
 * @returns {Uint8ClampedArray|Uint8Array} The same rgba buffer, recoloured.
 */
export function applyColormapToTerrarium(rgba, lut, opts = {}) {
  assertRGBA(rgba, 'applyColormapToTerrarium');
  assertLUT(lut, 'lut');
  const {
    min = -8000,
    max = 0,
    land = 'flat',
    landColor = [232, 229, 224],
    hypsometric = false,
    landMax = 3000,
    landLut,
  } = opts;
  if (hypsometric) {
    assertLUT(landLut, 'opts.landLut (required when hypsometric)');
  } else if (land !== 'flat' && land !== 'transparent') {
    throw new Error(
      `applyColormapToTerrarium: unknown land mode '${land}' (expected 'flat' or 'transparent')`,
    );
  }

  const range = max - min;
  for (let p = 0; p < rgba.length; p += 4) {
    const e = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - TERRARIUM_OFFSET;
    if (e <= 0) {
      const c = e < min ? min : e > max ? max : e;
      const t = range === 0 ? 0 : (max - c) / range;
      const i = clampIndex(Math.round(t * 255)) * 3;
      rgba[p] = lut[i];
      rgba[p + 1] = lut[i + 1];
      rgba[p + 2] = lut[i + 2];
      rgba[p + 3] = 255;
    } else if (hypsometric) {
      const t = landMax > 0 ? (e > landMax ? landMax : e) / landMax : 0;
      const i = clampIndex(Math.round(t * 255)) * 3;
      rgba[p] = landLut[i];
      rgba[p + 1] = landLut[i + 1];
      rgba[p + 2] = landLut[i + 2];
      rgba[p + 3] = 255;
    } else if (land === 'flat') {
      rgba[p] = landColor[0];
      rgba[p + 1] = landColor[1];
      rgba[p + 2] = landColor[2];
      rgba[p + 3] = 255;
    } else {
      rgba[p + 3] = 0;
    }
  }
  return rgba;
}

/**
 * Clamp a LUT index into [0, 255].
 * @param {number} i Candidate index.
 * @returns {number} Clamped index.
 */
function clampIndex(i) {
  return i < 0 ? 0 : i > 255 ? 255 : i;
}

/**
 * Validate an RGBA pixel buffer (array-like, length divisible by 4).
 * @param {*} rgba Candidate buffer.
 * @param {string} fn Calling function name for the error message.
 */
function assertRGBA(rgba, fn) {
  if (!rgba || typeof rgba.length !== 'number' || rgba.length % 4 !== 0) {
    throw new Error(`${fn}: rgba must be array-like with length divisible by 4`);
  }
}

/**
 * Validate a 256-entry RGB LUT (≥768 values).
 * @param {*} lut Candidate LUT.
 * @param {string} name Parameter name for the error message.
 */
function assertLUT(lut, name) {
  if (!lut || typeof lut.length !== 'number' || lut.length < 768) {
    throw new Error(
      `applyColormapToTerrarium: ${name} must contain at least 768 values (256 RGB triplets)`,
    );
  }
}
