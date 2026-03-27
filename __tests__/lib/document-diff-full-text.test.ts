/**
 * Full-Text Diff Engine Tests
 *
 * Tests for the `computeFullTextDiff()` function and the full-text fallback
 * path in `computeDocumentDiff()`. Covers:
 *  - Pure prose diff produces non-empty entries
 *  - Adjacent removed+added merge into modified
 *  - Existing Q&A diff still works (regression)
 *  - Mixed Q&A + prose (Q&A path taken when Q&A detected)
 *  - Max-entries cap enforced
 *  - Empty texts return empty entries
 *  - Single-side empty produces all-added or all-removed
 *  - diff_mode is correctly set ('qa' vs 'full_text')
 *
 * WP6 Phase 1.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeDocumentDiff,
  computeFullTextDiff,
  MAX_DIFF_ENTRIES,
} from '@/lib/document-diff';

const OLD_ID = '00000000-0000-0000-0000-000000000001';
const NEW_ID = '00000000-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// computeFullTextDiff — core function
// ---------------------------------------------------------------------------

describe('computeFullTextDiff', () => {
  it('produces non-empty entries for prose documents with differences', () => {
    const oldText = 'This is the original policy document.\nIt covers data protection.';
    const newText = 'This is the updated policy document.\nIt covers data protection and privacy.';

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.old_document_id).toBe(OLD_ID);
    expect(result.new_document_id).toBe(NEW_ID);
  });

  it('returns empty entries when both texts are empty', () => {
    const result = computeFullTextDiff(OLD_ID, NEW_ID, '', '');

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries).toHaveLength(0);
    expect(result.summary).toEqual({
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 0,
      total_old: 0,
      total_new: 0,
    });
  });

  it('returns empty entries when both texts are whitespace-only', () => {
    const result = computeFullTextDiff(OLD_ID, NEW_ID, '   \n\n  ', '  \t\n  ');

    expect(result.entries).toHaveLength(0);
    expect(result.summary.added).toBe(0);
  });

  it('produces all-added entries when old text is empty', () => {
    const newText = 'Line one.\nLine two.\nLine three.';
    const result = computeFullTextDiff(OLD_ID, NEW_ID, '', newText);

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.summary.added).toBeGreaterThan(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);

    // All non-unchanged entries should be 'added'
    const nonUnchanged = result.entries.filter((e) => e.diff_type !== 'unchanged');
    for (const entry of nonUnchanged) {
      expect(entry.diff_type).toBe('added');
      expect(entry.new_content).toBeTruthy();
    }
  });

  it('produces all-removed entries when new text is empty', () => {
    const oldText = 'Line one.\nLine two.\nLine three.';
    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, '');

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.summary.removed).toBeGreaterThan(0);
    expect(result.summary.added).toBe(0);
    expect(result.summary.modified).toBe(0);

    // All non-unchanged entries should be 'removed'
    const nonUnchanged = result.entries.filter((e) => e.diff_type !== 'unchanged');
    for (const entry of nonUnchanged) {
      expect(entry.diff_type).toBe('removed');
      expect(entry.old_content).toBeTruthy();
    }
  });

  it('produces only unchanged entries for identical texts', () => {
    const text = 'Section 1: Introduction\nThis policy defines our approach.\n\nSection 2: Scope\nApplies to all staff.';
    const result = computeFullTextDiff(OLD_ID, NEW_ID, text, text);

    expect(result.diff_mode).toBe('full_text');
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.unchanged).toBeGreaterThan(0);

    // Every entry should be unchanged
    for (const entry of result.entries) {
      expect(entry.diff_type).toBe('unchanged');
      expect(entry.old_content).toBe(entry.new_content);
    }
  });

  it('sets diff_mode to full_text on every entry', () => {
    const result = computeFullTextDiff(
      OLD_ID, NEW_ID,
      'Old content here.\nSecond line.',
      'New content here.\nSecond line.',
    );

    for (const entry of result.entries) {
      expect(entry.diff_mode).toBe('full_text');
    }
  });
});

// ---------------------------------------------------------------------------
// Adjacent removed+added merge into modified
// ---------------------------------------------------------------------------

describe('computeFullTextDiff — merge logic', () => {
  it('merges adjacent removed+added into a single modified entry', () => {
    // diffLines produces removed then added for changed lines
    const oldText = 'Line that will change.';
    const newText = 'Line that has changed.';

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    // Should merge into modified, not separate removed + added
    const modified = result.entries.filter((e) => e.diff_type === 'modified');
    expect(modified.length).toBeGreaterThan(0);
    expect(modified[0].old_content).toContain('will change');
    expect(modified[0].new_content).toContain('has changed');
  });

  it('keeps removed entry when it is not immediately followed by added', () => {
    // A removal followed by unchanged text should remain as 'removed' (not merged)
    const oldText = 'Line to remove.\nKept line one.\nKept line two.';
    const newText = 'Kept line one.\nKept line two.';

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    const removed = result.entries.filter((e) => e.diff_type === 'removed');
    expect(removed.length).toBeGreaterThan(0);
    expect(removed[0].old_content).toContain('remove');

    // No modified entries — the removal stands alone
    const modified = result.entries.filter((e) => e.diff_type === 'modified');
    expect(modified.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unchanged block collapsing
// ---------------------------------------------------------------------------

describe('computeFullTextDiff — unchanged collapsing', () => {
  it('collapses consecutive unchanged blocks into one entry', () => {
    // Create text with many lines, only the middle line changes
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} of the document.`);
    const oldText = lines.join('\n');

    const newLines = [...lines];
    newLines[10] = 'Line 11 has been modified.';
    const newText = newLines.join('\n');

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    // The unchanged lines before and after the change should be collapsed
    const unchanged = result.entries.filter((e) => e.diff_type === 'unchanged');
    // Should be at most 2 unchanged blocks (before and after the change), not 19
    expect(unchanged.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Max-entries cap
// ---------------------------------------------------------------------------

describe('computeFullTextDiff — max-entries cap', () => {
  it('enforces MAX_DIFF_ENTRIES cap on very large diffs', () => {
    // Alternating same/different lines produce many entries that survive merge.
    // Each pair of (unchanged, modified) = 2 entries per cycle.
    // We need > 2000 entries, so > 1000 cycles = 2000 lines.
    const lineCount = 3000;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      if (i % 2 === 0) {
        oldLines.push(`Same line ${i}`);
        newLines.push(`Same line ${i}`);
      } else {
        oldLines.push(`Old line ${i}`);
        newLines.push(`New line ${i}`);
      }
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = computeFullTextDiff(
      OLD_ID, NEW_ID,
      oldLines.join('\n'),
      newLines.join('\n'),
    );

    // Should be capped at MAX_DIFF_ENTRIES + 1 (includes the synthetic entry)
    expect(result.entries.length).toBeLessThanOrEqual(MAX_DIFF_ENTRIES + 1);

    // Should have logged a warning about exceeding cap
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceed cap'),
    );

    warnSpy.mockRestore();
  });

  it('preserves start and end context when capping', () => {
    const lineCount = 3000;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      if (i % 2 === 0) {
        oldLines.push(`Same line ${i}`);
        newLines.push(`Same line ${i}`);
      } else {
        oldLines.push(`Old unique ${i}`);
        newLines.push(`New unique ${i}`);
      }
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = computeFullTextDiff(
      OLD_ID, NEW_ID,
      oldLines.join('\n'),
      newLines.join('\n'),
    );

    // First entry should contain text from the start of the document
    const firstEntry = result.entries[0];
    expect(
      (firstEntry.old_content ?? '').includes('line 0') ||
      (firstEntry.new_content ?? '').includes('line 0'),
    ).toBe(true);

    // Last entry should contain text from the end of the document
    const lastEntry = result.entries[result.entries.length - 1];
    const lastLineIdx = lineCount - 1;
    // The last entry should reference lines near the end
    expect(
      (lastEntry.old_content ?? '').includes(`${lastLineIdx}`) ||
      (lastEntry.new_content ?? '').includes(`${lastLineIdx}`) ||
      (lastEntry.old_content ?? '').includes(`${lastLineIdx - 1}`) ||
      (lastEntry.new_content ?? '').includes(`${lastLineIdx - 1}`),
    ).toBe(true);

    warnSpy.mockRestore();
  });

  it('includes a synthetic collapsed indicator when capping', () => {
    const lineCount = 3000;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (let i = 0; i < lineCount; i++) {
      if (i % 2 === 0) {
        oldLines.push(`Same line ${i}`);
        newLines.push(`Same line ${i}`);
      } else {
        oldLines.push(`Old unique ${i}`);
        newLines.push(`New unique ${i}`);
      }
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = computeFullTextDiff(
      OLD_ID, NEW_ID,
      oldLines.join('\n'),
      newLines.join('\n'),
    );

    // Should contain a synthetic entry with the collapse indicator
    const syntheticEntry = result.entries.find(
      (e) => e.old_content?.includes('collapsed'),
    );
    expect(syntheticEntry).toBeDefined();
    expect(syntheticEntry!.diff_type).toBe('unchanged');

    warnSpy.mockRestore();
  });

  it('does not cap when entries are within limit', () => {
    const oldText = 'Line 1.\nLine 2.\nLine 3.';
    const newText = 'Line 1.\nLine 2 modified.\nLine 3.';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.entries.length).toBeLessThan(MAX_DIFF_ENTRIES);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// computeDocumentDiff — full-text fallback
// ---------------------------------------------------------------------------

describe('computeDocumentDiff — full-text fallback', () => {
  it('falls back to full-text diff when both documents are prose', () => {
    const oldText = 'This organisation follows a strict data governance framework.';
    const newText = 'This organisation follows an updated data governance framework with enhanced controls.';

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.diff_mode === 'full_text')).toBe(true);
  });

  it('sets diffAvailable to true for prose documents with changes', () => {
    const result = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'Original policy text.',
      'Updated policy text.',
    );

    // The route checks `diffResult.entries.length > 0` to set diffAvailable
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('returns empty entries when both texts are empty', () => {
    const result = computeDocumentDiff(OLD_ID, NEW_ID, '', '');

    expect(result.entries).toHaveLength(0);
    expect(result.summary.added).toBe(0);
  });

  it('produces full-text entries when old text is empty and new has prose', () => {
    const result = computeDocumentDiff(
      OLD_ID, NEW_ID,
      '',
      'This is a new prose document with no Q&A structure.',
    );

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.summary.added).toBeGreaterThan(0);
  });

  it('produces full-text entries when new text is empty and old has prose', () => {
    const result = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'This is an existing prose document being replaced with nothing.',
      '',
    );

    expect(result.diff_mode).toBe('full_text');
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.summary.removed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Regression: Q&A diff still works
// ---------------------------------------------------------------------------

describe('computeDocumentDiff — Q&A regression', () => {
  it('uses Q&A mode when documents have Q&A structure', () => {
    const oldText = 'Q: What is your company name?\nA: Acme Corp';
    const newText = 'Q: What is your company name?\nA: Acme Corporation Ltd';

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.diff_mode).toBe('qa');
    expect(result.entries.every((e) => e.diff_mode === 'qa')).toBe(true);
    expect(result.summary.modified).toBe(1);
  });

  it('uses Q&A mode when only old document has Q&A pairs', () => {
    const oldText = 'Q: What is your turnover?\nA: Fifty million.';
    const newText = 'Just a plain text document now.';

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    // Q&A path is taken because old side has Q&A pairs
    expect(result.diff_mode).toBe('qa');
    expect(result.summary.removed).toBe(1); // old pair removed
    expect(result.summary.added).toBe(0); // new text has no Q&A pairs
  });

  it('uses Q&A mode when only new document has Q&A pairs', () => {
    const oldText = 'Just plain prose document.';
    const newText = 'Q: What is your headcount?\nA: Two hundred staff.';

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    // Q&A path is taken because new side has Q&A pairs
    expect(result.diff_mode).toBe('qa');
    expect(result.summary.added).toBe(1); // new pair added
    expect(result.summary.removed).toBe(0); // old text has no Q&A pairs
  });

  it('preserves all Q&A diff fields on entries', () => {
    const oldText = 'Q: Question one?\nA: Answer one.';
    const newText = 'Q: Question one?\nA: Answer one updated.\nQ: Question two?\nA: Answer two.';

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    const modifiedEntry = result.entries.find((e) => e.diff_type === 'modified');
    expect(modifiedEntry).toBeDefined();
    expect(modifiedEntry!.diff_mode).toBe('qa');
    expect(modifiedEntry!.old_question).toBe('Question one?');
    expect(modifiedEntry!.new_question).toBe('Question one?');
    expect(modifiedEntry!.old_content).toBe('Answer one.');
    expect(modifiedEntry!.new_content).toBe('Answer one updated.');
    expect(modifiedEntry!.similarity_score).toBe(1.0);

    const addedEntry = result.entries.find((e) => e.diff_type === 'added');
    expect(addedEntry).toBeDefined();
    expect(addedEntry!.diff_mode).toBe('qa');
    expect(addedEntry!.new_question).toBe('Question two?');
  });
});

// ---------------------------------------------------------------------------
// diff_mode discriminator
// ---------------------------------------------------------------------------

describe('diff_mode discriminator', () => {
  it('every Q&A entry has diff_mode set to qa', () => {
    const text = [
      'Q: Q1?\nA: A1.',
      'Q: Q2?\nA: A2.',
    ].join('\n');
    const result = computeDocumentDiff(OLD_ID, NEW_ID, text, text);

    expect(result.diff_mode).toBe('qa');
    for (const entry of result.entries) {
      expect(entry.diff_mode).toBe('qa');
    }
  });

  it('every full-text entry has diff_mode set to full_text', () => {
    const result = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'Original prose content.',
      'Updated prose content.',
    );

    expect(result.diff_mode).toBe('full_text');
    for (const entry of result.entries) {
      expect(entry.diff_mode).toBe('full_text');
    }
  });

  it('DiffResult diff_mode matches entry diff_mode', () => {
    // Q&A case
    const qaResult = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'Q: Test?\nA: Yes.',
      'Q: Test?\nA: No.',
    );
    expect(qaResult.diff_mode).toBe('qa');
    expect(qaResult.entries[0].diff_mode).toBe(qaResult.diff_mode);

    // Full-text case
    const ftResult = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'Prose old.',
      'Prose new.',
    );
    expect(ftResult.diff_mode).toBe('full_text');
    expect(ftResult.entries[0].diff_mode).toBe(ftResult.diff_mode);
  });
});

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

describe('computeFullTextDiff — summary counts', () => {
  it('summary counts match entry counts', () => {
    const oldText = 'Line 1\nLine 2\nLine 3\nLine 4';
    const newText = 'Line 1\nLine 2 changed\nLine 3\nLine 5';

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    const counts = {
      added: result.entries.filter((e) => e.diff_type === 'added').length,
      removed: result.entries.filter((e) => e.diff_type === 'removed').length,
      modified: result.entries.filter((e) => e.diff_type === 'modified').length,
      unchanged: result.entries.filter((e) => e.diff_type === 'unchanged').length,
    };

    expect(result.summary.added).toBe(counts.added);
    expect(result.summary.removed).toBe(counts.removed);
    expect(result.summary.modified).toBe(counts.modified);
    expect(result.summary.unchanged).toBe(counts.unchanged);
  });

  it('total_old and total_new reflect line counts', () => {
    const oldText = 'Line 1\nLine 2\nLine 3';
    const newText = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';

    const result = computeFullTextDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.summary.total_old).toBe(3);
    expect(result.summary.total_new).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Upload route compatibility
// ---------------------------------------------------------------------------

describe('Full-text diff — upload route compatibility', () => {
  it('full-text entries map correctly to DB insert rows with null questions', () => {
    const result = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'Old policy content.',
      'New policy content.',
    );

    // Mirror the route's row construction logic
    const diffRows = result.entries.map((entry) => ({
      old_document_id: OLD_ID,
      new_document_id: NEW_ID,
      diff_type: entry.diff_type,
      old_question: entry.old_question ?? null,
      new_question: entry.new_question ?? null,
      old_content: entry.old_content ?? null,
      new_content: entry.new_content ?? null,
      similarity_score: entry.similarity_score ?? null,
      status: 'pending_review',
    }));

    expect(diffRows.length).toBeGreaterThan(0);

    // Full-text entries should have null questions
    for (const row of diffRows) {
      expect(row.old_question).toBeNull();
      expect(row.new_question).toBeNull();
      expect(row.status).toBe('pending_review');
      expect(['added', 'removed', 'modified', 'unchanged']).toContain(row.diff_type);
    }
  });

  it('affected_content_item_id will be NULL for full-text entries', () => {
    // Full-text diff entries have no old_question, so analyseDocumentImpact
    // will find no matches and affected_content_item_id remains NULL.
    // This is acceptable for Phase 1.
    const result = computeDocumentDiff(
      OLD_ID, NEW_ID,
      'Prose content about data protection.',
      'Updated prose content about data protection and privacy.',
    );

    // Verify entries have no question fields (confirming no impact match)
    for (const entry of result.entries) {
      expect(entry.old_question).toBeUndefined();
      expect(entry.new_question).toBeUndefined();
    }
  });
});
