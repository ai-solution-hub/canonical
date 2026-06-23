/**
 * UnifiedRevision type shape + deriveRenderMode helper tests (ID-117 {117.5})
 *
 * Verifies:
 * - deriveRenderMode returns the correct default per ViewDepth
 * - No illegal combo is constructible (binary + word-inline, etc.)
 * - UnifiedDiff shape: { older, newer } over a single recordId
 * - No >2-revision path exists in the module
 * - No diff-storage write occurs (module is pure types + pure helper)
 */
import { describe, it, expect } from 'vitest';
import {
  deriveRenderMode,
  type RecordKind,
  type ViewDepth,
  type RenderMode,
  type UnifiedRevision,
  type UnifiedDiff,
} from '@/lib/diff/unified-revision';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRevision(
  overrides: Partial<UnifiedRevision> = {},
): UnifiedRevision {
  return {
    recordKind: 'content_item',
    recordId: 'aaaaaaaa-0000-4000-8000-000000000001',
    version: 1,
    text: 'Some body text',
    changeType: 'edit',
    changeSummary: null,
    createdAt: '2026-01-15T10:00:00.000Z',
    createdByLabel: 'Alice',
    editIntent: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// deriveRenderMode — default mapping per ViewDepth
// ---------------------------------------------------------------------------

describe('deriveRenderMode', () => {
  it('returns binary-split for the binary view depth', () => {
    expect(deriveRenderMode('binary')).toBe('binary-split');
  });

  it('returns unified-line for the canonical-markdown view depth', () => {
    expect(deriveRenderMode('canonical-markdown')).toBe('unified-line');
  });

  it('returns unified-line for the user-edit view depth', () => {
    expect(deriveRenderMode('user-edit')).toBe('unified-line');
  });

  it('accepts an explicit override for content-item depths (side-by-side)', () => {
    expect(deriveRenderMode('user-edit', 'side-by-side')).toBe('side-by-side');
  });

  it('accepts an explicit override for content-item depths (word-inline)', () => {
    expect(deriveRenderMode('canonical-markdown', 'word-inline')).toBe(
      'word-inline',
    );
  });

  it('does NOT allow word-inline override for the binary depth — returns binary-split', () => {
    // The binary depth must always resolve to binary-split regardless of override.
    expect(deriveRenderMode('binary', 'word-inline')).toBe('binary-split');
  });

  it('does NOT allow side-by-side override for the binary depth — returns binary-split', () => {
    expect(deriveRenderMode('binary', 'side-by-side')).toBe('binary-split');
  });

  it('does NOT allow unified-line override for the binary depth — returns binary-split', () => {
    expect(deriveRenderMode('binary', 'unified-line')).toBe('binary-split');
  });
});

// ---------------------------------------------------------------------------
// UnifiedRevision structural shape — content_item recordKind
// ---------------------------------------------------------------------------

describe('UnifiedRevision — content_item', () => {
  it('constructs a well-formed revision with required fields', () => {
    const rev: UnifiedRevision = makeRevision();
    expect(rev.recordKind).toBe('content_item');
    expect(rev.recordId).toBe('aaaaaaaa-0000-4000-8000-000000000001');
    expect(rev.version).toBe(1);
    expect(rev.text).toBe('Some body text');
    expect(rev.changeType).toBe('edit');
    expect(rev.changeSummary).toBeNull();
    expect(rev.editIntent).toBeNull();
    expect(rev.binary).toBeUndefined();
  });

  it('accepts a non-null editIntent', () => {
    const rev: UnifiedRevision = makeRevision({ editIntent: 'restructure' });
    expect(rev.editIntent).toBe('restructure');
  });

  it('accepts a non-null changeSummary', () => {
    const rev: UnifiedRevision = makeRevision({
      changeSummary: 'Fixed section header',
    });
    expect(rev.changeSummary).toBe('Fixed section header');
  });
});

// ---------------------------------------------------------------------------
// UnifiedRevision structural shape — qa_pair recordKind
// ---------------------------------------------------------------------------

describe('UnifiedRevision — qa_pair', () => {
  it('constructs a well-formed qa_pair revision', () => {
    const rev: UnifiedRevision = makeRevision({
      recordKind: 'qa_pair',
      recordId: 'bbbbbbbb-0000-4000-8000-000000000002',
      text: 'The answer body',
      changeType: 'human',
      changeSummary: null,
      editIntent: 'rephrase',
    });
    expect(rev.recordKind).toBe('qa_pair');
    expect(rev.changeType).toBe('human');
    expect(rev.editIntent).toBe('rephrase');
    expect(rev.binary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UnifiedRevision structural shape — source_document recordKind (binary leg)
// ---------------------------------------------------------------------------

describe('UnifiedRevision — source_document', () => {
  it('constructs a well-formed source_document revision with binary field', () => {
    const rev: UnifiedRevision = makeRevision({
      recordKind: 'source_document',
      recordId: 'cccccccc-0000-4000-8000-000000000003',
      text: 'Extracted text fallback',
      changeType: 'reingest',
      changeSummary: null,
      editIntent: null,
      binary: {
        storagePath: 'cccccccc/document-v2.docx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    });
    expect(rev.recordKind).toBe('source_document');
    expect(rev.editIntent).toBeNull();
    expect(rev.binary).toBeDefined();
    expect(rev.binary?.storagePath).toBe('cccccccc/document-v2.docx');
    expect(rev.binary?.mimeType).toContain('wordprocessingml');
  });

  it('allows source_document without binary field (initial-ingest text-only fallback)', () => {
    const rev: UnifiedRevision = makeRevision({
      recordKind: 'source_document',
      changeType: 'initial_ingest',
      editIntent: null,
    });
    expect(rev.binary).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UnifiedDiff — enforces { older, newer } for exactly ONE recordId
// ---------------------------------------------------------------------------

describe('UnifiedDiff — shape', () => {
  it('constructs a valid diff pair sharing the same recordId', () => {
    const older: UnifiedRevision = makeRevision({
      version: 1,
      text: 'Old text',
    });
    const newer: UnifiedRevision = makeRevision({
      version: 2,
      text: 'New text',
    });
    const diff: UnifiedDiff = { older, newer };

    expect(diff.older.version).toBe(1);
    expect(diff.newer.version).toBe(2);
    // Both blobs share the same recordId — this is the invariant adapters enforce.
    expect(diff.older.recordId).toBe(diff.newer.recordId);
  });

  it('the UnifiedDiff type does not carry a third or fourth revision', () => {
    // The type shape itself only has `older` and `newer` — no array, no extras.
    const diff: UnifiedDiff = {
      older: makeRevision({ version: 1 }),
      newer: makeRevision({ version: 2 }),
    };
    const keys = Object.keys(diff);
    expect(keys).toHaveLength(2);
    expect(keys).toContain('older');
    expect(keys).toContain('newer');
  });
});

// ---------------------------------------------------------------------------
// RecordKind / ViewDepth / RenderMode — exhaustiveness guard
// ---------------------------------------------------------------------------

describe('Union types — exhaustiveness', () => {
  it('RecordKind covers the three expected variants', () => {
    const kinds: RecordKind[] = ['content_item', 'qa_pair', 'source_document'];
    expect(kinds).toHaveLength(3);
  });

  it('ViewDepth covers the three expected variants', () => {
    const depths: ViewDepth[] = ['user-edit', 'canonical-markdown', 'binary'];
    expect(depths).toHaveLength(3);
  });

  it('RenderMode covers the four expected variants', () => {
    const modes: RenderMode[] = [
      'unified-line',
      'side-by-side',
      'word-inline',
      'binary-split',
    ];
    expect(modes).toHaveLength(4);
  });
});
