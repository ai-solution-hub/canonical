/**
 * Regression tests for S159 WP4a — empty-subtopic output-contract fix.
 *
 * Background: S158 WP2 ESM classification backfill found two
 * content_items rows (1003601a..., 93ff55ae...) with
 * `primary_subtopic = ''` (literal empty string) written by
 * `classifyContent`. Root cause: the Claude tool JSON schema declares
 * `primary_subtopic` as a required string with no `minLength`, so the
 * classifier emitted `""` to satisfy the required-string contract.
 * The DB column is nullable and accepted the empty string silently.
 *
 * Fix: `lib/ai/classify.ts` now exports `coerceSubtopic()` which
 * normalises empty / whitespace-only values to `null` before the
 * classifier result is written to the DB. A one-off migration
 * (`20260409164245_backfill_empty_subtopics_to_null.sql`) cleans up
 * the existing affected rows.
 *
 * Source:
 *   docs/specs/classifycontent-subtopic-contract-spec.md
 *   docs/audits/si-classification-verification-s156.md § Run 2
 *   docs/reference/post-mvp-roadmap.md §2.1.11
 */

import { describe, it, expect } from 'vitest';
import { coerceSubtopic } from '@/lib/ai/classify';

describe('S159 WP4a — coerceSubtopic empty-string fix', () => {
  it('coerces literal empty string to null', () => {
    expect(coerceSubtopic('')).toBeNull();
  });

  it('coerces whitespace-only strings to null', () => {
    expect(coerceSubtopic(' ')).toBeNull();
    expect(coerceSubtopic('   ')).toBeNull();
    expect(coerceSubtopic('\t\n')).toBeNull();
  });

  it('passes null through as null', () => {
    expect(coerceSubtopic(null)).toBeNull();
  });

  it('passes undefined through as null', () => {
    expect(coerceSubtopic(undefined)).toBeNull();
  });

  it('preserves a valid subtopic slug', () => {
    expect(coerceSubtopic('school-funding')).toBe('school-funding');
  });

  it('trims surrounding whitespace on valid values', () => {
    expect(coerceSubtopic('  school-funding  ')).toBe('school-funding');
  });

  it('preserves internal whitespace on valid values', () => {
    expect(coerceSubtopic('school funding')).toBe('school funding');
  });
});
