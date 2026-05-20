import { describe, expect, it } from 'vitest';
import { inferLayer, type LayerInferenceInput } from '@/lib/layer-inference';

// ---------------------------------------------------------------------------
// Helper — returns a default input with all flags false / neutral
// ---------------------------------------------------------------------------

function baseInput(
  overrides: Partial<LayerInferenceInput> = {},
): LayerInferenceInput {
  return {
    contentType: 'article',
    contentLength: 1000,
    ingestionSource: 'manual',
    hasBrief: false,
    hasDetail: false,
    hasReference: false,
    isBidDiscovered: false,
    title: 'Test item',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1: Procurement-discovered content
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 1: Procurement-discovered content', () => {
  it('returns bid_detail with high confidence when isBidDiscovered is true', () => {
    const result = inferLayer(baseInput({ isBidDiscovered: true }));
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('bid workspace');
  });

  it('overrides other signals when isBidDiscovered is true', () => {
    // Even if content type is research, bid-discovered wins
    const result = inferLayer(
      baseInput({
        isBidDiscovered: true,
        contentType: 'research',
        ingestionSource: 'url_import',
        hasReference: true,
      }),
    );
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Rule 2: Procurement library Q&A pairs
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 2: Procurement library Q&A pairs', () => {
  it('returns bid_detail with high confidence for bid library Q&A pairs', () => {
    const result = inferLayer(
      baseInput({ ingestionSource: 'bid_library', contentType: 'q_a_pair' }),
    );
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('bid documents');
  });

  it('does not trigger for bid_library with non-Q&A content type', () => {
    const result = inferLayer(
      baseInput({ ingestionSource: 'bid_library', contentType: 'article' }),
    );
    // Should fall through to later rules, not Rule 2
    expect(result.reason).not.toContain('bid documents');
  });

  it('does not trigger for Q&A pairs from non-bid-library sources', () => {
    const result = inferLayer(
      baseInput({
        ingestionSource: 'manual',
        contentType: 'q_a_pair',
        contentLength: 200,
      }),
    );
    // Should hit Rule 5 (short Q&A), not Rule 2
    expect(result.suggestedLayer).toBe('sales_brief');
    expect(result.reason).toContain('Short Q&A');
  });
});

// ---------------------------------------------------------------------------
// Rule 3: Progressive depth field presence
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 3: Progressive depth fields', () => {
  it('returns company_reference with high confidence when hasReference is true', () => {
    const result = inferLayer(baseInput({ hasReference: true }));
    expect(result.suggestedLayer).toBe('company_reference');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Reference field');
  });

  it('returns bid_detail with medium confidence when hasBrief and hasDetail', () => {
    const result = inferLayer(baseInput({ hasBrief: true, hasDetail: true }));
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('brief and detail');
  });

  it('returns sales_brief with medium confidence when hasBrief only', () => {
    const result = inferLayer(baseInput({ hasBrief: true, hasDetail: false }));
    expect(result.suggestedLayer).toBe('sales_brief');
    expect(result.confidence).toBe('medium');
    expect(result.reason).toContain('Brief field');
  });

  it('reference takes precedence over brief+detail', () => {
    const result = inferLayer(
      baseInput({ hasReference: true, hasBrief: true, hasDetail: true }),
    );
    expect(result.suggestedLayer).toBe('company_reference');
    expect(result.confidence).toBe('high');
  });

  it('brief+detail takes precedence over brief only', () => {
    // Both true should not produce sales_brief
    const result = inferLayer(baseInput({ hasBrief: true, hasDetail: true }));
    expect(result.suggestedLayer).toBe('bid_detail');
  });
});

// ---------------------------------------------------------------------------
// Rule 4: Content type mapping
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 4: Content type mapping', () => {
  it.each([
    ['policy', 'company_reference', 'medium'],
    ['compliance', 'company_reference', 'medium'],
    ['certification', 'company_reference', 'medium'],
  ] as const)(
    'maps %s to %s (%s confidence)',
    (contentType, expectedLayer, expectedConfidence) => {
      const result = inferLayer(baseInput({ contentType }));
      expect(result.suggestedLayer).toBe(expectedLayer);
      expect(result.confidence).toBe(expectedConfidence);
    },
  );

  it('maps research content type to research layer with high confidence', () => {
    const result = inferLayer(baseInput({ contentType: 'research' }));
    expect(result.suggestedLayer).toBe('research');
    expect(result.confidence).toBe('high');
    expect(result.reason).toContain('Research content type');
  });

  it('maps case_study to bid_detail with medium confidence', () => {
    const result = inferLayer(baseInput({ contentType: 'case_study' }));
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('medium');
  });

  it.each(['product_description', 'capability', 'methodology'])(
    'maps %s to bid_detail with medium confidence',
    (contentType) => {
      const result = inferLayer(baseInput({ contentType }));
      expect(result.suggestedLayer).toBe('bid_detail');
      expect(result.confidence).toBe('medium');
      expect(result.reason).toContain('bid-level detail');
    },
  );
});

// ---------------------------------------------------------------------------
// Rule 5: Content length heuristics
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 5: Content length heuristics', () => {
  it('returns sales_brief for short Q&A pairs (< 500 chars)', () => {
    const result = inferLayer(
      baseInput({ contentType: 'q_a_pair', contentLength: 200 }),
    );
    expect(result.suggestedLayer).toBe('sales_brief');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Short Q&A');
  });

  it('returns bid_detail for detailed Q&A pairs (>= 500 chars)', () => {
    const result = inferLayer(
      baseInput({ contentType: 'q_a_pair', contentLength: 500 }),
    );
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Detailed Q&A');
  });

  it('returns bid_detail for long Q&A pairs (1000 chars)', () => {
    const result = inferLayer(
      baseInput({ contentType: 'q_a_pair', contentLength: 1000 }),
    );
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('low');
  });

  it('Q&A boundary: 499 chars -> sales_brief, 500 chars -> bid_detail', () => {
    const short = inferLayer(
      baseInput({ contentType: 'q_a_pair', contentLength: 499 }),
    );
    expect(short.suggestedLayer).toBe('sales_brief');

    const long = inferLayer(
      baseInput({ contentType: 'q_a_pair', contentLength: 500 }),
    );
    expect(long.suggestedLayer).toBe('bid_detail');
  });

  it('returns sales_brief for very short content (< 300 chars)', () => {
    const result = inferLayer(baseInput({ contentLength: 100 }));
    expect(result.suggestedLayer).toBe('sales_brief');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Very short');
  });

  it('returns company_reference for very long content (> 3000 chars)', () => {
    const result = inferLayer(baseInput({ contentLength: 5000 }));
    expect(result.suggestedLayer).toBe('company_reference');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Long content');
  });

  it('boundary: 300 chars is not "very short"', () => {
    const result = inferLayer(baseInput({ contentLength: 300 }));
    // 300 chars, article type, manual source -> should not hit Rule 5 short
    expect(result.suggestedLayer).not.toBe('sales_brief');
  });

  it('boundary: 3000 chars is not "very long"', () => {
    const result = inferLayer(baseInput({ contentLength: 3000 }));
    expect(result.suggestedLayer).not.toBe('company_reference');
  });
});

// ---------------------------------------------------------------------------
// Rule 6: Source-based fallback
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 6: Source-based fallback', () => {
  it('returns research for url_import when no earlier rule matches', () => {
    const result = inferLayer(
      baseInput({ ingestionSource: 'url_import', contentLength: 1000 }),
    );
    expect(result.suggestedLayer).toBe('research');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Web-imported');
  });

  it('url_import is overridden by content type rules', () => {
    const result = inferLayer(
      baseInput({
        ingestionSource: 'url_import',
        contentType: 'policy',
        contentLength: 1000,
      }),
    );
    // Rule 4 (policy -> company_reference) should fire before Rule 6
    expect(result.suggestedLayer).toBe('company_reference');
  });
});

// ---------------------------------------------------------------------------
// Rule 7: Default
// ---------------------------------------------------------------------------

describe('inferLayer — Rule 7: Default', () => {
  it('returns bid_detail with low confidence when no other rule matches', () => {
    // article, 1000 chars, manual, no depth fields, not bid-discovered
    const result = inferLayer(baseInput());
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('low');
    expect(result.reason).toContain('Default');
  });

  it('falls through to default for blog type with medium length', () => {
    const result = inferLayer(
      baseInput({ contentType: 'blog', contentLength: 1500 }),
    );
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe('inferLayer — Priority ordering', () => {
  it('Rule 1 (bid-discovered) beats Rule 2 (bid library)', () => {
    const result = inferLayer(
      baseInput({
        isBidDiscovered: true,
        ingestionSource: 'bid_library',
        contentType: 'q_a_pair',
      }),
    );
    expect(result.reason).toContain('bid workspace');
  });

  it('Rule 2 (bid library) beats Rule 3 (depth fields)', () => {
    const result = inferLayer(
      baseInput({
        ingestionSource: 'bid_library',
        contentType: 'q_a_pair',
        hasReference: true,
      }),
    );
    expect(result.reason).toContain('bid documents');
  });

  it('Rule 3 (depth fields) beats Rule 4 (content type)', () => {
    const result = inferLayer(
      baseInput({
        hasReference: true,
        contentType: 'research',
      }),
    );
    expect(result.suggestedLayer).toBe('company_reference');
    expect(result.reason).toContain('Reference field');
  });

  it('Rule 4 (content type) beats Rule 5 (length)', () => {
    // Policy with very short content — Rule 4 should win over Rule 5
    const result = inferLayer(
      baseInput({
        contentType: 'policy',
        contentLength: 100,
      }),
    );
    expect(result.suggestedLayer).toBe('company_reference');
    expect(result.confidence).toBe('medium');
  });

  it('Rule 5 (length) beats Rule 6 (source)', () => {
    // Very short url_import — Rule 5 should win over Rule 6
    const result = inferLayer(
      baseInput({
        ingestionSource: 'url_import',
        contentLength: 100,
      }),
    );
    expect(result.suggestedLayer).toBe('sales_brief');
    expect(result.reason).toContain('Very short');
  });

  it('Rule 6 (source) beats Rule 7 (default)', () => {
    const result = inferLayer(
      baseInput({
        ingestionSource: 'url_import',
        contentLength: 1000,
      }),
    );
    expect(result.suggestedLayer).toBe('research');
    expect(result.reason).toContain('Web-imported');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('inferLayer — Edge cases', () => {
  it('handles empty title', () => {
    const result = inferLayer(baseInput({ title: '' }));
    expect(result).toBeDefined();
    expect(result.suggestedLayer).toBeTruthy();
  });

  it('handles zero content length', () => {
    const result = inferLayer(baseInput({ contentLength: 0 }));
    expect(result.suggestedLayer).toBe('sales_brief');
    expect(result.reason).toContain('Very short');
  });

  it('handles all depth fields false', () => {
    const result = inferLayer(
      baseInput({ hasBrief: false, hasDetail: false, hasReference: false }),
    );
    // Should fall through to later rules
    expect(result).toBeDefined();
  });

  it('handles unknown content type', () => {
    const result = inferLayer(baseInput({ contentType: 'unknown_type' }));
    // Not in any Rule 4 set, not Q&A for Rule 5 — should reach Rule 7
    expect(result.suggestedLayer).toBe('bid_detail');
    expect(result.confidence).toBe('low');
  });

  it('handles very large content length', () => {
    const result = inferLayer(baseInput({ contentLength: 1_000_000 }));
    expect(result.suggestedLayer).toBe('company_reference');
    expect(result.confidence).toBe('low');
  });

  it('returns a valid LayerSuggestion shape for all inputs', () => {
    const inputs: LayerInferenceInput[] = [
      baseInput(),
      baseInput({ isBidDiscovered: true }),
      baseInput({ ingestionSource: 'bid_library', contentType: 'q_a_pair' }),
      baseInput({ hasReference: true }),
      baseInput({ hasBrief: true, hasDetail: true }),
      baseInput({ hasBrief: true }),
      baseInput({ contentType: 'policy' }),
      baseInput({ contentType: 'research' }),
      baseInput({ contentType: 'case_study' }),
      baseInput({ contentType: 'q_a_pair', contentLength: 200 }),
      baseInput({ contentType: 'q_a_pair', contentLength: 800 }),
      baseInput({ contentLength: 100 }),
      baseInput({ contentLength: 5000 }),
      baseInput({ ingestionSource: 'url_import' }),
    ];

    for (const input of inputs) {
      const result = inferLayer(input);
      expect(result.suggestedLayer).toMatch(
        /^(sales_brief|bid_detail|company_reference|research)$/,
      );
      expect(result.confidence).toMatch(/^(high|medium|low)$/);
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe('string');
    }
  });
});
