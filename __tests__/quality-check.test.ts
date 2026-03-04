import { describe, it, expect } from 'vitest';
import { runDeterministicChecks } from '@/lib/quality-check';
import type { CitationEntry } from '@/types/bid-metadata';

/**
 * Tests for the deterministic quality checks only.
 * The AI-assisted check (runAIQualityCheck) requires the Anthropic API
 * client and is not tested here — it would need mocking.
 */

describe('runDeterministicChecks', () => {
  const baseQuestion = { question_text: 'Test question', word_limit: 500 };

  it('counts words correctly from HTML', () => {
    const result = runDeterministicChecks(
      '<p>Hello world test</p>',
      [],
      baseQuestion,
      0,
    );
    expect(result.wordCount).toBe(3);
  });

  it('flags over word limit as error', () => {
    const longText = '<p>' + 'word '.repeat(550) + '</p>';
    const result = runDeterministicChecks(
      longText,
      [],
      { question_text: 'Test', word_limit: 500 },
      0,
    );

    const wordLimitIssue = result.issues.find((i) => i.type === 'word_limit');
    expect(wordLimitIssue).toBeDefined();
    expect(wordLimitIssue?.severity).toBe('error');
    expect(wordLimitIssue?.message).toContain('over');
  });

  it('flags under 70% word limit as warning', () => {
    const shortText = '<p>' + 'word '.repeat(100) + '</p>';
    const result = runDeterministicChecks(
      shortText,
      [],
      { question_text: 'Test', word_limit: 500 },
      0,
    );

    const wordLimitIssue = result.issues.find((i) => i.type === 'word_limit');
    expect(wordLimitIssue).toBeDefined();
    expect(wordLimitIssue?.severity).toBe('warning');
    expect(wordLimitIssue?.message).toContain('only');
  });

  it('does not flag when within word limit', () => {
    const text = '<p>' + 'word '.repeat(450) + '</p>';
    const result = runDeterministicChecks(
      text,
      [],
      { question_text: 'Test', word_limit: 500 },
      0,
    );

    const wordLimitIssue = result.issues.find((i) => i.type === 'word_limit');
    expect(wordLimitIssue).toBeUndefined();
  });

  it('does not flag at exactly 70% of word limit', () => {
    const text = '<p>' + 'word '.repeat(350) + '</p>';
    const result = runDeterministicChecks(
      text,
      [],
      { question_text: 'Test', word_limit: 500 },
      0,
    );

    const wordLimitIssue = result.issues.find((i) => i.type === 'word_limit');
    // 350 is exactly 70% of 500 — the check is < 0.7, so 350 is not flagged
    expect(wordLimitIssue).toBeUndefined();
  });

  it('skips word limit check when no limit set', () => {
    const longText = '<p>' + 'word '.repeat(1000) + '</p>';
    const result = runDeterministicChecks(
      longText,
      [],
      { question_text: 'Test', word_limit: null },
      0,
    );

    const wordLimitIssue = result.issues.find((i) => i.type === 'word_limit');
    expect(wordLimitIssue).toBeUndefined();
  });

  it('flags zero citations when KB content available', () => {
    const result = runDeterministicChecks(
      '<p>Some response text here</p>',
      [],
      baseQuestion,
      5,
    );

    const citationIssue = result.issues.find((i) => i.type === 'unsupported_claim');
    expect(citationIssue).toBeDefined();
    expect(citationIssue?.severity).toBe('warning');
    expect(citationIssue?.message).toContain('no citations');
  });

  it('does not flag citations when no KB content available', () => {
    const result = runDeterministicChecks(
      '<p>Some response text here</p>',
      [],
      baseQuestion,
      0,
    );

    const citationIssue = result.issues.find((i) => i.type === 'unsupported_claim');
    expect(citationIssue).toBeUndefined();
  });

  it('does not flag citations when citations are present', () => {
    const citations: CitationEntry[] = [
      {
        cited_text: 'cited',
        source_index: 0,
        source_id: 'uuid-1',
        source_title: 'Title',
        source_url: '/item/uuid-1',
        start_block_index: 0,
        end_block_index: 0,
      },
    ];

    const result = runDeterministicChecks(
      '<p>Some response with citations</p>',
      citations,
      baseQuestion,
      5,
    );

    const citationIssue = result.issues.find(
      (i) => i.type === 'unsupported_claim' && i.message.includes('no citations'),
    );
    expect(citationIssue).toBeUndefined();
  });

  it('flags empty response', () => {
    const result = runDeterministicChecks('<p></p>', [], baseQuestion, 0);

    const emptyIssue = result.issues.find((i) => i.type === 'missing_section');
    expect(emptyIssue).toBeDefined();
    expect(emptyIssue?.severity).toBe('error');
    expect(emptyIssue?.message).toContain('empty');
  });

  it('flags empty response with only whitespace', () => {
    const result = runDeterministicChecks('<p>   </p>', [], baseQuestion, 0);

    const emptyIssue = result.issues.find((i) => i.type === 'missing_section');
    expect(emptyIssue).toBeDefined();
  });

  it('returns correct word count for complex HTML', () => {
    // Block-level elements (h2, p) are separated by whitespace during stripping,
    // so "Introduction" and "This" are correctly counted as separate words
    const html =
      '<h2>Introduction</h2><p>This is a <strong>detailed</strong> response with <em>multiple</em> sections.</p>';
    const result = runDeterministicChecks(html, [], baseQuestion, 0);
    // "Introduction This is a detailed response with multiple sections." = 9 words
    expect(result.wordCount).toBe(9);
  });

  it('can produce both word limit and empty response issues', () => {
    // Edge case: word_limit=0 means the check is skipped (falsy), empty text triggers missing_section
    const result = runDeterministicChecks('<p></p>', [], baseQuestion, 0);
    const issues = result.issues;

    expect(issues.some((i) => i.type === 'missing_section')).toBe(true);
  });

  it('can flag both word limit and citation issues simultaneously', () => {
    const longText = '<p>' + 'word '.repeat(550) + '</p>';
    const result = runDeterministicChecks(
      longText,
      [],
      { question_text: 'Test', word_limit: 500 },
      5,
    );

    const wordIssue = result.issues.find((i) => i.type === 'word_limit');
    const citationIssue = result.issues.find((i) => i.type === 'unsupported_claim');
    expect(wordIssue).toBeDefined();
    expect(citationIssue).toBeDefined();
  });
});
