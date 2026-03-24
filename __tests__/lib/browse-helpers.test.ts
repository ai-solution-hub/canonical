import { describe, it, expect } from 'vitest';
import {
  getSortOptionFromFilters,
  getSortFiltersFromOption,
  getCursorFromItem,
  isOffsetSort,
} from '@/lib/browse-helpers';
import type { ContentListItem } from '@/types/content';

// Minimal stub satisfying ContentListItem for cursor tests
function makeItem(
  overrides: Partial<ContentListItem> = {},
): ContentListItem {
  return {
    id: 'abc-123',
    title: 'Test Item',
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Technology',
    primary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    ai_keywords: null,
    classification_confidence: 0.85,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    verified_at: null,
    answer_standard: null,
    answer_advanced: null,
    ...overrides,
  } as ContentListItem;
}

// ---------------------------------------------------------------------------
// getSortOptionFromFilters
// ---------------------------------------------------------------------------

describe('getSortOptionFromFilters', () => {
  it('returns "domain" when sort is primary_domain', () => {
    expect(getSortOptionFromFilters('primary_domain')).toBe('domain');
  });

  it('returns "confidence" when sort is classification_confidence', () => {
    expect(getSortOptionFromFilters('classification_confidence')).toBe(
      'confidence',
    );
  });

  it('returns "freshness-stale" when sort is freshness and order is asc', () => {
    expect(getSortOptionFromFilters('freshness', 'asc')).toBe('freshness-stale');
  });

  it('returns "quality-lowest" when sort is quality_score and order is asc', () => {
    expect(getSortOptionFromFilters('quality_score', 'asc')).toBe('quality-lowest');
  });

  it('returns "date-asc" when order is asc (and sort is not domain/confidence)', () => {
    expect(getSortOptionFromFilters(undefined, 'asc')).toBe('date-asc');
    expect(getSortOptionFromFilters('captured_date', 'asc')).toBe('date-asc');
  });

  it('returns "date-desc" as the default fallback', () => {
    expect(getSortOptionFromFilters()).toBe('date-desc');
    expect(getSortOptionFromFilters(undefined, undefined)).toBe('date-desc');
    expect(getSortOptionFromFilters('captured_date', 'desc')).toBe('date-desc');
  });
});

// ---------------------------------------------------------------------------
// getSortFiltersFromOption
// ---------------------------------------------------------------------------

describe('getSortFiltersFromOption', () => {
  it('maps "date-desc" to captured_date descending', () => {
    expect(getSortFiltersFromOption('date-desc')).toEqual({
      sort: 'captured_date',
      order: 'desc',
    });
  });

  it('maps "date-asc" to captured_date ascending', () => {
    expect(getSortFiltersFromOption('date-asc')).toEqual({
      sort: 'captured_date',
      order: 'asc',
    });
  });

  it('maps "domain" to primary_domain ascending', () => {
    expect(getSortFiltersFromOption('domain')).toEqual({
      sort: 'primary_domain',
      order: 'asc',
    });
  });

  it('maps "confidence" to classification_confidence descending', () => {
    expect(getSortFiltersFromOption('confidence')).toEqual({
      sort: 'classification_confidence',
      order: 'desc',
    });
  });

  it('maps "freshness-stale" to freshness ascending', () => {
    expect(getSortFiltersFromOption('freshness-stale')).toEqual({
      sort: 'freshness',
      order: 'asc',
    });
  });

  it('maps "quality-lowest" to quality_score ascending', () => {
    expect(getSortFiltersFromOption('quality-lowest')).toEqual({
      sort: 'quality_score',
      order: 'asc',
    });
  });
});

// ---------------------------------------------------------------------------
// getCursorFromItem
// ---------------------------------------------------------------------------

describe('getCursorFromItem', () => {
  it('builds a confidence cursor from classification_confidence and id', () => {
    const item = makeItem({ classification_confidence: 0.92, id: 'item-1' });
    expect(getCursorFromItem(item, 'classification_confidence')).toBe(
      '0.92|item-1',
    );
  });

  it('returns null for confidence cursor when classification_confidence is null', () => {
    const item = makeItem({ classification_confidence: null });
    expect(getCursorFromItem(item, 'classification_confidence')).toBeNull();
  });

  it('builds a domain cursor from primary_domain, captured_date and id', () => {
    const item = makeItem({
      primary_domain: 'Health & Safety',
      captured_date: '2026-02-20',
      id: 'item-2',
    });
    expect(getCursorFromItem(item, 'primary_domain')).toBe(
      'Health & Safety|2026-02-20|item-2',
    );
  });

  it('returns null for domain cursor when primary_domain is missing', () => {
    const item = makeItem({ primary_domain: null });
    expect(getCursorFromItem(item, 'primary_domain')).toBeNull();
  });

  it('returns null for domain cursor when captured_date is missing', () => {
    const item = makeItem({ captured_date: null });
    expect(getCursorFromItem(item, 'primary_domain')).toBeNull();
  });

  it('returns captured_date as the default date cursor', () => {
    const item = makeItem({ captured_date: '2026-03-01T12:00:00Z' });
    expect(getCursorFromItem(item, 'captured_date')).toBe(
      '2026-03-01T12:00:00Z',
    );
  });

  it('returns null for date cursor when captured_date is null', () => {
    const item = makeItem({ captured_date: null });
    expect(getCursorFromItem(item, 'captured_date')).toBeNull();
  });

  it('returns null for freshness sort (uses offset pagination)', () => {
    const item = makeItem({ freshness: 'stale' });
    expect(getCursorFromItem(item, 'freshness')).toBeNull();
  });

  it('returns null for quality_score sort (uses offset pagination)', () => {
    const item = makeItem();
    expect(getCursorFromItem(item, 'quality_score')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isOffsetSort
// ---------------------------------------------------------------------------

describe('isOffsetSort', () => {
  it('returns true for freshness sort', () => {
    expect(isOffsetSort('freshness')).toBe(true);
  });

  it('returns true for quality_score sort', () => {
    expect(isOffsetSort('quality_score')).toBe(true);
  });

  it('returns false for captured_date sort', () => {
    expect(isOffsetSort('captured_date')).toBe(false);
  });

  it('returns false for primary_domain sort', () => {
    expect(isOffsetSort('primary_domain')).toBe(false);
  });

  it('returns false for classification_confidence sort', () => {
    expect(isOffsetSort('classification_confidence')).toBe(false);
  });
});
