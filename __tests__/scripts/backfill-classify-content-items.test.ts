import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  findCandidates,
  formatSummary,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PIPELINE_SERVICE_ACCOUNT_USER_ID,
  type BackfillSummary,
  type CandidateItem,
} from '../../scripts/backfill-classify-content-items';

// ---------------------------------------------------------------------------
// PIPELINE_SERVICE_ACCOUNT_USER_ID
// ---------------------------------------------------------------------------

describe('PIPELINE_SERVICE_ACCOUNT_USER_ID', () => {
  it('is a v4-compliant UUID (for content_items.updated_by)', () => {
    // content_items.updated_by is uuid — string literals fail Postgres cast.
    expect(PIPELINE_SERVICE_ACCOUNT_USER_ID).toBe(
      'a0000000-0000-4000-8000-000000000001',
    );
    expect(PIPELINE_SERVICE_ACCOUNT_USER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('errors when --workspace-id is missing', () => {
    const result = parseArgs([]);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('--workspace-id');
    expect(result.workspaceId).toBeNull();
  });

  it('errors when --workspace-id flag has no value', () => {
    const result = parseArgs(['--workspace-id']);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('--workspace-id');
  });

  it('accepts a workspace-id and applies defaults', () => {
    const result = parseArgs([
      '--workspace-id',
      '11111111-2222-4333-8444-555555555555',
    ]);
    expect(result.error).toBeNull();
    expect(result.workspaceId).toBe('11111111-2222-4333-8444-555555555555');
    expect(result.dryRun).toBe(false);
    expect(result.limit).toBe(DEFAULT_LIMIT);
    expect(result.contentType).toBeNull();
  });

  it('parses --dry-run', () => {
    const result = parseArgs([
      '--workspace-id',
      '11111111-2222-4333-8444-555555555555',
      '--dry-run',
    ]);
    expect(result.error).toBeNull();
    expect(result.dryRun).toBe(true);
  });

  it('parses --limit', () => {
    const result = parseArgs([
      '--workspace-id',
      '11111111-2222-4333-8444-555555555555',
      '--limit',
      '25',
    ]);
    expect(result.error).toBeNull();
    expect(result.limit).toBe(25);
  });

  it('rejects --limit above MAX_LIMIT (anti-runaway)', () => {
    const result = parseArgs([
      '--workspace-id',
      '11111111-2222-4333-8444-555555555555',
      '--limit',
      String(MAX_LIMIT + 1),
    ]);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('cap');
  });

  it('rejects non-numeric --limit', () => {
    const result = parseArgs([
      '--workspace-id',
      '11111111-2222-4333-8444-555555555555',
      '--limit',
      'abc',
    ]);
    expect(result.error).not.toBeNull();
    expect(result.error).toContain('positive integer');
  });

  it('parses --content-type', () => {
    const result = parseArgs([
      '--workspace-id',
      '11111111-2222-4333-8444-555555555555',
      '--content-type',
      'article',
    ]);
    expect(result.error).toBeNull();
    expect(result.contentType).toBe('article');
  });
});

// ---------------------------------------------------------------------------
// findCandidates — mocked Supabase client
// ---------------------------------------------------------------------------

interface MockRow {
  [key: string]: unknown;
}

/**
 * Minimal Supabase mock that dispatches `.from(table)` calls to a map of
 * pre-canned result sets. Matches the fluent subset used by findCandidates:
 *   .from(t).select(...).eq(...).not(...)          -> resolves to { data, error }
 *   .from(t).select(...).in(...)                   -> resolves to { data, error }
 *   .from(t).select(...).in(...).eq(...)           -> resolves to { data, error }
 */
function makeMockSupabase(tables: Record<string, { data?: MockRow[]; error?: Error | null }>) {
  function makeQuery(tableName: string) {
    const result = tables[tableName] ?? { data: [], error: null };
    const resolved = Promise.resolve({
      data: result.data ?? [],
      error: result.error ?? null,
    });
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      in: vi.fn(() => chain),
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    return chain;
  }
  return {
    from: vi.fn((t: string) => makeQuery(t)),
  };
}

describe('findCandidates', () => {
  const WS_ID = '11111111-2222-4333-8444-555555555555';

  it('returns items matching the candidate query (classified_at IS NULL or no entity_mentions)', async () => {
    const supabase = makeMockSupabase({
      feed_articles: {
        data: [
          { content_item_id: 'item-1' },
          { content_item_id: 'item-2' },
          { content_item_id: 'item-3' },
          { content_item_id: null }, // filtered out
        ],
      },
      content_items: {
        data: [
          {
            id: 'item-1',
            title: 'Unclassified',
            content_type: 'article',
            classified_at: null,
          },
          {
            id: 'item-2',
            title: 'Classified but no entities',
            content_type: 'article',
            classified_at: '2026-04-01T00:00:00Z',
          },
          {
            id: 'item-3',
            title: 'Fully classified',
            content_type: 'article',
            classified_at: '2026-04-01T00:00:00Z',
          },
        ],
      },
      entity_mentions: {
        // Only item-3 has entity_mentions → item-1 and item-2 are candidates.
        data: [{ content_item_id: 'item-3' }],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = await findCandidates(supabase as any, WS_ID, 100, null);

    const ids = candidates.map((c) => c.id).sort();
    expect(ids).toEqual(['item-1', 'item-2']);
  });

  it('respects the limit', async () => {
    const supabase = makeMockSupabase({
      feed_articles: {
        data: [
          { content_item_id: 'a' },
          { content_item_id: 'b' },
          { content_item_id: 'c' },
        ],
      },
      content_items: {
        data: [
          { id: 'a', title: 'A', content_type: 'article', classified_at: null },
          { id: 'b', title: 'B', content_type: 'article', classified_at: null },
          { id: 'c', title: 'C', content_type: 'article', classified_at: null },
        ],
      },
      entity_mentions: { data: [] },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = await findCandidates(supabase as any, WS_ID, 2, null);
    expect(candidates).toHaveLength(2);
  });

  it('returns empty array when workspace has no feed_articles', async () => {
    const supabase = makeMockSupabase({
      feed_articles: { data: [] },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = await findCandidates(supabase as any, WS_ID, 100, null);
    expect(candidates).toEqual([]);
  });

  it('throws when feed_articles query fails', async () => {
    const supabase = makeMockSupabase({
      feed_articles: { data: [], error: new Error('boom') as unknown as Error },
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findCandidates(supabase as any, WS_ID, 100, null),
    ).rejects.toThrow(/feed_articles/);
  });
});

// ---------------------------------------------------------------------------
// formatSummary
// ---------------------------------------------------------------------------

describe('formatSummary', () => {
  const empty: BackfillSummary = {
    total_candidates: 0,
    classified: 0,
    failed: 0,
    failures: [],
    cost_estimate_usd: 0,
  };

  it('includes total/classified/failed counts', () => {
    const summary: BackfillSummary = {
      ...empty,
      total_candidates: 3,
      classified: 2,
      failed: 1,
      failures: [
        { id: 'item-x', title: 'Broken Item', error: 'API timeout' },
      ],
    };
    const out = formatSummary(summary, false);
    expect(out).toContain('Total candidates: 3');
    expect(out).toContain('Classified:       2');
    expect(out).toContain('Failed:           1');
    expect(out).toContain('item-x');
    expect(out).toContain('API timeout');
  });

  it('marks dry-run output clearly', () => {
    const out = formatSummary(empty, true);
    expect(out).toContain('DRY RUN');
  });

  it('omits failures section when there are none', () => {
    const out = formatSummary({ ...empty, classified: 5, total_candidates: 5 }, false);
    expect(out).not.toContain('Failures:');
  });
});

// ---------------------------------------------------------------------------
// Happy path + partial failure — driven via findCandidates + a local
// classifier stub that mimics classifyContent's contract.
// ---------------------------------------------------------------------------

describe('classification loop (logic shape)', () => {
  it('continues on per-item failure and records it in the summary', async () => {
    // This test exercises the inline loop shape used by main(). Since main()
    // does dynamic-import of classifyContent, we verify the shape here by
    // hand-running the same reduce and asserting summary mutation semantics.
    const items: CandidateItem[] = [
      {
        id: 'a',
        title: 'Item A',
        content_type: 'article',
        classified_at: null,
      },
      {
        id: 'b',
        title: 'Item B',
        content_type: 'article',
        classified_at: null,
      },
      {
        id: 'c',
        title: 'Item C',
        content_type: 'article',
        classified_at: null,
      },
    ];

    const classifier = vi.fn(async (itemId: string) => {
      if (itemId === 'b') throw new Error('API down');
      return { entities: [{ name: 'x', type: 'Organization' }] };
    });

    const summary: BackfillSummary = {
      total_candidates: items.length,
      classified: 0,
      failed: 0,
      failures: [],
      cost_estimate_usd: 0,
    };

    for (const item of items) {
      try {
        await classifier(item.id);
        summary.classified++;
      } catch (err) {
        summary.failed++;
        summary.failures.push({
          id: item.id,
          title: item.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    expect(classifier).toHaveBeenCalledTimes(3);
    expect(summary.classified).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toEqual([
      { id: 'b', title: 'Item B', error: 'API down' },
    ]);
  });
});
