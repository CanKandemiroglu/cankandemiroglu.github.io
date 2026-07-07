import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANTHROPIC_MESSAGES_ENDPOINT,
  ANTHROPIC_VERSION,
  DEFAULT_ASSISTANT_MODEL,
  ASSISTANT_MODELS,
  buildAssistantSystemPrompt,
  buildAssistantRequest,
  anthropicHeaders,
  extractAssistantText,
} from '../src/assistant.js';

/**
 * A trimmed but realistic journal record, snake_case exactly as the shipped
 * data/journals/*.json files are shaped.
 */
const RECORD = {
  id: 'deep-sea-research-part-i',
  title: 'Deep-Sea Research Part I',
  publisher: 'Elsevier',
  canvas: { single_column_mm: 90, double_column_mm: 190, max_height_mm: 240 },
  map_target: { recommended_format: 'pdf', recommended_dpi: 500 },
  formats_accepted: ['tiff', 'eps', 'pdf'],
  colour_mode: 'RGB or CMYK',
  min_font_pt: 8,
  font_family_hint: 'Arial/Helvetica',
  source_url: 'https://example.org/dsr1/author-guidelines',
  last_verified: '2026-07-01',
};

/* --------------------------------------------------------------- constants -- */

test('ANTHROPIC constants are exact', () => {
  assert.equal(ANTHROPIC_MESSAGES_ENDPOINT, 'https://api.anthropic.com/v1/messages');
  assert.equal(ANTHROPIC_VERSION, '2023-06-01');
  assert.equal(DEFAULT_ASSISTANT_MODEL, 'claude-opus-4-8');
});

test('ASSISTANT_MODELS lists the three offered models with ids + labels', () => {
  assert.ok(Array.isArray(ASSISTANT_MODELS));
  assert.ok(ASSISTANT_MODELS.length >= 3);
  const byId = Object.fromEntries(ASSISTANT_MODELS.map((m) => [m.id, m.label]));
  assert.equal(byId['claude-opus-4-8'], 'Claude Opus 4.8 (most capable)');
  assert.equal(byId['claude-sonnet-5'], 'Claude Sonnet 5 (balanced)');
  assert.equal(byId['claude-haiku-4-5'], 'Claude Haiku 4.5 (fastest, cheapest)');
  for (const m of ASSISTANT_MODELS) {
    assert.equal(typeof m.id, 'string');
    assert.equal(typeof m.label, 'string');
  }
});

test('DEFAULT_ASSISTANT_MODEL is one of ASSISTANT_MODELS', () => {
  assert.ok(ASSISTANT_MODELS.some((m) => m.id === DEFAULT_ASSISTANT_MODEL));
});

test('ASSISTANT_MODELS is frozen (shared list is immutable)', () => {
  assert.ok(Object.isFrozen(ASSISTANT_MODELS));
  assert.throws(() => {
    ASSISTANT_MODELS.push({ id: 'x', label: 'y' });
  });
});

/* ------------------------------------------------------- grounded prompt --- */

test('grounded system prompt embeds title, last_verified, source_url, min font', () => {
  const sys = buildAssistantSystemPrompt(RECORD);
  assert.ok(sys.includes('Deep-Sea Research Part I'), 'journal title');
  assert.ok(sys.includes('2026-07-01'), 'last_verified');
  assert.ok(sys.includes('https://example.org/dsr1/author-guidelines'), 'source_url');
  assert.ok(sys.includes('label font >= 8 pt'), 'journal min font');
});

test('grounded system prompt carries the RAG guardrails', () => {
  const sys = buildAssistantSystemPrompt(RECORD);
  assert.ok(sys.includes('Answer ONLY from the CONTEXT'), 'grounding guardrail');
  assert.ok(sys.includes('Never invent'), 'anti-fabrication guardrail');
  assert.ok(
    sys.includes("Check the journal's current author guidelines:"),
    'fallback instruction',
  );
});

test('grounded system prompt pretty-prints the full JSON record', () => {
  const sys = buildAssistantSystemPrompt(RECORD);
  assert.ok(sys.includes(JSON.stringify(RECORD, null, 2)), 'record embedded verbatim');
  assert.ok(sys.includes('CONTEXT (verified spec for Deep-Sea Research Part I'));
});

test('grounded system prompt includes the invariant ground-truth block', () => {
  const sys = buildAssistantSystemPrompt(RECORD);
  assert.ok(sys.includes('Cartographic ground truth (always true):'));
  assert.ok(sys.includes('600 dpi or vector PDF'));
  assert.ok(sys.includes('cmocean is RGB and perceptually uniform'));
});

test('guidelinesExcerpt is included only when provided', () => {
  const withExcerpt = buildAssistantSystemPrompt(RECORD, {
    guidelinesExcerpt: 'Figures must be submitted as separate files.',
  });
  assert.ok(withExcerpt.includes('Figures must be submitted as separate files.'));

  const withoutExcerpt = buildAssistantSystemPrompt(RECORD, { guidelinesExcerpt: '   ' });
  assert.ok(!withoutExcerpt.includes('Figures must be submitted'));
});

/* --------------------------------------------------------- generic prompt -- */

test('null-record prompt keeps the ground-truth block + 7pt default', () => {
  const sys = buildAssistantSystemPrompt(null);
  assert.ok(sys.includes('Cartographic ground truth (always true):'));
  assert.ok(sys.includes('label font >= 7 pt'), '7 pt default');
  assert.ok(sys.includes('Answer ONLY from the CONTEXT'), 'grounding guardrail kept');
});

test('null-record prompt invents no journal facts', () => {
  const sys = buildAssistantSystemPrompt(null);
  // No fabricated journal identity or verified-spec header.
  assert.ok(!sys.includes('CONTEXT (verified spec for'), 'no fake verified spec');
  assert.ok(!sys.includes('Deep-Sea Research Part I'), 'no journal name leaked');
  assert.ok(!sys.includes('undefined'), 'no undefined placeholders');
  assert.ok(!sys.includes('null'), 'no null placeholders');
  // Steers the user toward picking a journal / reading real guidelines.
  assert.ok(/pick a journal|author\s+guidelines/i.test(sys), 'advises picking/checking');
});

test('undefined record behaves like null (generic prompt)', () => {
  assert.equal(buildAssistantSystemPrompt(undefined), buildAssistantSystemPrompt(null));
});

/* --------------------------------------------------------------- request --- */

test('buildAssistantRequest shapes a valid Messages body', () => {
  const body = buildAssistantRequest({ record: RECORD, question: 'What dpi for the map?' });
  assert.equal(body.model, DEFAULT_ASSISTANT_MODEL);
  assert.equal(body.max_tokens, 1024);
  assert.equal(typeof body.system, 'string');
  assert.ok(body.system.includes('Deep-Sea Research Part I'));
  assert.equal(body.messages.length, 1);
  assert.deepEqual(body.messages[0], {
    role: 'user',
    content: [{ type: 'text', text: 'What dpi for the map?' }],
  });
});

test('buildAssistantRequest appends history in order then the new question', () => {
  const history = [
    { role: 'user', text: 'Which format?' },
    { role: 'assistant', text: 'PDF is recommended.' },
  ];
  const body = buildAssistantRequest({
    record: RECORD,
    history,
    question: 'And the dpi?',
  });
  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(body.messages[0].content[0].text, 'Which format?');
  assert.equal(body.messages[1].content[0].text, 'PDF is recommended.');
  assert.equal(body.messages[2].content[0].text, 'And the dpi?');
  for (const m of body.messages) {
    assert.equal(m.content[0].type, 'text');
  }
});

test('buildAssistantRequest respects model + maxTokens overrides', () => {
  const body = buildAssistantRequest({
    record: RECORD,
    question: 'x',
    model: 'claude-haiku-4-5',
    maxTokens: 256,
  });
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.equal(body.max_tokens, 256);
});

test('buildAssistantRequest works with no record (generic system prompt)', () => {
  const body = buildAssistantRequest({ question: 'General help?' });
  assert.ok(body.system.includes('Cartographic ground truth'));
  assert.ok(!body.system.includes('CONTEXT (verified spec for'));
  assert.equal(body.messages.length, 1);
});

test('buildAssistantRequest throws on empty / blank / non-string question', () => {
  assert.throws(() => buildAssistantRequest({ record: RECORD, question: '' }), /non-empty/);
  assert.throws(() => buildAssistantRequest({ record: RECORD, question: '   ' }), /non-empty/);
  assert.throws(() => buildAssistantRequest({ record: RECORD }), /non-empty/);
  assert.throws(() => buildAssistantRequest({ record: RECORD, question: 42 }), /non-empty/);
});

test('buildAssistantRequest rejects malformed history turns', () => {
  assert.throws(
    () => buildAssistantRequest({ question: 'hi', history: [{ role: 'system', text: 'x' }] }),
    /role/,
  );
  assert.throws(
    () => buildAssistantRequest({ question: 'hi', history: [{ role: 'user', text: 5 }] }),
    /text/,
  );
});

/* --------------------------------------------------------------- headers --- */

test('anthropicHeaders carries key + browser-access header', () => {
  const h = anthropicHeaders('sk-ant-test');
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h['x-api-key'], 'sk-ant-test');
  assert.equal(h['anthropic-version'], ANTHROPIC_VERSION);
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
});

test('anthropicHeaders throws on empty / blank / non-string key', () => {
  assert.throws(() => anthropicHeaders(''), /non-empty/);
  assert.throws(() => anthropicHeaders('   '), /non-empty/);
  assert.throws(() => anthropicHeaders(undefined), /non-empty/);
});

/* --------------------------------------------------------------- extract --- */

test('extractAssistantText joins multiple text blocks', () => {
  const res = {
    content: [
      { type: 'text', text: 'Use 500 dpi ' },
      { type: 'text', text: 'and export PDF.' },
    ],
  };
  assert.equal(extractAssistantText(res), 'Use 500 dpi and export PDF.');
});

test('extractAssistantText ignores non-text / thinking / tool blocks', () => {
  const res = {
    content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'Answer.' },
      { type: 'tool_use', name: 'lookup', input: {} },
      { type: 'text' }, // malformed: no text
      { type: 'text', text: 42 }, // malformed: non-string text
    ],
  };
  assert.equal(extractAssistantText(res), 'Answer.');
});

test('extractAssistantText tolerates empty / missing / malformed content', () => {
  assert.equal(extractAssistantText({ content: [] }), '');
  assert.equal(extractAssistantText({}), '');
  assert.equal(extractAssistantText({ content: null }), '');
  assert.equal(extractAssistantText(null), '');
  assert.equal(extractAssistantText(undefined), '');
});
