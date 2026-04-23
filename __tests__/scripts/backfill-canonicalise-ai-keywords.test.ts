import { describe, it, expect } from 'vitest';
import { canonicaliseKeywords } from '../../scripts/backfill-canonicalise-ai-keywords';

/**
 * Tests for the backfill canonicaliseKeywords() logic.
 *
 * Spec: docs/specs/p0-tag-canonicalisation-classify-time-spec.md ss10.4.
 */

describe('canonicaliseKeywords', () => {
  it('returns changed=false for already-canonical keywords', () => {
    const input = ['audit', 'GDPR', 'risk management'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(false);
    expect(result).toEqual(['audit', 'GDPR', 'risk management']);
  });

  it('deduplicates case and plural variants', () => {
    // "audit", "Audit", "audits" all normalise to "audit"
    const input = ['audit', 'Audit', 'audits'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(true);
    // First occurrence wins
    expect(result).toEqual(['audit']);
  });

  it('normalises mixed keywords correctly', () => {
    const input = ['GDPR', 'audits', 'risk management'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(true);
    expect(result).toEqual(['GDPR', 'audit', 'risk management']);
  });

  it('handles empty array with no writes', () => {
    const input: string[] = [];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(false);
    expect(result).toEqual([]);
  });

  it('is idempotent — second pass produces no changes', () => {
    const input = ['GDPR', 'audits', 'risk management'];
    const first = canonicaliseKeywords(input);
    expect(first.changed).toBe(true);

    // Apply the result again
    const second = canonicaliseKeywords(first.result);
    expect(second.changed).toBe(false);
    expect(second.result).toEqual(first.result);
  });

  it('preserves proper nouns while normalising others', () => {
    const input = ['gdpr', 'ISO 27001', 'Systems', 'access'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(true);
    expect(result).toEqual(['GDPR', 'ISO 27001', 'system', 'access']);
  });

  it('filters out empty strings from normalised output', () => {
    const input = ['audit', '', '  ', 'GDPR'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(true);
    expect(result).toEqual(['audit', 'GDPR']);
  });

  it('collapses internal whitespace during normalisation', () => {
    const input = ['risk  management'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(true);
    expect(result).toEqual(['risk management']);
  });

  it('preserves order with first-occurrence dedup', () => {
    const input = ['Systems', 'audit', 'system', 'GDPR'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(true);
    // "Systems" normalises to "system", "system" normalises to "system" — first wins
    expect(result).toEqual(['system', 'audit', 'GDPR']);
  });

  it('does not touch user_tags-like data when given canonical input', () => {
    // This test verifies the function operates purely on the input it receives,
    // and does not attempt to modify any external data
    const input = ['audit', 'compliance'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(false);
    expect(result).toEqual(['audit', 'compliance']);
  });

  it('applies sis guard — does not corrupt analysis', () => {
    const input = ['analysis'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(false);
    expect(result).toEqual(['analysis']);
  });

  it('applies ous guard — does not corrupt continuous', () => {
    const input = ['continuous'];
    const { changed, result } = canonicaliseKeywords(input);
    expect(changed).toBe(false);
    expect(result).toEqual(['continuous']);
  });
});
