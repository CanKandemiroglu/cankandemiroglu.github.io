/**
 * assistant.js — OPTIONAL, non-core cartography-assistant prompt builder.
 *
 * This module is entirely optional: marine-map-core works fully with the
 * assistant disabled, and nothing else in the library depends on it. It builds
 * *request payloads and grounding prompts only* — it performs NO network calls.
 * The browser is expected to POST the returned body to the Anthropic Messages
 * API using the user's own key (BYOK); this file never sees or stores a key
 * beyond copying it into a headers object at the caller's request.
 *
 * The assistant is retrieval-augmented and deliberately un-creative about facts:
 * journal specifications ALWAYS come from the verified JSON record passed in,
 * never from the model's free recall. The system prompt pins the model to the
 * supplied CONTEXT and forbids inventing dpi, dimensions, formats, or colour
 * requirements. If a record is absent, the prompt fabricates no journal facts
 * and instead tells the model to send the user to pick a journal or read the
 * journal's own author guidelines.
 *
 * Pure ES module: no DOM, no fetch, no dependencies.
 */

/** Anthropic Messages API endpoint the browser POSTs to (BYOK). */
export const ANTHROPIC_MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** Anthropic API version header value. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** Default model id used when the caller does not choose one. */
export const DEFAULT_ASSISTANT_MODEL = 'claude-opus-4-8';

/**
 * Selectable models for a UI dropdown, ordered most → least capable.
 * Frozen so callers cannot mutate the shared list.
 * @type {ReadonlyArray<{ id: string, label: string }>}
 */
export const ASSISTANT_MODELS = Object.freeze([
  Object.freeze({ id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)' }),
  Object.freeze({ id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (balanced)' }),
  Object.freeze({ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest, cheapest)' }),
]);

/** Default minimum label font (pt) used when no journal record is available. */
const DEFAULT_MIN_FONT_PT = 7;

/**
 * The invariant cartographic "ground truth" block appended to every system
 * prompt. These statements are always true regardless of the target journal;
 * only the min-font figure is journal-dependent.
 *
 * @param {number} minFontPt - Minimum label font size in points at final size.
 * @returns {string} The ground-truth block.
 */
function groundTruthBlock(minFontPt) {
  return (
    'Cartographic ground truth (always true):\n' +
    '- Maps are combination figures -> 600 dpi or vector PDF.\n' +
    '- cmocean is RGB and perceptually uniform; CMYK conversion degrades it.\n' +
    `- Recommend colourblind-safe cmocean maps; label font >= ${minFontPt} pt at final size.`
  );
}

/**
 * Build the grounded system prompt that pins the assistant to a verified
 * journal record (retrieval-augmented generation).
 *
 * When `journalRecord` is null/absent, a generic prompt is produced that
 * fabricates NO journal facts: it tells the model there is no verified spec and
 * to advise the user to pick a journal or read the journal's own guidelines.
 * The cartographic ground-truth block is always included (with a sensible
 * default minimum font of 7 pt when no record supplies one).
 *
 * @param {object|null} journalRecord - A verified journal JSON record (snake_case,
 *   as shipped in data/journals/*.json), or null/undefined when none is chosen.
 * @param {object} [options] - Prompt options.
 * @param {string} [options.guidelinesExcerpt=''] - Optional short excerpt of the
 *   journal's author guidelines to include verbatim in the CONTEXT.
 * @returns {string} The system prompt string.
 */
export function buildAssistantSystemPrompt(journalRecord, { guidelinesExcerpt = '' } = {}) {
  const excerpt = typeof guidelinesExcerpt === 'string' ? guidelinesExcerpt.trim() : '';

  if (!isRecord(journalRecord)) {
    return [
      'You are a cartography assistant for scientific figures. Answer ONLY from the CONTEXT below.',
      'No journal has been selected, so there is no verified specification to answer from. Do not',
      'invent dpi, dimensions, formats, or colour requirements for any journal; instead advise the',
      "user to pick a journal from the tool's list or to check the journal's current author",
      'guidelines directly.',
      '',
      groundTruthBlock(DEFAULT_MIN_FONT_PT),
    ].join('\n');
  }

  const title = journalRecord.title;
  const lastVerified = journalRecord.last_verified;
  const sourceUrl = journalRecord.source_url;
  const minFontPt = isFiniteNumber(journalRecord.min_font_pt)
    ? journalRecord.min_font_pt
    : DEFAULT_MIN_FONT_PT;

  const contextLines = [
    `CONTEXT (verified spec for ${title}, last_verified ${lastVerified}):`,
    JSON.stringify(journalRecord, null, 2),
  ];
  if (excerpt) contextLines.push(excerpt);

  return [
    'You are a cartography assistant for scientific figures. Answer ONLY from the CONTEXT below.',
    'If the context does not contain the answer, say "Check the journal\'s current author guidelines:',
    `${sourceUrl}." Never invent dpi, dimensions, formats, or colour requirements.`,
    '',
    contextLines.join('\n'),
    '',
    groundTruthBlock(minFontPt),
  ].join('\n');
}

/**
 * Build the request body for a POST to the Anthropic Messages API (/v1/messages).
 *
 * This returns a plain object only — it performs no network I/O. The caller is
 * responsible for POSTing it with {@link anthropicHeaders} to
 * {@link ANTHROPIC_MESSAGES_ENDPOINT} using their own API key.
 *
 * @param {object} params - Request parameters.
 * @param {object|null} [params.record=null] - Verified journal record grounding
 *   the answer, or null for the generic prompt.
 * @param {string} params.question - The user's new question. Must be non-blank.
 * @param {Array<{role: 'user'|'assistant', text: string}>} [params.history=[]] -
 *   Prior conversation turns, in order. Each is converted to a Messages-API
 *   content block; the new `question` is appended as the final user message.
 * @param {string} [params.model=DEFAULT_ASSISTANT_MODEL] - Model id.
 * @param {number} [params.maxTokens=1024] - `max_tokens` for the response.
 * @param {string} [params.guidelinesExcerpt=''] - Optional guidelines excerpt
 *   forwarded to {@link buildAssistantSystemPrompt}.
 * @returns {{ model: string, max_tokens: number, system: string,
 *   messages: Array<{role: string, content: Array<{type: 'text', text: string}>}> }}
 *   The request body.
 * @throws {Error} If `question` is empty or blank.
 */
export function buildAssistantRequest({
  record = null,
  question,
  history = [],
  model = DEFAULT_ASSISTANT_MODEL,
  maxTokens = 1024,
  guidelinesExcerpt = '',
} = {}) {
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new Error('buildAssistantRequest: question must be a non-empty string');
  }

  const turns = Array.isArray(history) ? history : [];
  const messages = turns.map((turn, i) => {
    if (!isRecord(turn) || (turn.role !== 'user' && turn.role !== 'assistant')) {
      throw new Error(
        `buildAssistantRequest: history[${i}].role must be 'user' or 'assistant'`,
      );
    }
    if (typeof turn.text !== 'string') {
      throw new Error(`buildAssistantRequest: history[${i}].text must be a string`);
    }
    return textMessage(turn.role, turn.text);
  });

  messages.push(textMessage('user', question));

  return {
    model,
    max_tokens: maxTokens,
    system: buildAssistantSystemPrompt(record, { guidelinesExcerpt }),
    messages,
  };
}

/**
 * Build the HTTP headers the browser fetch needs to call the Messages API
 * directly with the user's own key (BYOK).
 *
 * @param {string} apiKey - The user's Anthropic API key. Never persisted here.
 * @returns {{ 'content-type': string, 'x-api-key': string,
 *   'anthropic-version': string, 'anthropic-dangerous-direct-browser-access': string }}
 *   The headers object.
 * @throws {Error} If `apiKey` is empty or blank.
 */
export function anthropicHeaders(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('anthropicHeaders: apiKey must be a non-empty string');
  }
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/**
 * Concatenate the text of every `type: 'text'` content block in a Messages API
 * response. Non-text blocks (e.g. `thinking`, `tool_use`) and malformed entries
 * are ignored.
 *
 * @param {{ content?: Array<{ type?: string, text?: string }> }} responseJson -
 *   A parsed /v1/messages response body.
 * @returns {string} The joined text, or '' when there are no text blocks.
 */
export function extractAssistantText(responseJson) {
  const content = responseJson && Array.isArray(responseJson.content)
    ? responseJson.content
    : [];
  return content
    .filter((block) => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/* ---------------------------------------------------------------- helpers -- */

/** @returns {{role: string, content: Array<{type: 'text', text: string}>}} */
function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }] };
}

/** @returns {boolean} true if `v` is a plain (non-array) object. */
function isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @returns {boolean} true if `v` is a finite number. */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
