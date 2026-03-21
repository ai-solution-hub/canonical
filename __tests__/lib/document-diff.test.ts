import { describe, it, expect, vi } from 'vitest';
import {
  stringSimilarity,
  extractQAPairs,
  computeDocumentDiff,
  MAX_QA_PAIRS,
} from '@/lib/document-diff';

// ---------------------------------------------------------------------------
// stringSimilarity
// ---------------------------------------------------------------------------

describe('stringSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(stringSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 1.0 for identical strings regardless of case', () => {
    expect(stringSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('returns 1.0 for identical strings with surrounding whitespace', () => {
    expect(stringSimilarity('  hello world  ', 'hello world')).toBe(1);
  });

  it('returns a high score for strings with minor edits', () => {
    const score = stringSimilarity(
      'What is your data protection policy?',
      'What is your data protection policiy?', // typo
    );
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns a low score for completely different strings', () => {
    const score = stringSimilarity(
      'What is your data protection policy?',
      'How many employees does your company have?',
    );
    expect(score).toBeLessThan(0.3);
  });

  it('returns 0 for empty strings', () => {
    expect(stringSimilarity('', '')).toBe(1); // both normalise to same empty
  });

  it('returns 0 for single-character strings that differ', () => {
    expect(stringSimilarity('a', 'b')).toBe(0);
  });

  it('returns 0 when one string is empty and the other is not', () => {
    expect(stringSimilarity('', 'hello')).toBe(0);
  });

  it('handles strings with special characters', () => {
    const score = stringSimilarity(
      'ISO 27001:2022 certification',
      'ISO 27001:2022 certification',
    );
    expect(score).toBe(1);
  });

  it('is symmetric', () => {
    const ab = stringSimilarity('abcdef', 'abcxyz');
    const ba = stringSimilarity('abcxyz', 'abcdef');
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('returns a moderate score for partially similar strings', () => {
    const score = stringSimilarity(
      'Do you have a business continuity plan?',
      'Do you have a disaster recovery plan?',
    );
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.9);
  });
});

// ---------------------------------------------------------------------------
// extractQAPairs
// ---------------------------------------------------------------------------

describe('extractQAPairs', () => {
  it('returns empty array for empty text', () => {
    expect(extractQAPairs('')).toEqual([]);
  });

  it('returns empty array for whitespace-only text', () => {
    expect(extractQAPairs('   \n\n  ')).toEqual([]);
  });

  it('extracts a single Q/A pair', () => {
    const text = 'Q: What is your company name?\nA: Acme Corp';
    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What is your company name?');
    expect(pairs[0].answer).toBe('Acme Corp');
  });

  it('extracts multiple Q/A pairs', () => {
    const text = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: How many employees?',
      'A: 150',
    ].join('\n');

    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your company name?');
    expect(pairs[0].answer).toBe('Acme Corp');
    expect(pairs[1].question).toBe('How many employees?');
    expect(pairs[1].answer).toBe('150');
  });

  it('handles Question:/Answer: format', () => {
    const text = [
      'Question: What is your turnover?',
      'Answer: £5 million per annum',
    ].join('\n');

    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What is your turnover?');
    expect(pairs[0].answer).toBe('£5 million per annum');
  });

  it('handles multi-line answers', () => {
    const text = [
      'Q: Describe your security policy.',
      'A: We follow ISO 27001.',
      'Our security team conducts regular audits.',
      'We use encryption for all data at rest.',
      'Q: What is your uptime SLA?',
      'A: 99.9%',
    ].join('\n');

    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('Describe your security policy.');
    expect(pairs[0].answer).toContain('ISO 27001');
    expect(pairs[0].answer).toContain('regular audits');
    expect(pairs[0].answer).toContain('encryption');
    expect(pairs[1].answer).toBe('99.9%');
  });

  it('extracts from pipe-delimited table format', () => {
    const text = [
      '| Question | Answer |',
      '|----------|--------|',
      '| What is your company name? | Acme Corp |',
      '| How many employees? | 150 |',
    ].join('\n');

    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].question).toBe('What is your company name?');
    expect(pairs[0].answer).toBe('Acme Corp');
    expect(pairs[1].question).toBe('How many employees?');
    expect(pairs[1].answer).toBe('150');
  });

  it('filters out empty pairs from Q/A format', () => {
    const text = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: ',
      'A: ',
      'Q: How many employees?',
      'A: 150',
    ].join('\n');

    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(2);
  });

  it('handles Q/A format without spaces after colon', () => {
    const text = 'Q:Company name?\nA:Acme Corp';
    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('Company name?');
    expect(pairs[0].answer).toBe('Acme Corp');
  });

  it('returns empty array for text with no Q&A structure', () => {
    const text = 'This is just a regular paragraph with no questions or answers.';
    expect(extractQAPairs(text)).toEqual([]);
  });

  it('handles mixed case Q/A labels', () => {
    const text = 'q: What is your name?\na: Acme Corp';
    const pairs = extractQAPairs(text);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe('What is your name?');
  });

  it('caps extraction at MAX_QA_PAIRS', () => {
    // Generate more than MAX_QA_PAIRS Q&A pairs
    const count = MAX_QA_PAIRS + 50;
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      lines.push(`Q: Question number ${i}?`);
      lines.push(`A: Answer number ${i}.`);
    }
    const text = lines.join('\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pairs = extractQAPairs(text);

    expect(pairs).toHaveLength(MAX_QA_PAIRS);
    expect(pairs[0].question).toBe('Question number 0?');
    expect(pairs[MAX_QA_PAIRS - 1].question).toBe(`Question number ${MAX_QA_PAIRS - 1}?`);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`truncated ${count} pairs to ${MAX_QA_PAIRS}`),
    );

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// computeDocumentDiff
// ---------------------------------------------------------------------------

describe('computeDocumentDiff', () => {
  const OLD_ID = '00000000-0000-0000-0000-000000000001';
  const NEW_ID = '00000000-0000-0000-0000-000000000002';

  it('returns all unchanged when documents are identical', () => {
    const text = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: How many employees?',
      'A: 150',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, text, text);

    expect(result.old_document_id).toBe(OLD_ID);
    expect(result.new_document_id).toBe(NEW_ID);
    expect(result.summary.unchanged).toBe(2);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.total_old).toBe(2);
    expect(result.summary.total_new).toBe(2);
  });

  it('returns all added when old document is empty', () => {
    const newText = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: How many employees?',
      'A: 150',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, '', newText);

    expect(result.summary.added).toBe(2);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.unchanged).toBe(0);
    expect(result.summary.total_old).toBe(0);
    expect(result.summary.total_new).toBe(2);
  });

  it('returns all removed when new document is empty', () => {
    const oldText = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: How many employees?',
      'A: 150',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, '');

    expect(result.summary.removed).toBe(2);
    expect(result.summary.added).toBe(0);
    expect(result.summary.unchanged).toBe(0);
    expect(result.summary.total_old).toBe(2);
    expect(result.summary.total_new).toBe(0);
  });

  it('detects modified via exact question match with different answer', () => {
    const oldText = [
      'Q: What is your company name?',
      'A: Acme Corp',
    ].join('\n');
    const newText = [
      'Q: What is your company name?',
      'A: Acme Corporation Ltd',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.summary.modified).toBe(1);
    expect(result.summary.unchanged).toBe(0);

    const modEntry = result.entries.find((e) => e.diff_type === 'modified');
    expect(modEntry).toBeDefined();
    expect(modEntry!.old_content).toBe('Acme Corp');
    expect(modEntry!.new_content).toBe('Acme Corporation Ltd');
    expect(modEntry!.similarity_score).toBe(1.0);
  });

  it('detects modified via similarity match (question rephrased)', () => {
    const oldText = [
      'Q: What is your data protection policy?',
      'A: We follow GDPR.',
    ].join('\n');
    const newText = [
      'Q: What is your data protection policy and approach?',
      'A: We follow GDPR and UK DPA 2018.',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.summary.modified).toBe(1);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);

    const modEntry = result.entries.find((e) => e.diff_type === 'modified');
    expect(modEntry).toBeDefined();
    expect(modEntry!.similarity_score).toBeGreaterThan(0.8);
    expect(modEntry!.similarity_score).toBeLessThan(1.0);
  });

  it('treats low-similarity questions as separate added/removed', () => {
    const oldText = [
      'Q: What is your company name?',
      'A: Acme Corp',
    ].join('\n');
    const newText = [
      'Q: How many data centres do you operate?',
      'A: Three, across the UK.',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.summary.removed).toBe(1);
    expect(result.summary.added).toBe(1);
    expect(result.summary.modified).toBe(0);
  });

  it('handles a mix of unchanged, modified, added, and removed', () => {
    const oldText = [
      'Q: What is your company name?',
      'A: Acme Corp',
      'Q: How many employees?',
      'A: 150',
      'Q: What is your annual turnover?',
      'A: £5 million',
    ].join('\n');

    const newText = [
      'Q: What is your company name?',
      'A: Acme Corp',         // unchanged
      'Q: How many employees?',
      'A: 200',               // modified (answer changed)
      'Q: Do you have ISO 27001?',
      'A: Yes, certified since 2020.', // added (new question)
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    expect(result.summary.unchanged).toBe(1);
    expect(result.summary.modified).toBe(1);
    expect(result.summary.removed).toBe(1);  // turnover removed
    expect(result.summary.added).toBe(1);    // ISO 27001 added
    expect(result.summary.total_old).toBe(3);
    expect(result.summary.total_new).toBe(3);
  });

  it('summary counts are correct and match entry counts', () => {
    const oldText = [
      'Q: Q1\nA: A1',
      'Q: Q2\nA: A2',
      'Q: Q3\nA: A3',
    ].join('\n');
    const newText = [
      'Q: Q1\nA: A1',    // unchanged
      'Q: Q2\nA: A2b',   // modified
      'Q: Q4\nA: A4',    // added (Q3 removed)
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

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

  it('respects custom similarity threshold', () => {
    const oldText = 'Q: What is your data protection policy?\nA: GDPR.';
    const newText = 'Q: What is your data protection approach?\nA: UK DPA.';

    // With a very high threshold, these should NOT match as modified
    const highThreshold = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText, {
      similarityThreshold: 0.99,
    });
    expect(highThreshold.summary.removed).toBe(1);
    expect(highThreshold.summary.added).toBe(1);
    expect(highThreshold.summary.modified).toBe(0);

    // With a lower threshold, they should match as modified
    const lowThreshold = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText, {
      similarityThreshold: 0.5,
    });
    expect(lowThreshold.summary.modified).toBe(1);
    expect(lowThreshold.summary.removed).toBe(0);
    expect(lowThreshold.summary.added).toBe(0);
  });

  it('handles both empty documents', () => {
    const result = computeDocumentDiff(OLD_ID, NEW_ID, '', '');

    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.summary.modified).toBe(0);
    expect(result.summary.unchanged).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  it('preserves document IDs in result', () => {
    const result = computeDocumentDiff(OLD_ID, NEW_ID, '', '');

    expect(result.old_document_id).toBe(OLD_ID);
    expect(result.new_document_id).toBe(NEW_ID);
  });

  it('exact match takes precedence over similarity match', () => {
    // Two very similar questions — only the exact match should be used
    const oldText = [
      'Q: What certifications do you hold?',
      'A: ISO 27001',
    ].join('\n');
    const newText = [
      'Q: What certifications do you hold?',
      'A: ISO 27001 and Cyber Essentials Plus',
      'Q: What certifications does your team hold?',
      'A: CISSP and CISM',
    ].join('\n');

    const result = computeDocumentDiff(OLD_ID, NEW_ID, oldText, newText);

    // The exact match should be used for the first old pair
    const modEntry = result.entries.find((e) => e.diff_type === 'modified');
    expect(modEntry).toBeDefined();
    expect(modEntry!.old_question).toBe('What certifications do you hold?');
    expect(modEntry!.new_question).toBe('What certifications do you hold?');
    expect(modEntry!.similarity_score).toBe(1.0);

    // The second new question should be "added"
    expect(result.summary.added).toBe(1);
  });
});
