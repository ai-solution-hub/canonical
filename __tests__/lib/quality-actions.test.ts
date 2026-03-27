import { describe, it, expect, beforeEach } from 'vitest';
import {
  suggestQualityActions,
  getTopQualityActions,
  type QualityActionInput,
} from '@/lib/quality/quality-actions';
import { createMockSupabaseClient, type MockSupabaseClient } from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a default well-scored item (no deficiencies). */
function makeItem(overrides: Partial<QualityActionInput> = {}): QualityActionInput {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: null,
    content_type: 'article',
    primary_domain: 'Corporate Information',
    primary_subtopic: 'Company History',
    freshness: 'fresh',
    classification_confidence: 0.9,
    ai_summary: 'A comprehensive summary of the content that is long enough to pass the threshold check easily.',
    brief: 'Brief content here',
    detail: 'Detailed content here',
    reference: 'Reference content here',
    content_owner_id: 'user-1',
    source_url: 'https://example.com/article',
    quality_score: 85,
    previous_quality_score: 80,
    citation_count: 3,
    metadata: { citation_count: 3 },
    ...overrides,
  };
}

describe('suggestQualityActions', () => {
  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------

  it('returns empty array for empty input', () => {
    const result = suggestQualityActions([]);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Items above threshold get no actions (well-scored items)
  // -------------------------------------------------------------------------

  it('returns no actions for a fully complete, high-quality item', () => {
    const item = makeItem();
    const result = suggestQualityActions([item]);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Freshness actions
  // -------------------------------------------------------------------------

  it('suggests freshness action for stale item', () => {
    const item = makeItem({ id: 'stale-1', freshness: 'stale' });
    const actions = suggestQualityActions([item]);
    const freshnessActions = actions.filter(a => a.category === 'freshness');

    expect(freshnessActions).toHaveLength(1);
    expect(freshnessActions[0].priority).toBe('medium');
    expect(freshnessActions[0].action).toContain('stale');
    expect(freshnessActions[0].itemId).toBe('stale-1');
  });

  it('suggests high-priority freshness action for expired item', () => {
    const item = makeItem({ id: 'expired-1', freshness: 'expired' });
    const actions = suggestQualityActions([item]);
    const freshnessActions = actions.filter(a => a.category === 'freshness');

    expect(freshnessActions).toHaveLength(1);
    expect(freshnessActions[0].priority).toBe('high');
    expect(freshnessActions[0].action).toContain('expired');
    expect(freshnessActions[0].estimatedScoreImpact).toBe(30);
  });

  it('does not suggest freshness action for fresh items', () => {
    const item = makeItem({ freshness: 'fresh' });
    const actions = suggestQualityActions([item]);
    const freshnessActions = actions.filter(a => a.category === 'freshness');
    expect(freshnessActions).toHaveLength(0);
  });

  it('does not suggest freshness action for ageing items', () => {
    const item = makeItem({ freshness: 'ageing' });
    const actions = suggestQualityActions([item]);
    const freshnessActions = actions.filter(a => a.category === 'freshness');
    expect(freshnessActions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Classification confidence actions
  // -------------------------------------------------------------------------

  it('suggests reclassify action for low confidence item', () => {
    const item = makeItem({
      id: 'low-conf-1',
      classification_confidence: 0.3,
    });
    const actions = suggestQualityActions([item]);
    const classActions = actions.filter(a => a.category === 'classification');

    expect(classActions).toHaveLength(1);
    expect(classActions[0].priority).toBe('high');
    expect(classActions[0].action).toContain('Reclassify');
    expect(classActions[0].action).toContain('30%');
  });

  it('does not suggest reclassify for confidence >= 0.6', () => {
    const item = makeItem({ classification_confidence: 0.6 });
    const actions = suggestQualityActions([item]);
    const classActions = actions.filter(a => a.category === 'classification');
    expect(classActions).toHaveLength(0);
  });

  it('suggests reclassify for confidence just below 0.6', () => {
    const item = makeItem({ classification_confidence: 0.59 });
    const actions = suggestQualityActions([item]);
    const classActions = actions.filter(a => a.category === 'classification');
    expect(classActions).toHaveLength(1);
    expect(classActions[0].priority).toBe('high');
  });

  it('does not suggest reclassify for null confidence', () => {
    const item = makeItem({ classification_confidence: null });
    const actions = suggestQualityActions([item]);
    const classActions = actions.filter(a => a.category === 'classification');
    expect(classActions).toHaveLength(0);
  });

  it('estimates correct score impact for low confidence', () => {
    const item = makeItem({ classification_confidence: 0.2 });
    const actions = suggestQualityActions([item]);
    const classAction = actions.find(a => a.category === 'classification');

    // (1 - 0.2) * 20 = 16
    expect(classAction?.estimatedScoreImpact).toBe(16);
  });

  // -------------------------------------------------------------------------
  // Missing summary actions
  // -------------------------------------------------------------------------

  it('suggests generate summary for item without ai_summary', () => {
    const item = makeItem({ id: 'no-summary', ai_summary: null });
    const actions = suggestQualityActions([item]);
    const summaryActions = actions.filter(
      a => a.category === 'summary' && a.action.includes('Generate'),
    );

    expect(summaryActions).toHaveLength(1);
    expect(summaryActions[0].priority).toBe('high');
    expect(summaryActions[0].estimatedScoreImpact).toBe(15);
  });

  it('does not suggest generate summary when ai_summary exists', () => {
    const item = makeItem({ ai_summary: 'This is a long enough summary to exceed the threshold.' });
    const actions = suggestQualityActions([item]);
    const generateActions = actions.filter(
      a => a.category === 'summary' && a.action.includes('Generate'),
    );
    expect(generateActions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Short summary actions
  // -------------------------------------------------------------------------

  it('suggests improve summary for very short summary', () => {
    const item = makeItem({
      id: 'short-summary',
      ai_summary: 'Brief.',
    });
    const actions = suggestQualityActions([item]);
    const improveActions = actions.filter(
      a => a.category === 'summary' && a.action.includes('Improve'),
    );

    expect(improveActions).toHaveLength(1);
    expect(improveActions[0].priority).toBe('low');
    expect(improveActions[0].action).toContain('6 chars');
  });

  it('does not suggest improve summary for adequately long summary', () => {
    const item = makeItem({
      ai_summary: 'This is a summary that is clearly over fifty characters in total length.',
    });
    const actions = suggestQualityActions([item]);
    const improveActions = actions.filter(
      a => a.category === 'summary' && a.action.includes('Improve'),
    );
    expect(improveActions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Missing owner actions
  // -------------------------------------------------------------------------

  it('suggests assign owner for item without content_owner_id', () => {
    const item = makeItem({ id: 'no-owner', content_owner_id: null });
    const actions = suggestQualityActions([item]);
    const ownerActions = actions.filter(
      a => a.action.includes('Assign content owner'),
    );

    expect(ownerActions).toHaveLength(1);
    expect(ownerActions[0].priority).toBe('medium');
    expect(ownerActions[0].category).toBe('completeness');
  });

  // -------------------------------------------------------------------------
  // Missing source URL actions
  // -------------------------------------------------------------------------

  it('suggests add source URL for item without source_url', () => {
    const item = makeItem({ id: 'no-url', source_url: null });
    const actions = suggestQualityActions([item]);
    const urlActions = actions.filter(
      a => a.action.includes('Add source URL'),
    );

    expect(urlActions).toHaveLength(1);
    expect(urlActions[0].priority).toBe('low');
  });

  // -------------------------------------------------------------------------
  // Citation actions
  // -------------------------------------------------------------------------

  it('suggests add citations for non-qa_pair item with zero citations', () => {
    const item = makeItem({
      id: 'no-citations',
      content_type: 'article',
      citation_count: 0,
      metadata: { citation_count: 0 },
    });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');

    expect(citationActions).toHaveLength(1);
    expect(citationActions[0].priority).toBe('low');
    expect(citationActions[0].estimatedScoreImpact).toBe(15);
  });

  it('does not suggest add citations for qa_pair items', () => {
    const item = makeItem({
      content_type: 'qa_pair',
      citation_count: 0,
      metadata: { citation_count: 0 },
    });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');
    expect(citationActions).toHaveLength(0);
  });

  it('does not suggest add citations when citation_count > 0', () => {
    const item = makeItem({ citation_count: 2, metadata: { citation_count: 2 } });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');
    expect(citationActions).toHaveLength(0);
  });

  it('handles missing metadata for citation count', () => {
    const item = makeItem({
      content_type: 'article',
      citation_count: null,
      metadata: null,
    });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');
    expect(citationActions).toHaveLength(1); // null metadata = 0 citations
  });

  // -------------------------------------------------------------------------
  // Incomplete depth layers
  // -------------------------------------------------------------------------

  it('suggests adding missing depth layers when only 1 of 3 populated', () => {
    const item = makeItem({
      id: 'partial-depth',
      brief: 'Brief content',
      detail: null,
      reference: null,
    });
    const actions = suggestQualityActions([item]);
    const depthActions = actions.filter(
      a => a.category === 'completeness' && a.action.includes('depth'),
    );

    expect(depthActions).toHaveLength(1);
    expect(depthActions[0].priority).toBe('medium');
    expect(depthActions[0].action).toContain('detail, reference');
    expect(depthActions[0].action).toContain('1 of 3');
  });

  it('suggests adding missing depth layer when 2 of 3 populated', () => {
    const item = makeItem({
      brief: 'Brief content',
      detail: 'Detail content',
      reference: null,
    });
    const actions = suggestQualityActions([item]);
    const depthActions = actions.filter(
      a => a.category === 'completeness' && a.action.includes('depth'),
    );

    expect(depthActions).toHaveLength(1);
    expect(depthActions[0].action).toContain('reference');
    expect(depthActions[0].action).toContain('2 of 3');
  });

  it('does not suggest depth layers when all 3 are populated', () => {
    const item = makeItem({
      brief: 'Brief',
      detail: 'Detail',
      reference: 'Reference',
    });
    const actions = suggestQualityActions([item]);
    const depthActions = actions.filter(
      a => a.category === 'completeness' && a.action.includes('depth'),
    );
    expect(depthActions).toHaveLength(0);
  });

  it('does not suggest depth layers when none are populated', () => {
    const item = makeItem({
      brief: null,
      detail: null,
      reference: null,
    });
    const actions = suggestQualityActions([item]);
    const depthActions = actions.filter(
      a => a.category === 'completeness' && a.action.includes('depth'),
    );
    // 0 of 3 is handled differently — the whole item is sparse,
    // not "partially populated"
    expect(depthActions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Multiple deficiencies on one item
  // -------------------------------------------------------------------------

  it('returns multiple actions for item with many deficiencies', () => {
    const item = makeItem({
      id: 'multi-issue',
      freshness: 'expired',
      classification_confidence: 0.2,
      ai_summary: null,
      brief: 'Brief only',
      detail: null,
      reference: null,
      content_owner_id: null,
      source_url: null,
      quality_score: 10,
      citation_count: 0,
      metadata: { citation_count: 0 },
    });
    const actions = suggestQualityActions([item]);

    // Should have: freshness, classification, summary, owner, source_url,
    // citations, depth layers
    expect(actions.length).toBeGreaterThanOrEqual(6);

    // Verify categories present
    const categories = new Set(actions.map(a => a.category));
    expect(categories.has('freshness')).toBe(true);
    expect(categories.has('classification')).toBe(true);
    expect(categories.has('summary')).toBe(true);
    expect(categories.has('completeness')).toBe(true);
    expect(categories.has('citations')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Sorting: priority then score impact
  // -------------------------------------------------------------------------

  it('sorts actions by priority (high before medium before low)', () => {
    const items = [
      makeItem({
        id: 'low-prio',
        citation_count: 0,
        metadata: { citation_count: 0 },
        content_type: 'article',
      }),
      makeItem({
        id: 'high-prio',
        freshness: 'expired',
        classification_confidence: 0.3,
      }),
    ];
    const actions = suggestQualityActions(items);

    // First actions should be high priority (freshness expired, classification)
    const highActions = actions.filter(a => a.priority === 'high');
    const lowActions = actions.filter(a => a.priority === 'low');

    // All high-priority actions come before low-priority
    if (highActions.length > 0 && lowActions.length > 0) {
      const lastHighIdx = actions.lastIndexOf(highActions[highActions.length - 1]);
      const firstLowIdx = actions.indexOf(lowActions[0]);
      expect(lastHighIdx).toBeLessThan(firstLowIdx);
    }
  });

  it('sorts actions with same priority by score impact descending', () => {
    // Two high-priority items: one expired (impact 30), one low confidence (impact ~16)
    const items = [
      makeItem({
        id: 'low-impact-high',
        classification_confidence: 0.2,
        freshness: 'fresh', // no freshness issue
        ai_summary: null, // missing summary (also high priority)
      }),
      makeItem({
        id: 'high-impact-high',
        freshness: 'expired',
      }),
    ];
    const actions = suggestQualityActions(items);
    const highActions = actions.filter(a => a.priority === 'high');

    // Among high priority, expired freshness (30) should come before
    // low confidence (16) and missing summary (15)
    expect(highActions.length).toBeGreaterThanOrEqual(2);
    if (highActions.length >= 2) {
      expect(highActions[0].estimatedScoreImpact).toBeGreaterThanOrEqual(
        highActions[1].estimatedScoreImpact,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Score impact estimation is reasonable
  // -------------------------------------------------------------------------

  it('estimates reasonable score impacts', () => {
    const item = makeItem({
      freshness: 'expired',
      classification_confidence: 0.1,
      ai_summary: null,
      citation_count: 0,
      metadata: { citation_count: 0 },
      content_type: 'article',
      brief: 'Brief only',
      detail: null,
      reference: null,
      content_owner_id: null,
      source_url: null,
    });
    const actions = suggestQualityActions([item]);

    for (const action of actions) {
      // Impact should be between 0 and 30 (max single component weight)
      expect(action.estimatedScoreImpact).toBeGreaterThanOrEqual(0);
      expect(action.estimatedScoreImpact).toBeLessThanOrEqual(30);
    }
  });

  // -------------------------------------------------------------------------
  // Multiple items
  // -------------------------------------------------------------------------

  it('handles multiple items and returns actions for all', () => {
    const items = [
      makeItem({ id: 'item-a', freshness: 'expired' }),
      makeItem({ id: 'item-b', ai_summary: null }),
      makeItem({ id: 'item-c', classification_confidence: 0.2 }),
    ];
    const actions = suggestQualityActions(items);

    const itemIds = new Set(actions.map(a => a.itemId));
    expect(itemIds.has('item-a')).toBe(true);
    expect(itemIds.has('item-b')).toBe(true);
    expect(itemIds.has('item-c')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Title resolution
  // -------------------------------------------------------------------------

  it('uses suggested_title over title when available', () => {
    const item = makeItem({
      title: 'Original',
      suggested_title: 'Suggested',
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].itemTitle).toBe('Suggested');
  });

  it('falls back to title when suggested_title is null', () => {
    const item = makeItem({
      title: 'Original',
      suggested_title: null,
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].itemTitle).toBe('Original');
  });

  it('uses "Untitled" when both title fields are null', () => {
    const item = makeItem({
      title: null,
      suggested_title: null,
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].itemTitle).toBe('Untitled');
  });

  // -------------------------------------------------------------------------
  // Domain is passed through
  // -------------------------------------------------------------------------

  it('includes domain in each action', () => {
    const item = makeItem({
      primary_domain: 'Compliance',
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].domain).toBe('Compliance');
  });

  it('handles null domain', () => {
    const item = makeItem({
      primary_domain: null,
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].domain).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Citation count extraction from metadata variants
  // -------------------------------------------------------------------------

  it('reads citation_count from direct column property', () => {
    const item = makeItem({
      content_type: 'article',
      citation_count: 3,
      metadata: { citation_count: 3 },
    });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');
    expect(citationActions).toHaveLength(0); // has citations, no action
  });

  it('reads citation_count from direct column even when metadata has string', () => {
    const item = makeItem({
      content_type: 'article',
      citation_count: 5,
      metadata: { citation_count: '5' },
    });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');
    expect(citationActions).toHaveLength(0); // has citations, no action
  });

  it('treats null citation_count as 0', () => {
    const item = makeItem({
      content_type: 'article',
      citation_count: null,
      metadata: { citation_count: 'invalid' },
    });
    const actions = suggestQualityActions([item]);
    const citationActions = actions.filter(a => a.category === 'citations');
    expect(citationActions).toHaveLength(1); // treated as 0
  });

  // -------------------------------------------------------------------------
  // Current score is passed through
  // -------------------------------------------------------------------------

  it('includes currentScore in each action', () => {
    const item = makeItem({
      quality_score: 25,
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].currentScore).toBe(25);
  });

  it('handles null quality_score', () => {
    const item = makeItem({
      quality_score: null,
      freshness: 'expired',
    });
    const actions = suggestQualityActions([item]);
    expect(actions[0].currentScore).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Score drop actions (Issue 1)
  // -------------------------------------------------------------------------

  it('generates critical score_drop action when item drops below threshold', () => {
    const item = makeItem({
      id: 'dropped-1',
      previous_quality_score: 50,
      quality_score: 30,
      freshness: 'fresh',
    });
    const actions = suggestQualityActions([item], { threshold: 40 });
    const dropActions = actions.filter(a => a.category === 'score_drop');

    expect(dropActions).toHaveLength(1);
    expect(dropActions[0].priority).toBe('critical');
    expect(dropActions[0].action).toContain('was 50');
    expect(dropActions[0].action).toContain('now 30');
    expect(dropActions[0].action).toContain('review urgently');
    expect(dropActions[0].estimatedScoreImpact).toBe(20); // 50 - 30
  });

  it('does not generate score_drop when previous score was already below threshold', () => {
    const item = makeItem({
      previous_quality_score: 35,
      quality_score: 30,
    });
    const actions = suggestQualityActions([item], { threshold: 40 });
    const dropActions = actions.filter(a => a.category === 'score_drop');
    expect(dropActions).toHaveLength(0);
  });

  it('does not generate score_drop when current score is above threshold', () => {
    const item = makeItem({
      previous_quality_score: 60,
      quality_score: 50,
    });
    const actions = suggestQualityActions([item], { threshold: 40 });
    const dropActions = actions.filter(a => a.category === 'score_drop');
    expect(dropActions).toHaveLength(0);
  });

  it('does not generate score_drop when previous score is null', () => {
    const item = makeItem({
      previous_quality_score: null,
      quality_score: 30,
    });
    const actions = suggestQualityActions([item], { threshold: 40 });
    const dropActions = actions.filter(a => a.category === 'score_drop');
    expect(dropActions).toHaveLength(0);
  });

  it('uses default threshold of 40 when not specified', () => {
    const item = makeItem({
      previous_quality_score: 45,
      quality_score: 35,
      freshness: 'fresh',
    });
    // No options passed — should use default threshold of 40
    const actions = suggestQualityActions([item]);
    const dropActions = actions.filter(a => a.category === 'score_drop');
    expect(dropActions).toHaveLength(1);
  });

  it('score_drop action appears first (critical priority)', () => {
    const item = makeItem({
      id: 'dropped-sort',
      previous_quality_score: 50,
      quality_score: 30,
      freshness: 'expired', // also generates a high-priority action
      ai_summary: null, // also generates a high-priority action
    });
    const actions = suggestQualityActions([item], { threshold: 40 });

    expect(actions.length).toBeGreaterThan(1);
    expect(actions[0].category).toBe('score_drop');
    expect(actions[0].priority).toBe('critical');
  });

  // -------------------------------------------------------------------------
  // Deduplication (Issue 3)
  // -------------------------------------------------------------------------

  it('returns all actions per item when deduplicateByItem is false', () => {
    const item = makeItem({
      id: 'multi-issue',
      freshness: 'expired',
      ai_summary: null,
      content_owner_id: null,
    });
    const actions = suggestQualityActions([item], { deduplicateByItem: false });
    const itemActions = actions.filter(a => a.itemId === 'multi-issue');
    expect(itemActions.length).toBeGreaterThan(1);
  });

  it('keeps only highest-priority action per item when deduplicateByItem is true', () => {
    const item = makeItem({
      id: 'multi-issue',
      freshness: 'expired', // high priority
      ai_summary: null, // high priority
      content_owner_id: null, // medium priority
      source_url: null, // low priority
    });
    const actions = suggestQualityActions([item], { deduplicateByItem: true });
    const itemActions = actions.filter(a => a.itemId === 'multi-issue');
    expect(itemActions).toHaveLength(1);
    expect(itemActions[0].priority).toBe('high');
  });

  it('deduplicates across multiple items correctly', () => {
    const items = [
      makeItem({
        id: 'item-a',
        freshness: 'expired',
        ai_summary: null,
      }),
      makeItem({
        id: 'item-b',
        classification_confidence: 0.2,
        source_url: null,
      }),
    ];
    const actions = suggestQualityActions(items, { deduplicateByItem: true });

    expect(actions).toHaveLength(2);
    expect(actions.find(a => a.itemId === 'item-a')).toBeDefined();
    expect(actions.find(a => a.itemId === 'item-b')).toBeDefined();
  });

  it('does not deduplicate by default', () => {
    const item = makeItem({
      id: 'multi-issue',
      freshness: 'expired',
      ai_summary: null,
    });
    // No deduplicateByItem option
    const actions = suggestQualityActions([item]);
    const itemActions = actions.filter(a => a.itemId === 'multi-issue');
    expect(itemActions.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// getTopQualityActions (Issue 4)
// ---------------------------------------------------------------------------

describe('getTopQualityActions', () => {
  let mockClient: MockSupabaseClient;

  /** Helper to configure governance_config response. */
  function configureGovConfig(
    rows: Array<{ domain: string | null; quality_score_threshold: number | null }>,
  ) {
    // First from() call is governance_config
    mockClient._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null }),
    );
  }

  /** Helper to configure content_items response. */
  function configureContentItems(
    items: Array<Record<string, unknown>>,
  ) {
    mockClient._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: items, error: null }),
    );
  }

  beforeEach(() => {
    mockClient = createMockSupabaseClient();
  });

  it('passes domain filter to the query', async () => {
    configureGovConfig([]);
    configureContentItems([]);

    await getTopQualityActions(mockClient as never, {
      domain: 'Compliance',
    });

    // eq should be called with primary_domain = 'Compliance'
    expect(mockClient._chain.eq).toHaveBeenCalledWith(
      'primary_domain',
      'Compliance',
    );
  });

  it('respects per-domain threshold from governance_config', async () => {
    configureGovConfig([
      { domain: 'Compliance', quality_score_threshold: 60 },
    ]);
    configureContentItems([
      {
        id: 'item-1',
        title: 'Test',
        suggested_title: null,
        content_type: 'article',
        primary_domain: 'Compliance',
        primary_subtopic: null,
        freshness: 'expired',
        classification_confidence: 0.9,
        ai_summary: 'Summary text that is long enough.',
        brief: 'Brief',
        detail: 'Detail',
        reference: 'Reference',
        content_owner_id: 'user-1',
        source_url: 'https://example.com',
        quality_score: 55, // below 60 threshold for Compliance
        previous_quality_score: null,
        citation_count: 3,
        metadata: { citation_count: 3 },
      },
    ]);

    await getTopQualityActions(mockClient as never);

    // lte should be called with maxThreshold >= 60
    expect(mockClient._chain.lte).toHaveBeenCalledWith(
      'quality_score',
      60,
    );
  });

  it('respects scoreThreshold override', async () => {
    configureGovConfig([]);
    configureContentItems([]);

    await getTopQualityActions(mockClient as never, {
      scoreThreshold: 70,
    });

    // lte should be called with the override threshold
    expect(mockClient._chain.lte).toHaveBeenCalledWith(
      'quality_score',
      70,
    );
  });

  it('limits results to the specified limit', async () => {
    configureGovConfig([]);
    // Return many items that will generate actions
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
      suggested_title: null,
      content_type: 'article',
      primary_domain: 'Corporate Information',
      primary_subtopic: null,
      freshness: 'expired',
      classification_confidence: 0.3,
      ai_summary: null,
      brief: null,
      detail: null,
      reference: null,
      content_owner_id: null,
      source_url: null,
      quality_score: 10,
      previous_quality_score: null,
      metadata: null,
    }));
    configureContentItems(items);

    const result = await getTopQualityActions(mockClient as never, {
      limit: 5,
    });

    expect(result.actions.length).toBeLessThanOrEqual(5);
    expect(result.total_actions).toBeLessThanOrEqual(5);
  });

  it('returns correct priority breakdown', async () => {
    configureGovConfig([]);
    configureContentItems([
      {
        id: 'item-1',
        title: 'Expired Item',
        suggested_title: null,
        content_type: 'article',
        primary_domain: 'Corporate Information',
        primary_subtopic: null,
        freshness: 'expired',
        classification_confidence: 0.9,
        ai_summary: 'A comprehensive summary of the content that is long enough.',
        brief: 'Brief',
        detail: 'Detail',
        reference: 'Reference',
        content_owner_id: 'user-1',
        source_url: 'https://example.com',
        quality_score: 30,
        previous_quality_score: null,
        citation_count: 3,
        metadata: { citation_count: 3 },
      },
    ]);

    const result = await getTopQualityActions(mockClient as never);

    expect(result.by_priority).toBeDefined();
    expect(result.total_actions).toBe(result.actions.length);
  });

  it('throws on Supabase query error', async () => {
    configureGovConfig([]);
    // Configure the content_items query to return an error
    mockClient._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: { message: 'Connection refused' } }),
    );

    await expect(
      getTopQualityActions(mockClient as never),
    ).rejects.toThrow('Failed to fetch quality items: Connection refused');
  });
});
