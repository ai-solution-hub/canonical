/**
 * Unit tests for extractAnswerFromContent helper.
 *
 * Verifies the answer extraction logic used by Paths 2, 4, and 5 at insert
 * time to populate answer_standard without the Q: prefix.
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss4.6.
 */
import { describe, it, expect } from 'vitest';
import { extractAnswerFromContent } from '@/lib/bid-library-ingest/extract-answer';

describe('extractAnswerFromContent', () => {
  it('extracts answer from composite "Q: {question}\\n\\n{answer}" content', () => {
    const composite = 'Q: What is your quality policy?\n\nWe follow ISO 9001 standards.';
    expect(extractAnswerFromContent(composite)).toBe(
      'We follow ISO 9001 standards.',
    );
  });

  it('returns content unchanged when no Q: prefix', () => {
    const plainAnswer = 'We follow ISO 9001 standards.';
    expect(extractAnswerFromContent(plainAnswer)).toBe(plainAnswer);
  });

  it('returns content unchanged when Q: prefix but no \\n\\n separator', () => {
    const singleLine = 'Q: What is your policy?';
    expect(extractAnswerFromContent(singleLine)).toBe(singleLine);
  });

  it('returns empty string for null input', () => {
    expect(extractAnswerFromContent(null)).toBe('');
  });

  it('returns empty string for undefined input', () => {
    expect(extractAnswerFromContent(undefined)).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(extractAnswerFromContent('')).toBe('');
  });

  it('handles multi-paragraph answers correctly', () => {
    const composite =
      'Q: How do you handle complaints?\n\nWe have a formal process.\n\nStep 1: Log the complaint.\n\nStep 2: Investigate.';
    expect(extractAnswerFromContent(composite)).toBe(
      'We have a formal process.\n\nStep 1: Log the complaint.\n\nStep 2: Investigate.',
    );
  });

  it('handles answer that starts with Q: but is not a question prefix', () => {
    // Content that doesn't start with "Q: " should pass through
    const notQuestion = 'Quality assurance is important.\n\nWe follow best practices.';
    expect(extractAnswerFromContent(notQuestion)).toBe(notQuestion);
  });

  it('is idempotent — applying to already-extracted answer is a no-op', () => {
    const answer = 'We follow ISO 9001 standards.';
    expect(extractAnswerFromContent(answer)).toBe(answer);
    // Double application
    expect(extractAnswerFromContent(extractAnswerFromContent(answer))).toBe(
      answer,
    );
  });

  it('handles composite content with standard and advanced answers', () => {
    const composite =
      'Q: What is your waste policy?\n\nWe recycle 90% of waste.\n\nOur advanced programme includes zero-to-landfill targets.';
    expect(extractAnswerFromContent(composite)).toBe(
      'We recycle 90% of waste.\n\nOur advanced programme includes zero-to-landfill targets.',
    );
  });
});
