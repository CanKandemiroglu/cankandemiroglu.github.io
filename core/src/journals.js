/**
 * journals.js — deterministic journal figure-spec engine.
 *
 * Turns a journal "record" (see data/journals/<id>.json and the accompanying
 * JSON Schema) into a concrete, reproducible export configuration for a marine
 * map figure: physical width, resolution, file format, colour mode, and a set
 * of human-readable warnings. Everything here is a pure function of its inputs —
 * no I/O, no clock, no randomness — so the same record always yields the same
 * config, which is what makes published figures reproducible.
 *
 * Records are snake_case (they come straight from the product spec / JSON on
 * disk); the export config this module returns is camelCase for JS consumers.
 *
 * Geographic bounds and page geometry conventions follow the rest of the
 * library: linear dimensions are millimetres, resolutions are dpi.
 */

/** Colour modes a record may declare. */
const VALID_COLOUR_MODES = ['RGB', 'CMYK', 'RGB or CMYK'];

/** Sentinel in `last_verified` that marks a record as an unverified default. */
const UNVERIFIED_SENTINEL = 'VERIFY-BEFORE-SHIP';

/**
 * Warning shown whenever a target expects (or allows) CMYK. cmocean colormaps
 * are sampled in RGB, and the RGB→CMYK gamut conversion is not perceptually
 * uniform, so we advise exporting RGB and letting the publisher convert.
 */
const CMYK_WARNING =
  'cmocean colormaps are defined in RGB; perceptual uniformity degrades in ' +
  'CMYK conversion — export RGB and let the publisher convert, or check ' +
  'proofs carefully.';

/**
 * Generic, journal-agnostic export configuration for the "no journal selected"
 * case. Frozen so callers cannot mutate the shared default. Mirrors the shape
 * produced by {@link selectJournal} (minus the per-record identity fields that
 * do not apply when no journal is chosen).
 * @type {Readonly<object>}
 */
export const FALLBACK_SPEC = Object.freeze({
  journalId: null,
  journalTitle: 'Generic (no journal)',
  publisher: null,
  widthMm: 180,
  maxHeightMm: 240,
  dpi: 600,
  format: 'pdf',
  formatsAccepted: Object.freeze(['pdf', 'png', 'svg']),
  colourMode: 'RGB',
  minFontPt: 7,
  fontFamilyHint: 'Arial/Helvetica',
  sourceUrl: null,
  lastVerified: null,
  warnings: Object.freeze([]),
});

/**
 * Validate a journal record against the required shape.
 *
 * Checks presence and basic sanity of every field the engine relies on. This is
 * a runtime companion to data/journals/schema.json: it is deliberately lenient
 * about extra fields but strict about the ones {@link selectJournal} reads.
 *
 * @param {object} rec - The journal record to validate.
 * @returns {{ valid: boolean, errors: string[] }} `valid` is true only when
 *   `errors` is empty; each error is a human-readable message.
 */
export function validateJournalRecord(rec) {
  const errors = [];

  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
    return { valid: false, errors: ['record must be an object'] };
  }

  if (!isNonEmptyString(rec.id)) errors.push('id must be a non-empty string');
  if (!isNonEmptyString(rec.title)) errors.push('title must be a non-empty string');
  if (!isNonEmptyString(rec.publisher)) errors.push('publisher must be a non-empty string');

  if (!isObject(rec.canvas)) {
    errors.push('canvas must be an object');
  } else {
    if (!isPositiveNumber(rec.canvas.single_column_mm)) {
      errors.push('canvas.single_column_mm must be a number > 0');
    }
    if (!isPositiveNumber(rec.canvas.double_column_mm)) {
      errors.push('canvas.double_column_mm must be a number > 0');
    }
  }

  if (!isObject(rec.map_target)) {
    errors.push('map_target must be an object');
  } else {
    if (!isNonEmptyString(rec.map_target.recommended_format)) {
      errors.push('map_target.recommended_format must be a non-empty string');
    }
    if (!isFiniteNumber(rec.map_target.recommended_dpi) || rec.map_target.recommended_dpi < 150) {
      errors.push('map_target.recommended_dpi must be a number >= 150');
    }
  }

  if (!Array.isArray(rec.formats_accepted) || rec.formats_accepted.length === 0) {
    errors.push('formats_accepted must be a non-empty array');
  }

  if (!VALID_COLOUR_MODES.includes(rec.colour_mode)) {
    errors.push(`colour_mode must be one of ${VALID_COLOUR_MODES.map((m) => `'${m}'`).join(', ')}`);
  }

  if (!isPositiveNumber(rec.min_font_pt)) {
    errors.push('min_font_pt must be a number > 0');
  }

  if (!isNonEmptyString(rec.source_url)) errors.push('source_url must be a non-empty string');
  if (!isNonEmptyString(rec.last_verified)) errors.push('last_verified must be a non-empty string');

  return { valid: errors.length === 0, errors };
}

/**
 * Resolve a journal record into a deterministic export configuration.
 *
 * @param {object} rec - A journal record (see the JSON Schema). Assumed to be
 *   structurally valid; run {@link validateJournalRecord} first if the source
 *   is untrusted.
 * @param {object} [opts] - Selection options.
 * @param {1|2} [opts.columns=2] - Figure width: 1 = single column, otherwise
 *   double/full column.
 * @param {string|null} [opts.format=null] - Requested file format. Used when it
 *   is one of the journal's accepted formats; otherwise the journal's
 *   recommended format is used and a warning is emitted.
 * @returns {{
 *   journalId: string, journalTitle: string, publisher: string,
 *   widthMm: number, maxHeightMm: number|null, dpi: number, format: string,
 *   formatsAccepted: string[], colourMode: string, minFontPt: number,
 *   fontFamilyHint: string|null, sourceUrl: string, lastVerified: string,
 *   warnings: string[]
 * }} The export configuration.
 */
export function selectJournal(rec, { columns = 2, format = null } = {}) {
  const warnings = [];

  const widthMm = columns === 1 ? rec.canvas.single_column_mm : rec.canvas.double_column_mm;
  const maxHeightMm =
    isFiniteNumber(rec.canvas?.max_height_mm) ? rec.canvas.max_height_mm : null;

  const formatsAccepted = rec.formats_accepted;
  const recommendedFormat = rec.map_target.recommended_format;

  let format_ = recommendedFormat;
  if (format != null) {
    if (formatsAccepted.includes(format)) {
      format_ = format;
    } else {
      warnings.push(
        `Requested format "${format}" is not accepted by ${rec.title}; ` +
          `falling back to the recommended format "${recommendedFormat}". ` +
          `Accepted formats: ${formatsAccepted.join(', ')}.`,
      );
    }
  }

  if (typeof rec.colour_mode === 'string' && rec.colour_mode.includes('CMYK')) {
    warnings.push(CMYK_WARNING);
  }

  if (rec.last_verified === UNVERIFIED_SENTINEL) {
    warnings.push(
      `This journal spec is an unverified default (last_verified = ` +
        `"${UNVERIFIED_SENTINEL}"); confirm the current author guidelines at ` +
        `${rec.source_url} before submitting.`,
    );
  }

  return {
    journalId: rec.id,
    journalTitle: rec.title,
    publisher: rec.publisher,
    widthMm,
    maxHeightMm,
    dpi: rec.map_target.recommended_dpi,
    format: format_,
    formatsAccepted,
    colourMode: rec.colour_mode,
    minFontPt: rec.min_font_pt,
    fontFamilyHint: rec.font_family_hint ?? null,
    sourceUrl: rec.source_url,
    lastVerified: rec.last_verified,
    warnings,
  };
}

/**
 * Check a proposed font size against a journal's minimum.
 *
 * @param {number} fontPt - The font size in points to check.
 * @param {number} minFontPt - The journal's minimum font size in points.
 * @returns {{ ok: boolean, message: string|null }} `ok` is true when
 *   `fontPt >= minFontPt`; `message` is null when ok, otherwise an explanation.
 */
export function checkFontFloor(fontPt, minFontPt) {
  const ok = isFiniteNumber(fontPt) && isFiniteNumber(minFontPt) && fontPt >= minFontPt;
  if (ok) return { ok: true, message: null };
  return {
    ok: false,
    message:
      `Label font size ${fontPt} pt is below the journal minimum of ` +
      `${minFontPt} pt; enlarge labels or reduce the number of annotations.`,
  };
}

/* ---------------------------------------------------------------- helpers -- */

/** @returns {boolean} true if `v` is a plain (non-array) object. */
function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @returns {boolean} true if `v` is a finite number. */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** @returns {boolean} true if `v` is a finite number strictly greater than 0. */
function isPositiveNumber(v) {
  return isFiniteNumber(v) && v > 0;
}

/** @returns {boolean} true if `v` is a string with non-whitespace content. */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
