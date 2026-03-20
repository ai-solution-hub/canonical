import { describe, it, expect } from 'vitest';
import {
  formatDocumentDiff,
  type DocumentDiffData,
} from '@/lib/mcp/formatters';
import { generateDocumentDiffReviewPrompt } from '@/lib/claude-prompts';

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

const fullDiff: DocumentDiffData = {
  old_filename: 'bid-library-v1.docx',
  new_filename: 'bid-library-v2.docx',
  summary: {
    added: 2,
    removed: 1,
    modified: 1,
    unchanged: 3,
    total_old: 5,
    total_new: 6,
  },
  entries: [
    {
      diff_type: 'added',
      new_question: 'Do you hold ISO 27001?',
      new_content: 'Yes, certified since 2023.',
    },
    {
      diff_type: 'added',
      new_question: 'What is your data retention policy?',
      new_content: 'We retain data for 7 years in line with regulatory requirements.',
    },
    {
      diff_type: 'modified',
      old_question: 'How many employees do you have?',
      new_question: 'How many employees do you have?',
      old_content: '120 full-time employees.',
      new_content: '150 full-time employees across 3 offices.',
      similarity_score: 1.0,
      affected_item: { id: 'item-001', title: 'Employee Count Q&A' },
    },
    {
      diff_type: 'removed',
      old_question: 'Do you have a company car policy?',
      old_content: 'Yes, senior staff are eligible for company vehicles.',
      affected_item: { id: 'item-002', title: 'Company Car Policy' },
    },
    {
      diff_type: 'unchanged',
      old_question: 'What is your company name?',
      old_content: 'Acme Corporation Ltd',
      new_question: 'What is your company name?',
      new_content: 'Acme Corporation Ltd',
      similarity_score: 1.0,
    },
    {
      diff_type: 'unchanged',
      old_question: 'Where is your head office?',
      old_content: 'London, UK',
      new_question: 'Where is your head office?',
      new_content: 'London, UK',
      similarity_score: 1.0,
    },
    {
      diff_type: 'unchanged',
      old_question: 'Year of incorporation?',
      old_content: '2010',
      new_question: 'Year of incorporation?',
      new_content: '2010',
      similarity_score: 1.0,
    },
  ],
};

const emptyDiff: DocumentDiffData = {
  old_filename: 'doc-v1.docx',
  new_filename: 'doc-v2.docx',
  summary: {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
    total_old: 0,
    total_new: 0,
  },
  entries: [],
};

const addedOnlyDiff: DocumentDiffData = {
  old_filename: 'old.docx',
  new_filename: 'new.docx',
  summary: {
    added: 1,
    removed: 0,
    modified: 0,
    unchanged: 0,
    total_old: 0,
    total_new: 1,
  },
  entries: [
    {
      diff_type: 'added',
      new_question: 'New question?',
      new_content: 'New answer.',
    },
  ],
};

const removedOnlyDiff: DocumentDiffData = {
  old_filename: 'old.docx',
  new_filename: 'new.docx',
  summary: {
    added: 0,
    removed: 1,
    modified: 0,
    unchanged: 0,
    total_old: 1,
    total_new: 0,
  },
  entries: [
    {
      diff_type: 'removed',
      old_question: 'Removed question?',
      old_content: 'Removed answer.',
      affected_item: null,
    },
  ],
};

// ──────────────────────────────────────────
// formatDocumentDiff tests
// ──────────────────────────────────────────

describe('formatDocumentDiff', () => {
  it('produces correct markdown heading with filenames', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('# Document Diff: bid-library-v1.docx \u2192 bid-library-v2.docx');
  });

  it('includes summary section with correct counts', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('## Summary');
    expect(result).toContain('**Added:** 2 new Q&A pairs');
    expect(result).toContain('**Removed:** 1 Q&A pair');
    expect(result).toContain('**Modified:** 1 Q&A pair changed');
    expect(result).toContain('**Unchanged:** 3 Q&A pairs identical');
  });

  it('renders Added section with correct table structure', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('### Added (2)');
    expect(result).toContain('| # | Question | Answer |');
    expect(result).toContain('| 1 | Do you hold ISO 27001? | Yes, certified since 2023. |');
    expect(result).toContain('| 2 | What is your data retention policy?');
  });

  it('renders Modified section with similarity and affected items', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('### Modified (1)');
    expect(result).toContain('| # | Old Question | New Question | Similarity | Affected KB Item |');
    expect(result).toContain('100%');
    expect(result).toContain('Employee Count Q&A');
  });

  it('renders Removed section with affected items', () => {
    const result = formatDocumentDiff(fullDiff);
    expect(result).toContain('### Removed (1)');
    expect(result).toContain('| # | Question | Answer | Affected KB Item |');
    expect(result).toContain('Do you have a company car policy?');
    expect(result).toContain('Company Car Policy');
  });

  it('handles empty diff with no changes message', () => {
    const result = formatDocumentDiff(emptyDiff);
    expect(result).toContain('# Document Diff: doc-v1.docx \u2192 doc-v2.docx');
    expect(result).toContain('No changes detected between the two document versions.');
    expect(result).not.toContain('### Added');
    expect(result).not.toContain('### Modified');
    expect(result).not.toContain('### Removed');
  });

  it('only shows sections that have entries — Added only', () => {
    const result = formatDocumentDiff(addedOnlyDiff);
    expect(result).toContain('### Added (1)');
    expect(result).not.toContain('### Modified');
    expect(result).not.toContain('### Removed');
  });

  it('only shows sections that have entries — Removed only', () => {
    const result = formatDocumentDiff(removedOnlyDiff);
    expect(result).toContain('### Removed (1)');
    expect(result).not.toContain('### Added');
    expect(result).not.toContain('### Modified');
  });

  it('shows em-dash when no affected item', () => {
    const result = formatDocumentDiff(removedOnlyDiff);
    expect(result).toContain('\u2014');
  });

  it('truncates long content to 200 characters', () => {
    const longContent = 'A'.repeat(300);
    const diff: DocumentDiffData = {
      old_filename: 'a.docx',
      new_filename: 'b.docx',
      summary: { added: 1, removed: 0, modified: 0, unchanged: 0, total_old: 0, total_new: 1 },
      entries: [
        {
          diff_type: 'added',
          new_question: longContent,
          new_content: longContent,
        },
      ],
    };

    const result = formatDocumentDiff(diff);
    // The truncate function adds '...' at the end, so max visible is 200 chars
    // Verify the full 300-char string is NOT present
    expect(result).not.toContain(longContent);
    // The truncated version should end with '...'
    expect(result).toContain('...');
  });

  it('handles singular counts correctly in summary', () => {
    const singleDiff: DocumentDiffData = {
      old_filename: 'a.docx',
      new_filename: 'b.docx',
      summary: { added: 1, removed: 1, modified: 1, unchanged: 1, total_old: 3, total_new: 3 },
      entries: [
        { diff_type: 'added', new_question: 'Q1?', new_content: 'A1' },
        { diff_type: 'removed', old_question: 'Q2?', old_content: 'A2' },
        { diff_type: 'modified', old_question: 'Q3?', new_question: 'Q3?', old_content: 'A3', new_content: 'A3b', similarity_score: 1.0 },
        { diff_type: 'unchanged', old_question: 'Q4?', new_question: 'Q4?', old_content: 'A4', new_content: 'A4', similarity_score: 1.0 },
      ],
    };

    const result = formatDocumentDiff(singleDiff);
    expect(result).toContain('1 new Q&A pair');
    expect(result).not.toContain('1 new Q&A pairs');
    expect(result).toContain('1 Q&A pair changed');
    expect(result).toContain('1 Q&A pair identical');
  });
});

// ──────────────────────────────────────────
// generateDocumentDiffReviewPrompt tests
// ──────────────────────────────────────────

describe('generateDocumentDiffReviewPrompt', () => {
  it('produces correct text for multiple changes and affected items', () => {
    const prompt = generateDocumentDiffReviewPrompt('bid-library.docx', 5, 3);
    expect(prompt.label).toBe('Review document changes');
    expect(prompt.prompt).toContain('"bid-library.docx"');
    expect(prompt.prompt).toContain('There are 5 changes detected');
    expect(prompt.prompt).toContain('affecting 3 KB items');
    expect(prompt.prompt).toContain('get_document_diff');
    expect(prompt.description).toBe('5 changes, 3 items affected');
    expect(prompt.category).toBe('general');
  });

  it('handles singular change correctly', () => {
    const prompt = generateDocumentDiffReviewPrompt('doc.docx', 1, 0);
    expect(prompt.prompt).toContain('There is 1 change detected');
    expect(prompt.prompt).not.toContain('affecting');
  });

  it('handles singular affected item correctly', () => {
    const prompt = generateDocumentDiffReviewPrompt('doc.docx', 3, 1);
    expect(prompt.prompt).toContain('affecting 1 KB item.');
    // "affecting 1 KB item" not "affecting 1 KB items"
    expect(prompt.prompt).not.toContain('affecting 1 KB items');
  });

  it('omits affected items clause when count is zero', () => {
    const prompt = generateDocumentDiffReviewPrompt('doc.docx', 2, 0);
    expect(prompt.prompt).not.toContain('affecting');
    expect(prompt.prompt).toContain('There are 2 changes detected.');
  });

  it('includes correct description', () => {
    const prompt = generateDocumentDiffReviewPrompt('file.docx', 10, 4);
    expect(prompt.description).toBe('10 changes, 4 items affected');
  });
});
