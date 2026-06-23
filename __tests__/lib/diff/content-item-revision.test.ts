/**
 * content-item-revision adapter tests (ID-117 {117.5})
 *
 * Verifies that contentItemRevisionToUnified:
 * - produces a well-formed UnifiedRevision from an ItemHistoryVersionDetail fixture
 * - recordKind is always 'content_item'
 * - text projection is the content field
 * - changeType maps from change_type
 * - changeSummary maps from change_summary
 * - editIntent maps from edit_intent
 * - createdAt maps from created_at
 * - does NOT carry a binary field (content items are text-only)
 * - does NOT write to any store (pure function)
 */
import { describe, it, expect } from 'vitest';
import { contentItemRevisionToUnified } from '@/lib/diff/adapters/content-item-revision';
import type { ItemHistoryVersionDetail } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContentHistoryRow(
  overrides: Partial<ItemHistoryVersionDetail> = {},
): ItemHistoryVersionDetail {
  return {
    id: '11111111-0000-4000-8000-000000000001',
    content_item_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    version: 3,
    title: 'Test Item',
    content: '# Heading\n\nSome markdown body.',
    brief: null,
    detail: null,
    reference: null,
    change_summary: 'Clarified the intro paragraph.',
    change_type: 'edit',
    created_by: 'user-uuid-alice',
    created_at: '2026-03-10T09:30:00.000Z',
    edit_intent: 'rephrase',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Core mapping
// ---------------------------------------------------------------------------

describe('contentItemRevisionToUnified', () => {
  it('returns a UnifiedRevision with recordKind content_item', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow(),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice (admin)',
    );
    expect(result.recordKind).toBe('content_item');
  });

  it('maps the recordId from the caller-supplied itemId', () => {
    const itemId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow(),
      itemId,
      'Alice',
    );
    expect(result.recordId).toBe(itemId);
  });

  it('maps version from the row', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ version: 7 }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.version).toBe(7);
  });

  it('maps text from the content field (the diffable projection)', () => {
    const content = '# Hello\n\nWorld body.';
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ content }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.text).toBe(content);
  });

  it('maps changeType from change_type', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ change_type: 'ai_update' }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.changeType).toBe('ai_update');
  });

  it('maps changeSummary from change_summary (non-null)', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ change_summary: 'Added new section.' }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.changeSummary).toBe('Added new section.');
  });

  it('maps changeSummary as null when change_summary is null', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ change_summary: null }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.changeSummary).toBeNull();
  });

  it('maps createdAt from created_at (ISO string preserved verbatim)', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ created_at: '2026-06-01T12:00:00.000Z' }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.createdAt).toBe('2026-06-01T12:00:00.000Z');
  });

  it('labels the revision with the caller-supplied author', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow(),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Bob (editor)',
    );
    expect(result.createdByLabel).toBe('Bob (editor)');
  });

  it('maps editIntent from edit_intent (non-null)', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ edit_intent: 'expand' }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.editIntent).toBe('expand');
  });

  it('maps editIntent as null when edit_intent is null', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow({ edit_intent: null }),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.editIntent).toBeNull();
  });

  it('does NOT set a binary field (content items are text-only)', () => {
    const result = contentItemRevisionToUnified(
      makeContentHistoryRow(),
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Alice',
    );
    expect(result.binary).toBeUndefined();
  });
});
