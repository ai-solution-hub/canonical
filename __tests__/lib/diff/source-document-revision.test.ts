/**
 * source-document-revision adapter tests (ID-117 {117.6})
 *
 * Verifies that sourceDocumentRevisionToUnified:
 * - produces a well-formed UnifiedRevision from a source_documents row fixture
 * - recordKind is always 'source_document'
 * - text projection is extracted_text (the binary-leg text fallback)
 * - binary field carries storagePath + mimeType
 * - changeType synthesised as 'initial_ingest' for version===1 / no parent_id
 * - changeType synthesised as 'reingest' for version>1 or parent_id present
 * - changeSummary always null (no such column on source_documents)
 * - editIntent always null (no such column on source_documents)
 * - createdByLabel resolved from uploaded_by: non-null+in-map → resolved name;
 *   non-null+not-in-map → 'Unknown'; null → 'System'
 * - does NOT write to any store (pure function)
 *
 * Per TECH §4 OQ-117-4 and PLAN item-2.
 */
import { describe, it, expect } from 'vitest';
import { sourceDocumentRevisionToUnified } from '@/lib/diff/adapters/source-document-revision';
import type { Tables } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Type alias for source_documents Row (public schema, canonical definition)
// ---------------------------------------------------------------------------
type SourceDocumentRow = Tables<'source_documents'>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal valid source_documents Row for a v1 (initial ingest) document. */
function makeSourceDocRow(
  overrides: Partial<SourceDocumentRow> = {},
): SourceDocumentRow {
  return {
    id: 'docid-0000-0000-0000-000000000001',
    version: 1,
    parent_id: null,
    storage_path: 'docid-0000-0000-0000-000000000001/report.pdf',
    mime_type: 'application/pdf',
    extracted_text: '## Section 1\n\nExtracted text body.',
    created_at: '2026-01-15T10:00:00.000Z',
    uploaded_by: 'user-uuid-alice',
    // Non-required fields with defaults
    archived_at: null,
    archived_by: null,
    content_hash: 'abc123',
    extraction_metadata: null,
    extraction_method: null,
    file_size: 102400,
    filename: 'report.pdf',
    op_id: null,
    original_filename: 'report.pdf',
    pipeline_run_id: null,
    pullmd_share_id: null,
    source_url: null,
    status: 'processed',
    workspace_id: 'ws-00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

/** A display-name map for the adapter's labelFor-equivalent logic. */
const DISPLAY_NAMES = new Map<string, string>([
  ['user-uuid-alice', 'Alice Doe'],
  ['user-uuid-bob', 'Bob Smith'],
]);

// ---------------------------------------------------------------------------
// recordKind
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — recordKind', () => {
  it('always returns recordKind source_document', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow(),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.recordKind).toBe('source_document');
  });
});

// ---------------------------------------------------------------------------
// recordId
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — recordId', () => {
  it('maps recordId from the caller-supplied documentId', () => {
    const docId = 'docid-0000-0000-0000-000000000001';
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow(),
      docId,
      DISPLAY_NAMES,
    );
    expect(result.recordId).toBe(docId);
  });
});

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — version', () => {
  it('maps version from the row', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ version: 3 }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// text (binary-leg text fallback = extracted_text)
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — text projection', () => {
  it('maps text from extracted_text', () => {
    const extractedText = '## Report\n\nBody content.';
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ extracted_text: extractedText }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.text).toBe(extractedText);
  });

  it('maps text as empty string when extracted_text is null', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ extracted_text: null }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.text).toBe('');
  });
});

// ---------------------------------------------------------------------------
// changeType — OQ-117-4 provenance synthesis
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — changeType synthesis (OQ-117-4)', () => {
  it('synthesises initial_ingest when version===1 and parent_id is null', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ version: 1, parent_id: null }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.changeType).toBe('initial_ingest');
  });

  it('synthesises reingest when version===2 and parent_id is null', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ version: 2, parent_id: null }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.changeType).toBe('reingest');
  });

  it('synthesises reingest when version===1 but parent_id is set', () => {
    // parent_id presence overrides version===1 — this is a linked version
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({
        version: 1,
        parent_id: 'parent-0000-0000-0000-000000000001',
      }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.changeType).toBe('reingest');
  });

  it('synthesises reingest when version>1 regardless of parent_id', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({
        version: 5,
        parent_id: 'parent-0000-0000-0000-000000000001',
      }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.changeType).toBe('reingest');
  });
});

// ---------------------------------------------------------------------------
// changeSummary — always null (no column on source_documents)
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — changeSummary', () => {
  it('always returns changeSummary as null', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow(),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.changeSummary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// editIntent — always null (no column on source_documents)
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — editIntent', () => {
  it('always returns editIntent as null', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow(),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.editIntent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createdAt
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — createdAt', () => {
  it('maps createdAt from created_at (ISO string preserved verbatim)', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ created_at: '2026-03-20T14:30:00.000Z' }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.createdAt).toBe('2026-03-20T14:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// createdByLabel — labelFor pattern resolution
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — createdByLabel resolution', () => {
  it('resolves display name when uploaded_by is in the map', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ uploaded_by: 'user-uuid-alice' }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.createdByLabel).toBe('Alice Doe');
  });

  it('falls back to Unknown when uploaded_by is not in the map', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ uploaded_by: 'user-uuid-unknown' }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.createdByLabel).toBe('Unknown');
  });

  it('falls back to System when uploaded_by is null', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ uploaded_by: null }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.createdByLabel).toBe('System');
  });

  it('works with an empty display-name map (returns Unknown for non-null uploaded_by)', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ uploaded_by: 'user-uuid-bob' }),
      'docid-0000-0000-0000-000000000001',
      new Map(),
    );
    expect(result.createdByLabel).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// binary field — storagePath + mimeType
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — binary field', () => {
  it('exposes binary.storagePath from storage_path', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({
        storage_path: 'docid-0000-0000-0000-000000000001/report.pdf',
      }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.binary?.storagePath).toBe(
      'docid-0000-0000-0000-000000000001/report.pdf',
    );
  });

  it('exposes binary.mimeType from mime_type', () => {
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({
        mime_type:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.binary?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('omits binary when storage_path is null', () => {
    // storage_path is typed non-null in the canonical Row, but the adapter
    // guards against null at runtime (the row arrives via maybeSingle, so
    // defensive null-handling is required). Cast to exercise that branch.
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ storage_path: null as unknown as string }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.binary).toBeUndefined();
  });

  it('omits binary when mime_type is null', () => {
    // mime_type is typed non-null in the canonical Row; cast to test the
    // runtime guard path (defensive programming for real-world partial rows).
    const result = sourceDocumentRevisionToUnified(
      makeSourceDocRow({ mime_type: null as unknown as string }),
      'docid-0000-0000-0000-000000000001',
      DISPLAY_NAMES,
    );
    expect(result.binary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pure function — no observable side effects
// ---------------------------------------------------------------------------

describe('sourceDocumentRevisionToUnified — purity', () => {
  it('does not mutate the input row', () => {
    const row = makeSourceDocRow();
    const frozen = Object.freeze({ ...row });
    // Should not throw (no mutation attempted)
    expect(() =>
      sourceDocumentRevisionToUnified(
        frozen as SourceDocumentRow,
        'docid-0000-0000-0000-000000000001',
        DISPLAY_NAMES,
      ),
    ).not.toThrow();
  });
});
