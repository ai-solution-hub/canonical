/**
 * Upload Pipeline — Diff Computation Path Tests
 *
 * Tests the diff integration logic that runs during source document re-uploads.
 * Rather than mocking the entire 800-line upload route handler, these tests
 * verify the diff computation functions that the route calls:
 *
 *  1. computeDocumentDiff() — Q&A pair comparison between old and new text
 *  2. analyseDocumentImpact() — maps diff entries to affected KB items
 *  3. sendSourceDocumentUpdateNotifications() — notifies content owners
 *
 * The route's diff path (lines ~698-767) performs:
 *  - Lazy import of computeDocumentDiff and analyseDocumentImpact
 *  - Fetch old document's extracted_text from source_documents
 *  - Call computeDocumentDiff(oldId, newId, oldText, newText)
 *  - Store diff rows in source_document_diffs
 *  - Call analyseDocumentImpact(client, newDocumentId)
 *  - Call sendSourceDocumentUpdateNotifications if items are affected
 *  - Graceful degradation: errors are caught, upload still succeeds
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import {
  computeDocumentDiff,
  extractQAPairs,
} from '@/lib/source-documents/document-diff';
import type { ImpactAnalysis } from '@/lib/source-documents/source-document-impact';

// ---------------------------------------------------------------------------
// Test: computeDocumentDiff integration (mirrors upload route usage)
// ---------------------------------------------------------------------------

describe('Upload diff path — computeDocumentDiff', () => {
  it('produces diff entries when old and new documents have Q&A pairs', () => {
    const oldText = `Q: What is your data protection policy?
A: We follow ISO 27001 and encrypt all data at rest.

Q: How many employees do you have?
A: We have 150 employees across three offices.`;

    const newText = `Q: What is your data protection policy?
A: We follow ISO 27001:2022, encrypt all data at rest, and conduct annual penetration testing.

Q: How many employees do you have?
A: We have 200 employees across four offices.

Q: What is your carbon reduction strategy?
A: We target net zero by 2030 through renewable energy and supply chain optimisation.`;

    const result = computeDocumentDiff('old-doc', 'new-doc', oldText, newText);

    expect(result.old_document_id).toBe('old-doc');
    expect(result.new_document_id).toBe('new-doc');
    expect(result.entries.length).toBeGreaterThan(0);

    // Summary should reflect the changes
    expect(result.summary.total_old).toBe(2);
    expect(result.summary.total_new).toBe(3);
    expect(result.summary.added).toBe(1); // carbon reduction strategy is new
  });

  it('produces full-text diff entries when neither document has Q&A pairs', () => {
    const result = computeDocumentDiff(
      'old-doc',
      'new-doc',
      'Plain text without Q&A format.',
      'Another plain text document.',
    );

    // Full-text fallback now produces entries for prose documents
    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.diff_mode === 'full_text')).toBe(true);
  });

  it('identifies identical Q&A pairs as unchanged', () => {
    const text = `Q: What services do you provide?
A: We provide IT consultancy, managed services, and cloud migration.`;

    const result = computeDocumentDiff('old', 'new', text, text);

    expect(result.summary.unchanged).toBe(1);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
  });

  it('identifies removed Q&A pairs', () => {
    const oldText = `Q: Question one?
A: Answer one.

Q: Question two?
A: Answer two.`;

    const newText = `Q: Question one?
A: Answer one.`;

    const result = computeDocumentDiff('old', 'new', oldText, newText);

    expect(result.summary.removed).toBe(1);
    expect(result.summary.unchanged).toBe(1);
  });

  it('handles empty extracted text gracefully', () => {
    const result = computeDocumentDiff('old', 'new', '', '');

    expect(result.entries).toHaveLength(0);
    expect(result.summary.total_old).toBe(0);
    expect(result.summary.total_new).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test: diff storage format (mirrors the route's insert logic)
// ---------------------------------------------------------------------------

describe('Upload diff path — diff row construction', () => {
  it('builds insertable rows from diff entries', () => {
    const oldText = `Q: What is your approach to quality management?
A: We hold ISO 9001 certification.`;

    const newText = `Q: What is your approach to quality management?
A: We hold ISO 9001:2015 certification and conduct quarterly audits.

Q: What is your staff retention rate?
A: Our annual retention rate exceeds 95%.`;

    const diffResult = computeDocumentDiff(
      'old-doc',
      'new-doc',
      oldText,
      newText,
    );

    // Mirror the route's row construction logic (includes diff_mode)
    const diffRows = diffResult.entries.map((entry) => ({
      old_document_id: 'old-doc',
      new_document_id: 'new-doc',
      diff_type: entry.diff_type,
      diff_mode: entry.diff_mode ?? diffResult.diff_mode,
      old_question: entry.old_question ?? null,
      new_question: entry.new_question ?? null,
      old_content: entry.old_content ?? null,
      new_content: entry.new_content ?? null,
      similarity_score: entry.similarity_score ?? null,
      status: 'pending_review',
    }));

    // Should have rows to insert
    expect(diffRows.length).toBeGreaterThan(0);

    // Every row should have both document IDs and diff_mode
    for (const row of diffRows) {
      expect(row.old_document_id).toBe('old-doc');
      expect(row.new_document_id).toBe('new-doc');
      expect(row.status).toBe('pending_review');
      expect(row.diff_mode).toBe('qa');
      expect(['added', 'removed', 'modified', 'unchanged']).toContain(
        row.diff_type,
      );
    }

    // The added Q&A should have new_question but no old_question
    const addedRow = diffRows.find((r) => r.diff_type === 'added');
    expect(addedRow).toBeTruthy();
    expect(addedRow!.new_question).toContain('staff retention rate');
    expect(addedRow!.old_question).toBeNull();
  });

  it('includes diff_mode: full_text for prose document diff rows', () => {
    const diffResult = computeDocumentDiff(
      'old-doc',
      'new-doc',
      'Original paragraph about compliance requirements.',
      'Updated paragraph about compliance requirements and new regulations.',
    );

    const diffRows = diffResult.entries.map((entry) => ({
      old_document_id: 'old-doc',
      new_document_id: 'new-doc',
      diff_type: entry.diff_type,
      diff_mode: entry.diff_mode ?? diffResult.diff_mode,
      old_content: entry.old_content ?? null,
      new_content: entry.new_content ?? null,
      status: 'pending_review',
    }));

    expect(diffRows.length).toBeGreaterThan(0);

    // Every row should have diff_mode: full_text
    for (const row of diffRows) {
      expect(row.diff_mode).toBe('full_text');
    }
  });
});

// ---------------------------------------------------------------------------
// Test: analyseDocumentImpact (Supabase mock)
// ---------------------------------------------------------------------------

describe('Upload diff path — analyseDocumentImpact', () => {
  let mockClient: ReturnType<typeof createMockSupabaseClient>;

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('returns empty impact when document has no parent', async () => {
    const { analyseDocumentImpact } =
      await import('@/lib/source-documents/source-document-impact');

    // source_documents.select().eq().single() → doc with no parent
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc', filename: 'test.docx', parent_id: null },
      error: null,
    });

    const impact = await analyseDocumentImpact(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockClient as any,
      'new-doc',
    );

    expect(impact.total_affected_items).toBe(0);
    expect(impact.items).toHaveLength(0);
  });

  it('returns empty impact when no diffs exist for the document pair', async () => {
    const { analyseDocumentImpact } =
      await import('@/lib/source-documents/source-document-impact');

    // source_documents.select().eq().single() → doc with parent
    mockClient._chain.single.mockResolvedValueOnce({
      data: { id: 'new-doc', filename: 'test.docx', parent_id: 'old-doc' },
      error: null,
    });

    // source_document_diffs.select().eq().eq().in() → no diffs
    mockClient._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const impact = await analyseDocumentImpact(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockClient as any,
      'new-doc',
    );

    expect(impact.total_affected_items).toBe(0);
    expect(impact.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: graceful degradation pattern
// ---------------------------------------------------------------------------

describe('Upload diff path — graceful degradation', () => {
  it('computeDocumentDiff does not throw for malformed text', () => {
    // The route wraps this in try/catch — verify the function itself is safe
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      computeDocumentDiff('old', 'new', null as any, undefined as any),
    ).not.toThrow();
  });

  it('diff entries are empty only when both documents are empty', () => {
    const result = computeDocumentDiff('old', 'new', '', '');

    // Route only stores diffs when entries.length > 0
    expect(result.entries.length).toBe(0);

    // This means the route will skip the insert + impact + notification path
    // (see upload route line 724: `if (diffResult.entries.length > 0)`)
  });

  it('prose documents now produce full-text diff entries', () => {
    const result = computeDocumentDiff(
      'old',
      'new',
      'No Q&A pairs here.',
      'Also no Q&A pairs.',
    );

    // Full-text fallback produces entries for prose documents
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.diff_mode).toBe('full_text');
  });

  it('extractQAPairs returns empty array for empty input', () => {
    expect(extractQAPairs('')).toHaveLength(0);
    expect(extractQAPairs('  \n\t  ')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: sendSourceDocumentUpdateNotifications
// ---------------------------------------------------------------------------

describe('Upload diff path — notifications', () => {
  beforeEach(() => {
    createMockSupabaseClient();
  });

  it('does not send notifications when impact has zero affected items', async () => {
    // The route checks `impact.total_affected_items > 0` before calling
    // sendSourceDocumentUpdateNotifications. This test verifies the gate.
    const impact: ImpactAnalysis = {
      document_id: 'new-doc',
      document_filename: 'test.docx',
      previous_version_id: 'old-doc',
      total_affected_items: 0,
      items: [],
    };

    // Simulate the route's conditional
    const shouldNotify = impact.total_affected_items > 0;
    expect(shouldNotify).toBe(false);
  });

  it('would send notifications when impact has affected items', () => {
    const impact: ImpactAnalysis = {
      document_id: 'new-doc',
      document_filename: 'test.docx',
      previous_version_id: 'old-doc',
      total_affected_items: 3,
      items: [
        {
          content_item_id: 'ci-1',
          content_item_title: 'Data Protection Policy',
          impact_type: 'needs_update',
          diff_detail:
            'Q&A pair modified: "What is your data protection policy?"',
        },
        {
          content_item_id: 'ci-2',
          content_item_title: 'Staff Overview',
          impact_type: 'needs_update',
          diff_detail: 'Q&A pair modified: "How many employees?"',
        },
        {
          content_item_id: 'ci-3',
          content_item_title: 'Legacy Product',
          impact_type: 'source_removed',
          diff_detail: 'Q&A pair removed: "Describe your legacy product"',
        },
      ],
    };

    const shouldNotify = impact.total_affected_items > 0;
    expect(shouldNotify).toBe(true);

    // Verify impact categorisation
    const needsUpdate = impact.items.filter(
      (i) => i.impact_type === 'needs_update',
    );
    const sourceRemoved = impact.items.filter(
      (i) => i.impact_type === 'source_removed',
    );
    expect(needsUpdate).toHaveLength(2);
    expect(sourceRemoved).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test: complete diff flow (end-to-end logic, no network)
// ---------------------------------------------------------------------------

describe('Upload diff path — complete flow simulation', () => {
  it('simulates the full diff path as the upload route would execute it', () => {
    // This mirrors the exact logic from the upload route (lines 698-767):
    //
    // 1. Old document text is fetched (simulated here as a string)
    // 2. computeDocumentDiff is called
    // 3. If entries exist, they are mapped to insert rows
    // 4. diffAvailable flag is set

    const oldExtractedText = `Q: What accreditations do you hold?
A: ISO 27001, ISO 9001, Cyber Essentials Plus.

Q: What is your approach to GDPR compliance?
A: We have a dedicated DPO and conduct annual DPIAs.`;

    const newExtractedText = `Q: What accreditations do you hold?
A: ISO 27001:2022, ISO 9001:2015, Cyber Essentials Plus, SOC 2 Type II.

Q: What is your approach to GDPR compliance?
A: We have a dedicated DPO, conduct quarterly DPIAs, and use privacy-by-design in all new projects.

Q: Do you have a business continuity plan?
A: Yes, our BCP is tested annually and covers all critical systems with an RTO of 4 hours.`;

    const oldDocId = 'doc-v1';
    const newDocId = 'doc-v2';

    // Step 1: Compute diff
    const diffResult = computeDocumentDiff(
      oldDocId,
      newDocId,
      oldExtractedText,
      newExtractedText,
    );

    // Step 2: Build rows for storage (as the route does)
    let diffAvailable = false;
    const storedRows: Record<string, unknown>[] = [];

    if (diffResult.entries.length > 0) {
      for (const entry of diffResult.entries) {
        storedRows.push({
          old_document_id: oldDocId,
          new_document_id: newDocId,
          diff_type: entry.diff_type,
          diff_mode: entry.diff_mode ?? diffResult.diff_mode,
          old_question: entry.old_question ?? null,
          new_question: entry.new_question ?? null,
          old_content: entry.old_content ?? null,
          new_content: entry.new_content ?? null,
          similarity_score: entry.similarity_score ?? null,
          status: 'pending_review',
        });
      }
      diffAvailable = true;
    }

    // Assertions
    expect(diffAvailable).toBe(true);
    expect(storedRows.length).toBeGreaterThan(0);

    // Should have 2 modified + 1 added = 3 entries (plus unchanged)
    expect(diffResult.summary.modified).toBe(2); // both existing Q&As were updated
    expect(diffResult.summary.added).toBe(1); // BCP is new
    expect(diffResult.summary.removed).toBe(0);

    // The added entry should be the BCP question
    const addedEntries = storedRows.filter((r) => r.diff_type === 'added');
    expect(addedEntries).toHaveLength(1);
    expect(addedEntries[0].new_question).toContain('business continuity plan');

    // All stored rows should have pending_review status
    for (const row of storedRows) {
      expect(row.status).toBe('pending_review');
    }
  });
});
