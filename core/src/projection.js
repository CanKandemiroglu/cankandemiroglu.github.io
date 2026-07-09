/**
 * projection.js — projection auto-suggestion by latitude and extent.
 *
 * The browser preview is always Web Mercator, but exported PyGMT/R scripts
 * should use a projection suited to the mapped region: Mercator is fine in
 * the tropics, badly distorted at the poles, and sub-optimal for wide
 * mid-latitude bands. This module inspects a geographic bounds object and
 * deterministically suggests one of five GMT projections, returning a
 * ready-to-substitute `-J` template for the script generator.
 *
 * Everything here is a pure function of its inputs — no I/O, no clock, no
 * randomness — so the same bounds always yield the same suggestion.
 *
 * Conventions (shared across the library):
 * - Bounds are `{west, south, east, north}` in degrees, WGS84.
 * - `west > east` means the region crosses the antimeridian; internally the
 *   east edge is treated as `east + 360`.
 * - The returned `gmt` string is a TEMPLATE containing the literal token
 *   `WIDTH`, which the script generator replaces with a physical width such
 *   as `16c` (e.g. `-JN15/WIDTH` becomes `-JN15/16c`).
 */

/** Longitude span (degrees) at or above which a region counts as global. */
const GLOBAL_LON_SPAN = 300;

/** Absolute centre latitude (degrees) at or above which a region counts as polar. */
const POLAR_LAT = 65;

/** Absolute centre latitude (degrees) at or above which a region counts as mid-latitude. */
const MIDLAT_LAT = 25;

/**
 * Fraction of the latitude span by which Lambert standard parallels are
 * inset from the south and north bounds (the classic "one-sixth rule").
 */
const STD_PARALLEL_INSET = 1 / 6;

/**
 * Round a degree value to 1 decimal and render it as a compact string for
 * embedding in a GMT `-J` template (`15` rather than `15.0`, never `-0`).
 *
 * @param {number} deg - Angle in degrees.
 * @returns {string} The rounded value as a string.
 */
function fmtDeg(deg) {
  const r = Math.round(deg * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * Validate a bounds object and derive the quantities the rules operate on.
 * Antimeridian-crossing boxes (`west > east`) are unfolded by adding 360 to
 * the east edge; the derived centre longitude is normalised back into
 * (-180, 180].
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @returns {{centerLon: number, centerLat: number, lonSpan: number,
 *   latSpan: number, crossesAntimeridian: boolean}}
 * @throws {TypeError} If bounds is not an object of four finite numbers.
 * @throws {RangeError} If latitudes are out of [-90, 90] or south >= north.
 */
function analyzeBounds(bounds) {
  if (bounds === null || typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new TypeError('bounds must be an object {west, south, east, north}');
  }
  for (const key of ['west', 'south', 'east', 'north']) {
    if (!Number.isFinite(bounds[key])) {
      throw new TypeError(`bounds.${key} must be a finite number (degrees)`);
    }
  }
  const { west, south, east, north } = bounds;
  if (south < -90 || north > 90) {
    throw new RangeError('latitudes must lie within [-90, 90]');
  }
  if (south >= north) {
    throw new RangeError('bounds.south must be less than bounds.north');
  }

  const crossesAntimeridian = west > east;
  const unfoldedEast = crossesAntimeridian ? east + 360 : east;
  const lonSpan = unfoldedEast - west;
  const latSpan = north - south;

  let centerLon = (west + unfoldedEast) / 2;
  if (centerLon > 180) centerLon -= 360;
  const centerLat = (south + north) / 2;

  return { centerLon, centerLat, lonSpan, latSpan, crossesAntimeridian };
}

/**
 * Suggest a map projection for a geographic region, for use in exported
 * PyGMT/R scripts (the on-screen preview always stays Web Mercator).
 *
 * The rules are evaluated in order and are fully deterministic:
 * 1. Global (lonSpan >= 300°): Robinson.
 * 2. Polar (|centre latitude| >= 65°): polar stereographic on the nearer pole.
 * 3. Mid-latitude, wider than tall (25° <= |centre latitude| < 65°,
 *    lonSpan >= latSpan): Lambert conformal conic with standard parallels
 *    inset 1/6 of the latitude span from the south and north bounds.
 * 4. Mid-latitude, taller than wide: transverse Mercator.
 * 5. Otherwise (tropics / default): Mercator, matching the preview.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds -
 *   Region of interest in degrees, WGS84. `west > east` denotes an
 *   antimeridian-crossing box and is handled by unfolding east to east + 360.
 * @returns {{id: string, name: string, gmt: string, note: string,
 *   rationale: string}} The suggestion. `gmt` is a GMT `-J` template whose
 *   literal `WIDTH` token the script generator replaces (e.g. with `16c`);
 *   all lon/lat parameters in it are rounded to 1 decimal. `note` describes
 *   the projection's use; `rationale` explains in one sentence why it was
 *   chosen for these bounds.
 * @throws {TypeError|RangeError} If bounds is malformed (see message).
 */
export function suggestProjection(bounds) {
  const { centerLon, centerLat, lonSpan, latSpan, crossesAntimeridian } =
    analyzeBounds(bounds);

  const lon = fmtDeg(centerLon);
  const lat = fmtDeg(centerLat);
  const absLat = Math.abs(centerLat);

  let result;
  if (lonSpan >= GLOBAL_LON_SPAN) {
    result = {
      id: 'robinson',
      name: 'Robinson',
      gmt: `-JN${lon}/WIDTH`,
      note:
        'Pseudo-cylindrical compromise projection for global overview maps; ' +
        'neither conformal nor equal-area, but visually balanced worldwide.',
      rationale:
        `longitude span ${fmtDeg(lonSpan)}° is near-global — the Robinson ` +
        'projection presents the whole world with balanced shape and area distortion',
    };
  } else if (absLat >= POLAR_LAT) {
    const pole = centerLat >= 0 ? '90' : '-90';
    result = {
      id: 'polar-stereographic',
      name: 'Polar stereographic',
      gmt: `-JS${lon}/${pole}/WIDTH`,
      note:
        'Conformal azimuthal projection centred on the pole; the standard ' +
        'choice for Arctic and Antarctic maps.',
      rationale:
        `centre latitude ${lat}° — a polar stereographic projection avoids ` +
        'extreme Mercator distortion near the pole',
    };
  } else if (absLat >= MIDLAT_LAT && lonSpan >= latSpan) {
    const inset = latSpan * STD_PARALLEL_INSET;
    const stdLat1 = fmtDeg(bounds.south + inset);
    const stdLat2 = fmtDeg(bounds.north - inset);
    result = {
      id: 'lambert-conic',
      name: 'Lambert conformal conic',
      gmt: `-JL${lon}/${lat}/${stdLat1}/${stdLat2}/WIDTH`,
      note:
        'Conformal conic projection; scale is true along the two standard ' +
        `parallels (${stdLat1}° and ${stdLat2}°), ideal for east–west ` +
        'elongated mid-latitude regions.',
      rationale:
        `centre latitude ${lat}° with an east–west dominant extent — a Lambert ` +
        'conformal conic with standard parallels inside the region keeps scale ' +
        'distortion low across the mid-latitude band',
    };
  } else if (absLat >= MIDLAT_LAT) {
    result = {
      id: 'transverse-mercator',
      name: 'Transverse Mercator',
      gmt: `-JT${lon}/WIDTH`,
      note:
        'Conformal cylindrical projection with scale true along the central ' +
        'meridian; suited to north–south elongated regions.',
      rationale:
        `centre latitude ${lat}° with a north–south dominant extent — a ` +
        'transverse Mercator keeps distortion low along the central meridian',
    };
  } else {
    result = {
      id: 'mercator',
      name: 'Mercator',
      gmt: '-JMWIDTH',
      note:
        'Conformal cylindrical projection that matches the Web Mercator ' +
        'on-screen preview; distortion is minimal at low latitudes.',
      rationale:
        `centre latitude ${lat}° lies in the low latitudes, where Mercator ` +
        'distortion is small and the exported map matches the on-screen preview',
    };
  }

  if (crossesAntimeridian) {
    result.rationale +=
      '; the region crosses the antimeridian, so the east bound was treated ' +
      `as ${fmtDeg(bounds.east + 360)}°`;
  }

  return result;
}
