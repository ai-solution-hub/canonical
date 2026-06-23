/**
 * qa-pair-revision adapter tests (ID-117 {117.5})
 *
 * Verifies that qaPairRevisionToUnified:
 * - produces a well-formed UnifiedRevision from a QAPairHistoryEntry fixture
 * - recordKind is always 'qa_pair'
 * - text projection is answer_standard
 * - changeType maps from origin_kind
 * - changeSummary is always null (no column on the Q&A history table)
 * - editIntent maps from edit_intent
 * - createdAt maps from changed_at
 * - does NOT carry a binary field
 * - does NOT write to any store (pure function)
 * - behaviour matches the existing toRevisionBlob logic in qa-revision-history.tsx
 */
import { describe, it, expect } from 'vitest';
import { qaPairRevisionToUnified } from '@/lib/diff/adapters/qa-pair-revision';
import type { QAPairHistoryEntry } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeQAHistoryRow(
  overrides: Partial<QAPairHistoryEntry> = {},
): QAPairHistoryEntry {
  return {
    id: '22222222-0000-4000-8000-000000000002',
    q_a_pair_id: 'bbbbbbbb-0000-4000-8000-000000000002',
    version: 2,
    question_text: 'What is the procurement threshold?',
    answer_standard: 'The threshold is £25,000 for goods and services.',
    answer_advanced: null,
    origin_kind: 'human',
    publication_status: 'published',
    changed_at: '2026-04-20T14:15:00.000Z',
    changed_by: 'user-uuid-bob',
    edit_intent: 'rephrase',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Core mapping
// ---------------------------------------------------------------------------

describe('qaPairRevisionToUnified', () => {
  it('returns a UnifiedRevision with recordKind qa_pair', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow(),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob (editor)',
    );
    expect(result.recordKind).toBe('qa_pair');
  });

  it('maps the recordId from the caller-supplied qaPairId', () => {
    const qaPairId = 'bbbbbbbb-0000-4000-8000-000000000002';
    const result = qaPairRevisionToUnified(makeQAHistoryRow(), qaPairId, 'Bob');
    expect(result.recordId).toBe(qaPairId);
  });

  it('maps version from the row', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow({ version: 5 }),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.version).toBe(5);
  });

  it('maps text from answer_standard (the diffable projection for Q&A)', () => {
    const answer = 'Updated threshold explanation for 2026.';
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow({ answer_standard: answer }),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.text).toBe(answer);
  });

  it('maps changeType from origin_kind (no change_type column on Q&A history)', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow({ origin_kind: 'ai_generated' }),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.changeType).toBe('ai_generated');
  });

  it('changeSummary is always null (no column on q_a_pair_history)', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow(),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.changeSummary).toBeNull();
  });

  it('maps createdAt from changed_at (ISO string preserved verbatim)', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow({ changed_at: '2026-05-01T08:00:00.000Z' }),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.createdAt).toBe('2026-05-01T08:00:00.000Z');
  });

  it('labels the revision with the caller-supplied author', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow(),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Carol (reviewer)',
    );
    expect(result.createdByLabel).toBe('Carol (reviewer)');
  });

  it('maps editIntent from edit_intent (non-null)', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow({ edit_intent: 'expand' }),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.editIntent).toBe('expand');
  });

  it('maps editIntent as null when edit_intent is null (pre-feature rows)', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow({ edit_intent: null }),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.editIntent).toBeNull();
  });

  it('does NOT set a binary field (Q&A pairs are text-only)', () => {
    const result = qaPairRevisionToUnified(
      makeQAHistoryRow(),
      'bbbbbbbb-0000-4000-8000-000000000002',
      'Bob',
    );
    expect(result.binary).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Parity with toRevisionBlob in qa-revision-history.tsx:45
  // -------------------------------------------------------------------------

  it('produces the same field values as the legacy toRevisionBlob pattern', () => {
    // This test guards against drift from the existing mapping logic in
    // components/qa/qa-revision-history.tsx:45 toRevisionBlob.
    const row = makeQAHistoryRow({
      version: 1,
      answer_standard: 'Answer text.',
      origin_kind: 'human',
      changed_at: '2026-01-01T00:00:00.000Z',
      edit_intent: null,
    });
    const result = qaPairRevisionToUnified(row, row.q_a_pair_id, 'System');

    // The legacy blob mapped: text=answer_standard, changeType=origin_kind,
    // changeSummary=null, createdAt=changed_at, editIntent=edit_intent.
    expect(result.text).toBe('Answer text.');
    expect(result.changeType).toBe('human');
    expect(result.changeSummary).toBeNull();
    expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.editIntent).toBeNull();
  });
});
