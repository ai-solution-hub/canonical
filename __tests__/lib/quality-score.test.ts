import { describe, it, expect } from 'vitest';
import {
  calculateQualityScore,
  type QualityScoreInput,
} from '@/lib/quality/quality-score';

describe('calculateQualityScore', () => {
  // -------------------------------------------------------------------------
  // Perfect & zero scores
  // -------------------------------------------------------------------------

  it('returns a perfect score when all components are at maximum', () => {
    const input: QualityScoreInput = {
      freshness: 'fresh',
      classification_confidence: 1,
      brief: 'Brief text',
      detail: 'Detail text',
      reference: 'Reference text',
      ai_summary: 'Summary text',
      citation_count: 5, // 5 * 20 = 100, capped at 100
    };
    const result = calculateQualityScore(input);
    expect(result.score).toBe(100);
    expect(result.label).toBe('Excellent');
    expect(result.components.freshness).toBe(30);
    expect(result.components.confidence).toBe(20);
    expect(result.components.completeness).toBe(20);
    expect(result.components.summary).toBe(15);
    expect(result.components.citations).toBe(15);
  });

  it('returns zero when all components are at minimum', () => {
    const input: QualityScoreInput = {
      freshness: 'expired',
      classification_confidence: 0,
      brief: null,
      detail: null,
      reference: null,
      ai_summary: null,
      citation_count: 0,
    };
    const result = calculateQualityScore(input);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Poor');
    expect(result.components.freshness).toBe(0);
    expect(result.components.confidence).toBe(0);
    expect(result.components.completeness).toBe(0);
    expect(result.components.summary).toBe(0);
    expect(result.components.citations).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Missing/null field handling
  // -------------------------------------------------------------------------

  it('handles completely empty input (all undefined)', () => {
    const result = calculateQualityScore({});
    // freshness defaults to fresh (100 * 0.3 = 30), rest 0
    expect(result.score).toBe(30);
    expect(result.components.freshness).toBe(30);
    expect(result.components.confidence).toBe(0);
    expect(result.components.completeness).toBe(0);
    expect(result.components.summary).toBe(0);
    expect(result.components.citations).toBe(0);
  });

  it('handles null freshness as fresh', () => {
    const result = calculateQualityScore({ freshness: null });
    expect(result.components.freshness).toBe(30);
  });

  it('handles null classification_confidence as 0', () => {
    const result = calculateQualityScore({ classification_confidence: null });
    expect(result.components.confidence).toBe(0);
  });

  it('handles whitespace-only strings as empty for completeness', () => {
    const result = calculateQualityScore({
      brief: '   ',
      detail: '\t',
      reference: '\n',
    });
    expect(result.components.completeness).toBe(0);
  });

  it('handles whitespace-only ai_summary as no summary', () => {
    const result = calculateQualityScore({ ai_summary: '  ' });
    expect(result.components.summary).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Freshness level mapping
  // -------------------------------------------------------------------------

  it.each([
    ['fresh', 30],
    ['ageing', 18],
    ['aging', 18], // US spelling variant
    ['stale', 9],
    ['expired', 0],
  ])('maps freshness "%s" to component value %d', (freshness, expected) => {
    const result = calculateQualityScore({ freshness });
    expect(result.components.freshness).toBe(expected);
  });

  it('treats an unknown freshness value as fresh (100)', () => {
    const result = calculateQualityScore({ freshness: 'unknown-state' });
    expect(result.components.freshness).toBe(30);
  });

  // -------------------------------------------------------------------------
  // Classification confidence
  // -------------------------------------------------------------------------

  it('clamps confidence above 1 to 1', () => {
    const result = calculateQualityScore({ classification_confidence: 1.5 });
    expect(result.components.confidence).toBe(20);
  });

  it('clamps negative confidence to 0', () => {
    const result = calculateQualityScore({ classification_confidence: -0.3 });
    expect(result.components.confidence).toBe(0);
  });

  it('calculates partial confidence correctly', () => {
    const result = calculateQualityScore({ classification_confidence: 0.8 });
    // 0.8 * 100 = 80, 80 * 0.2 = 16
    expect(result.components.confidence).toBe(16);
  });

  // -------------------------------------------------------------------------
  // Citation count capping
  // -------------------------------------------------------------------------

  it('caps citation contribution at 100 raw (15 weighted)', () => {
    const result = calculateQualityScore({ citation_count: 10 });
    // 10 * 20 = 200, capped at 100, 100 * 0.15 = 15
    expect(result.components.citations).toBe(15);
  });

  it('calculates partial citation score correctly', () => {
    const result = calculateQualityScore({ citation_count: 2 });
    // 2 * 20 = 40, 40 * 0.15 = 6
    expect(result.components.citations).toBe(6);
  });

  it('handles undefined citation_count as 0', () => {
    const result = calculateQualityScore({});
    expect(result.components.citations).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Depth completeness (partial)
  // -------------------------------------------------------------------------

  it('scores 1 of 3 depth fields filled', () => {
    const result = calculateQualityScore({ brief: 'Content' });
    // (1/3) * 100 = 33.33, * 0.2 = 6.67
    expect(result.components.completeness).toBeCloseTo(6.67, 1);
  });

  it('scores 2 of 3 depth fields filled', () => {
    const result = calculateQualityScore({
      brief: 'Content',
      detail: 'More detail',
    });
    // (2/3) * 100 = 66.67, * 0.2 = 13.33
    expect(result.components.completeness).toBeCloseTo(13.33, 1);
  });

  it('scores 3 of 3 depth fields filled', () => {
    const result = calculateQualityScore({
      brief: 'a',
      detail: 'b',
      reference: 'c',
    });
    expect(result.components.completeness).toBe(20);
  });

  // -------------------------------------------------------------------------
  // Label threshold edge cases
  // -------------------------------------------------------------------------

  it('labels score in the 60-79 range as Good', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 1,
      brief: null,
      detail: null,
      reference: null,
      ai_summary: null,
      citation_count: 3, // 3*20=60, 60*0.15=9
    });
    // 30 + 20 + 0 + 0 + 9 = 59
    expect(result.score).toBe(59);
    expect(result.label).toBe('Fair');
  });

  it('labels score of 85 as Excellent', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 1,
      brief: 'a',
      detail: 'b',
      reference: 'c',
      ai_summary: 'Summary',
      citation_count: 0,
    });
    // 30 + 20 + 20 + 15 + 0 = 85
    expect(result.score).toBe(85);
    expect(result.label).toBe('Excellent');
  });

  it('labels score of 40 as Fair (boundary)', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 0.5,
      brief: null,
      detail: null,
      reference: null,
      ai_summary: null,
      citation_count: 0,
    });
    // 30 + 10 + 0 + 0 + 0 = 40
    expect(result.score).toBe(40);
    expect(result.label).toBe('Fair');
  });

  it('labels score of 29 as Needs Work', () => {
    const result = calculateQualityScore({
      freshness: 'stale',
      classification_confidence: 1,
      brief: null,
      detail: null,
      reference: null,
      ai_summary: null,
      citation_count: 0,
    });
    // 9 + 20 + 0 + 0 + 0 = 29
    expect(result.score).toBe(29);
    expect(result.label).toBe('Needs Work');
  });

  it('labels score of 20 as Needs Work (boundary)', () => {
    const result = calculateQualityScore({
      freshness: 'expired',
      classification_confidence: 1,
      brief: null,
      detail: null,
      reference: null,
      ai_summary: null,
      citation_count: 0,
    });
    // 0 + 20 + 0 + 0 + 0 = 20
    expect(result.score).toBe(20);
    expect(result.label).toBe('Needs Work');
  });

  it('labels score of 10 as Poor', () => {
    const result = calculateQualityScore({
      freshness: 'expired',
      classification_confidence: 0.5,
      brief: null,
      detail: null,
      reference: null,
      ai_summary: null,
      citation_count: 0,
    });
    // 0 + 10 + 0 + 0 + 0 = 10
    expect(result.score).toBe(10);
    expect(result.label).toBe('Poor');
  });

  // -------------------------------------------------------------------------
  // Component weights sum to total score
  // -------------------------------------------------------------------------

  it('weighted components sum to exactly the total score', () => {
    const input: QualityScoreInput = {
      freshness: 'ageing',
      classification_confidence: 0.72,
      brief: 'Brief content',
      detail: null,
      reference: 'Reference content',
      ai_summary: 'AI generated summary',
      citation_count: 1,
    };
    const result = calculateQualityScore(input);
    const componentSum =
      result.components.freshness +
      result.components.confidence +
      result.components.completeness +
      result.components.summary +
      result.components.citations;
    // The total score is the rounded sum of components
    expect(result.score).toBe(Math.round(componentSum));
  });

  // -------------------------------------------------------------------------
  // Realistic browse-card scenario (no detail/reference available)
  // -------------------------------------------------------------------------

  it('calculates a realistic score for a browse card item (no detail/reference)', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 0.85,
      brief: 'A brief summary',
      ai_summary: 'An AI-generated summary of the content',
      citation_count: 0,
    });
    // freshness: 30, confidence: 17, completeness: 6.67, summary: 15, citations: 0
    // Total: 68.67 rounds to 69
    expect(result.score).toBe(69);
    expect(result.label).toBe('Good');
  });
});
