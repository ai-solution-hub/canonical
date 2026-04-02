/**
 * Tests for temporal reference reconciliation.
 * Suite 5 of the data flow integration test Phase 2.
 */

import { describe, it, expect } from 'vitest';
import type { ClassificationTemporalReference } from '@/lib/ai/classify';
import type { TemporalReference } from '@/lib/date-extraction';
import { reconcileTemporalReferences } from '@/lib/entities/temporal-reconciliation';

describe('reconcileTemporalReferences', () => {
  it('T5.1: deduplicates when AI and regex detect dates within the same month (fuzzy match)', () => {
    // AI returns "2025-06-25" and regex returns "2025-06-01" — different days,
    // same year-month. The spec requires these to be deduplicated as the same
    // reference, with AI's more precise date and context preserved.
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2025-06-25',
        context: 'ISO 27001 certification expiry',
        context_type: 'expiry',
      },
    ];
    const regexRefs: TemporalReference[] = [
      {
        date: '2025-06-01',
        type: 'expiry',
        confidence: 'high',
        context: 'certification expires June 2025',
      },
    ];

    const result = reconcileTemporalReferences(aiRefs, regexRefs);

    expect(result).toHaveLength(1);
    // AI's date should be preserved (AI takes precedence)
    expect(result[0].date).toBe('2025-06-25');
    expect(result[0].context_type).toBe('expiry');
    expect(result[0].source).toBe('both');
    // AI context should be preserved
    expect(result[0].context).toBe('ISO 27001 certification expiry');
  });

  it('T5.1b: deduplicates exact date+context_type matches', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2025-06-30',
        context: 'ISO 27001 certification expiry',
        context_type: 'expiry',
      },
    ];
    const regexRefs: TemporalReference[] = [
      {
        date: '2025-06-30',
        type: 'expiry',
        confidence: 'high',
        context: 'certification expires 30 June 2025',
      },
    ];

    const result = reconcileTemporalReferences(aiRefs, regexRefs);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2025-06-30');
    expect(result[0].context_type).toBe('expiry');
    expect(result[0].source).toBe('both');
    expect(result[0].context).toBe('ISO 27001 certification expiry');
  });

  it('T5.1c: does NOT deduplicate dates in different months', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2025-06-30',
        context: 'ISO 27001 certification expiry',
        context_type: 'expiry',
      },
    ];
    const regexRefs: TemporalReference[] = [
      {
        date: '2025-07-01',
        type: 'expiry',
        confidence: 'high',
        context: 'certification expires July 2025',
      },
    ];

    const result = reconcileTemporalReferences(aiRefs, regexRefs);

    // Different months — should NOT be deduplicated
    expect(result).toHaveLength(2);
  });

  it('T5.2: handles only AI references', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2024-01-15',
        context: 'Cyber Essentials awarded',
        context_type: 'effective',
      },
      {
        date: '2025-01-15',
        context: 'Cyber Essentials renewal',
        context_type: 'expiry',
      },
    ];

    const result = reconcileTemporalReferences(aiRefs, undefined);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.source === 'ai')).toBe(true);
    expect(result[0].date).toBe('2024-01-15');
    expect(result[1].date).toBe('2025-01-15');
  });

  it('T5.3: handles only regex references', () => {
    const regexRefs: TemporalReference[] = [
      {
        date: '2025-03-01',
        type: 'expiry',
        confidence: 'medium',
        context: 'expires March 2025',
      },
    ];

    const result = reconcileTemporalReferences(undefined, regexRefs);

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('regex');
    expect(result[0].date).toBe('2025-03-01');
    expect(result[0].context_type).toBe('expiry');
  });

  it('T5.4: keeps both when dates are different', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2025-06-30',
        context: 'ISO 27001 expiry',
        context_type: 'expiry',
      },
    ];
    const regexRefs: TemporalReference[] = [
      {
        date: '2024-01-15',
        type: 'effective',
        confidence: 'high',
        context: 'awarded January 2024',
      },
    ];

    const result = reconcileTemporalReferences(aiRefs, regexRefs);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.date === '2025-06-30')).toBeDefined();
    expect(result.find((r) => r.date === '2024-01-15')).toBeDefined();
  });

  it('T5.5: AI takes precedence when context_type disagrees for same date', () => {
    const aiRefs: ClassificationTemporalReference[] = [
      {
        date: '2025-06-30',
        context: 'ISO 27001 certification expiry',
        context_type: 'expiry',
      },
    ];
    const regexRefs: TemporalReference[] = [
      {
        date: '2025-06-30',
        type: 'historical',
        confidence: 'low',
        context: 'date mentioned: 30 June 2025',
      },
    ];

    const result = reconcileTemporalReferences(aiRefs, regexRefs);

    // AI classified it as 'expiry', regex as 'historical'
    // AI should win — the regex version with 'historical' should be skipped
    expect(result).toHaveLength(1);
    expect(result[0].context_type).toBe('expiry');
    expect(result[0].source).toBe('ai');
  });

  it('returns empty array when both inputs are undefined', () => {
    const result = reconcileTemporalReferences(undefined, undefined);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when both inputs are empty', () => {
    const result = reconcileTemporalReferences([], []);
    expect(result).toHaveLength(0);
  });
});
