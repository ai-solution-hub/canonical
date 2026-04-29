/**
 * Unit tests for `detectDraftFinalFromFilename`.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 §9.1.
 * Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T2 helpers).
 *
 * The heuristic is a case-insensitive substring scan: 'final' / 'draft' may
 * appear anywhere in the filename. If both are present (or neither), the
 * verdict is 'unknown'.
 */

import { describe, it, expect } from 'vitest';
import { detectDraftFinalFromFilename } from '@/lib/ingest/draft-final-heuristic';

describe('detectDraftFinalFromFilename', () => {
  it('returns "final" for filenames containing "final"', () => {
    expect(detectDraftFinalFromFilename('foo-final.md')).toBe('final');
  });

  it('returns "draft" for filenames containing "draft"', () => {
    expect(detectDraftFinalFromFilename('foo-draft.md')).toBe('draft');
  });

  it('returns "unknown" for filenames with neither marker', () => {
    expect(detectDraftFinalFromFilename('foo.md')).toBe('unknown');
  });

  it('is case-insensitive (mixed-case "Final")', () => {
    expect(detectDraftFinalFromFilename('FOO-Final.md')).toBe('final');
  });

  it('is case-insensitive (uppercase "DRAFT")', () => {
    expect(detectDraftFinalFromFilename('DRAFT-policy.MD')).toBe('draft');
  });

  it('matches the substring without a trailing extension', () => {
    expect(detectDraftFinalFromFilename('foo-final')).toBe('final');
  });

  it('matches the substring at the start of the filename', () => {
    expect(detectDraftFinalFromFilename('final-policy.md')).toBe('final');
  });

  it('matches the substring anywhere (not just as suffix)', () => {
    expect(detectDraftFinalFromFilename('final-something.md')).toBe('final');
  });

  it('returns "unknown" when both "draft" and "final" are present', () => {
    expect(detectDraftFinalFromFilename('draft-final.md')).toBe('unknown');
  });

  it('returns "unknown" for an empty filename', () => {
    expect(detectDraftFinalFromFilename('')).toBe('unknown');
  });

  it('handles filenames where the marker is embedded in a longer word', () => {
    // 'finalised' contains 'final' — heuristic still treats this as 'final'.
    // Documenting actual behaviour: substring match is unconditional.
    expect(detectDraftFinalFromFilename('policy-finalised.md')).toBe('final');
  });

  it('preserves the type narrowing to the literal triplet', () => {
    const result = detectDraftFinalFromFilename('foo.md');
    // Compile-time narrowing — assignable to the public union, nothing else.
    const narrowed: 'draft' | 'final' | 'unknown' = result;
    expect(narrowed).toBe('unknown');
  });
});
