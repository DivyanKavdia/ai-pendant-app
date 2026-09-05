/**
 * Ask Synap's refusal behaviour.
 *
 * A second brain that answers "what did Ankit say about the launch?" from
 * general knowledge is worse than one that says nothing, so these tests are
 * mostly about the cases where the right output is a refusal.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAnswer, type Evidence, type RawAnswer } from '../src/gemini/ask.js';

const evidence: Evidence[] = [
  {
    recordingId: 'r1',
    conversationId: 'c1',
    startMs: 300_000,
    endMs: 360_000,
    day: '2026-09-03',
    title: 'Launch planning',
    summary: 'Ankit confirmed the launch moves to Friday.',
  },
  {
    recordingId: 'r2',
    conversationId: 'c2',
    startMs: 0,
    endMs: 60_000,
    day: '2026-09-04',
    title: 'Standup',
    summary: 'Discussed the deck and the pricing page.',
  },
];

function raw(overrides: Partial<RawAnswer> = {}): RawAnswer {
  return {
    answer: 'Ankit said the launch moves to Friday.',
    confidence: 'high',
    source_indices: [0],
    quotes: ['Ankit confirmed the launch moves to Friday.'],
    ...overrides,
  };
}

test('a grounded answer resolves its citations to real sources', () => {
  const result = resolveAnswer(raw(), evidence);
  assert.equal(result.confidence, 'high');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.recording_id, 'r1');
  assert.equal(result.sources[0]?.start_ms, 300_000);
});

test('an invented source index discards the whole answer', () => {
  const result = resolveAnswer(raw({ source_indices: [0, 7] }), evidence);
  assert.equal(result.confidence, 'none');
  assert.equal(result.sources.length, 0);
});

test('a negative source index is treated as fabrication', () => {
  assert.equal(resolveAnswer(raw({ source_indices: [-1] }), evidence).confidence, 'none');
});

test('an answer with no citations is refused however confident it sounds', () => {
  const result = resolveAnswer(raw({ source_indices: [], confidence: 'high' }), evidence);
  assert.equal(result.confidence, 'none');
  assert.match(result.answer, /don't have anything in your recordings/);
});

test('the model declaring low confidence with no sources still refuses', () => {
  assert.equal(
    resolveAnswer(raw({ confidence: 'none', source_indices: [0] }), evidence).confidence,
    'none',
  );
});

test('an empty answer body is refused', () => {
  assert.equal(resolveAnswer(raw({ answer: '   ' }), evidence).confidence, 'none');
});

test('no evidence means no answer', () => {
  assert.equal(resolveAnswer(raw(), []).confidence, 'none');
});

test('a quote that is not verbatim in the evidence is dropped, not shown', () => {
  const result = resolveAnswer(raw({ quotes: ['Ankit said we should ship on Monday'] }), evidence);
  assert.equal(result.sources[0]?.quote, null);
  // The answer itself survives; only the unverifiable quote is removed.
  assert.equal(result.confidence, 'high');
});

test('multiple citations map positionally to their quotes', () => {
  const result = resolveAnswer(
    raw({
      source_indices: [0, 1],
      quotes: ['Ankit confirmed the launch moves to Friday.', 'Discussed the deck and the pricing page.'],
    }),
    evidence,
  );
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[1]?.conversation_id, 'c2');
  assert.equal(result.sources[1]?.quote, 'Discussed the deck and the pricing page.');
});

test('sources are capped so a response stays reviewable', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ ...evidence[0]!, conversationId: `c${index}` }));
  const result = resolveAnswer(
    raw({ source_indices: many.map((_, index) => index), quotes: [] }),
    many,
  );
  assert.ok(result.sources.length <= 8);
});
