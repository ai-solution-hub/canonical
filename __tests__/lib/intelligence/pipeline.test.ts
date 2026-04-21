// __tests__/lib/intelligence/pipeline.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  processFeedSource,
  getDueFeedSources,
  runPipeline,
} from '@/lib/intelligence/pipeline';

// Mock all dependencies
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
  pollWebSource: vi.fn(),
}));
vi.mock('@/lib/intelligence/content-extractor', () => ({
  extractContent: vi.fn(),
  normaliseUrl: vi.fn((url: string) => url),
  resolveGoogleNewsUrl: vi.fn((url: string) => Promise.resolve(url)),
  checkFirecrawlApiKey: vi.fn(),
}));
vi.mock('@/lib/intelligence/relevance-scorer', () => ({
  embeddingPreFilter: vi.fn(),
  scoreRelevance: vi.fn(),
}));
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));
vi.mock('@/lib/intelligence/article-summariser', () => ({
  generateArticleSummary: vi.fn().mockResolvedValue('A concise article summary.'),
}));

describe('getDueFeedSources', () => {
  it('queries active sources using RPC for interval-aware filtering', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const mockSupabase = { rpc: mockRpc } as any;
    const result = await getDueFeedSources(mockSupabase, 5);
    expect(mockRpc).toHaveBeenCalledWith('get_due_feed_sources', {
      max_sources: 5,
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('processFeedSource', () => {
  it('returns result with correct shape', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
        insert: vi
          .fn()
          .mockResolvedValue({ data: [{ id: 'item-1' }], error: null }),
      }),
    } as any;

    const source = {
      id: 'source-1',
      workspace_id: 'ws-1',
      name: 'DfE Feed',
      url: 'https://example.com/feed.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
    };

    const result = await processFeedSource(mockSupabase, source, null, null);
    expect(result.feedSourceId).toBe('source-1');
    expect(result.articlesFound).toBe(0);
  });

  it('skips content item creation when no company profile exists', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { extractContent } =
      await import('@/lib/intelligence/content-extractor');

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [
        {
          title: 'Test Article',
          url: 'https://example.com/article',
          guid: 'guid-1',
          publishedAt: '2026-04-01T10:00:00Z',
          summary: 'Summary',
          contentEncoded: null,
          categories: [],
        },
      ],
      etag: null,
      lastModified: null,
    });

    vi.mocked(extractContent).mockResolvedValue({
      content: 'Long content '.repeat(50),
      title: 'Test Article',
      description: 'Summary',
      thumbnailUrl: null,
      method: 'fetch',
      wordCount: 100,
    });

    const insertCalls: any[] = [];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockImplementation((data: any) => {
          insertCalls.push({ table, data });
          return {
            select: vi
              .fn()
              .mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 'fa-1' }, error: null }),
              }),
            error: null,
          };
        }),
      })),
    } as any;

    const source = {
      id: 'source-1',
      workspace_id: 'ws-1',
      name: 'DfE Feed',
      url: 'https://example.com/feed.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
    };

    // companyContext is null — should NOT create content_items
    await processFeedSource(mockSupabase, source, null, null);

    // Verify feed_articles was inserted with passed: false
    const feedArticleInsert = insertCalls.find(
      (c) => c.table === 'feed_articles',
    );
    expect(feedArticleInsert).toBeDefined();
    expect(feedArticleInsert.data.passed).toBe(false);

    // Verify content_items was NOT inserted
    const contentItemInsert = insertCalls.find(
      (c) => c.table === 'content_items',
    );
    expect(contentItemInsert).toBeUndefined();
  });

  it('stores extraction_method on article insert (P1)', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { extractContent } =
      await import('@/lib/intelligence/content-extractor');

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [
        {
          title: 'Test Article',
          url: 'https://example.com/article',
          guid: 'guid-1',
          publishedAt: '2026-04-01T10:00:00Z',
          summary: 'Summary',
          contentEncoded: null,
          categories: [],
        },
      ],
      etag: null,
      lastModified: null,
    });

    vi.mocked(extractContent).mockResolvedValue({
      content: 'Long content '.repeat(50),
      title: 'Test Article',
      description: 'Summary',
      thumbnailUrl: null,
      method: 'jina_reader',
      wordCount: 100,
    });

    const insertCalls: any[] = [];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockImplementation((data: any) => {
          insertCalls.push({ table, data });
          return {
            select: vi
              .fn()
              .mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 'fa-1' }, error: null }),
              }),
            error: null,
          };
        }),
      })),
    } as any;

    const source = {
      id: 'source-1',
      workspace_id: 'ws-1',
      name: 'DfE Feed',
      url: 'https://example.com/feed.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
    };

    await processFeedSource(mockSupabase, source, null, null);

    const feedArticleInsert = insertCalls.find(
      (c) => c.table === 'feed_articles',
    );
    expect(feedArticleInsert).toBeDefined();
    expect(feedArticleInsert.data.extraction_method).toBe('jina_reader');
  });

  it('filters articles with very short content via minimum content gate (P1)', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { extractContent } =
      await import('@/lib/intelligence/content-extractor');

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [
        {
          title: 'Title-only Article',
          url: 'https://example.com/short',
          guid: 'guid-short',
          publishedAt: '2026-04-01T10:00:00Z',
          summary: 'Brief.',
          contentEncoded: null,
          categories: [],
        },
      ],
      etag: null,
      lastModified: null,
    });

    // Return very short content (below 50 word threshold)
    vi.mocked(extractContent).mockResolvedValue({
      content: 'Title only content here',
      title: 'Title-only Article',
      description: 'Brief.',
      thumbnailUrl: null,
      method: 'summary_fallback',
      wordCount: 4,
    });

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const insertCalls: any[] = [];
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockImplementation((data: any) => {
          insertCalls.push({ table, data });
          return {
            select: vi
              .fn()
              .mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 'fa-1' }, error: null }),
              }),
            error: null,
          };
        }),
      })),
    } as any;

    const source = {
      id: 'source-1',
      workspace_id: 'ws-1',
      name: 'DfE Feed',
      url: 'https://example.com/feed.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
    };

    await processFeedSource(mockSupabase, source, null, null);

    // Should still insert the article but marked as filtered
    const feedArticleInsert = insertCalls.find(
      (c) => c.table === 'feed_articles',
    );
    expect(feedArticleInsert).toBeDefined();
    expect(feedArticleInsert.data.passed).toBe(false);
    expect(feedArticleInsert.data.relevance_reasoning).toBe(
      'Content too short for reliable scoring',
    );
    expect(feedArticleInsert.data.extraction_method).toBe('summary_fallback');

    // Should log a warning
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('content too short'),
    );

    // Should not have created content_items
    const contentItemInsert = insertCalls.find(
      (c) => c.table === 'content_items',
    );
    expect(contentItemInsert).toBeUndefined();

    consoleSpy.mockRestore();
  });

  // ── source_type branching (P0-WEB / WP3B) ──

  it('calls pollWebSource (not pollFeed) when source_type is "web" (T12)', async () => {
    vi.clearAllMocks();
    const { pollFeed, pollWebSource } = await import(
      '@/lib/intelligence/feed-poller'
    );
    vi.mocked(pollWebSource).mockResolvedValue({
      feedSourceId: 'web-source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'fa-1' }, error: null }),
          }),
          error: null,
        }),
      }),
    } as any;

    const webSource = {
      id: 'web-source-1',
      workspace_id: 'ws-1',
      name: 'Company Website',
      url: 'https://example.com/page',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 360,
      consecutive_failures: 0,
      article_count: 0,
      source_type: 'web' as const,
    };

    await processFeedSource(mockSupabase, webSource, null, null);

    expect(vi.mocked(pollWebSource)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'web-source-1', url: 'https://example.com/page' }),
    );
    expect(vi.mocked(pollFeed)).not.toHaveBeenCalled();
  });

  it('calls pollFeed (not pollWebSource) when source_type is "rss" (T13)', async () => {
    vi.clearAllMocks();
    const { pollFeed, pollWebSource } = await import(
      '@/lib/intelligence/feed-poller'
    );
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'rss-source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'fa-1' }, error: null }),
          }),
          error: null,
        }),
      }),
    } as any;

    const rssSource = {
      id: 'rss-source-1',
      workspace_id: 'ws-1',
      name: 'DfE Feed',
      url: 'https://example.com/feed.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
      source_type: 'rss' as const,
    };

    await processFeedSource(mockSupabase, rssSource, null, null);

    expect(vi.mocked(pollFeed)).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rss-source-1', url: 'https://example.com/feed.atom' }),
    );
    expect(vi.mocked(pollWebSource)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runPipeline — regression coverage for §2.1.8 SI-M2 hoist (s156 WP2)
// ---------------------------------------------------------------------------
//
// These tests are the safety net for the company-context/prompt/embedding
// hoist refactor. They lock in:
//   1. Once-per-workspace load — multiple sources in the same workspace must
//      load workspace context, active prompt, and company embedding exactly
//      once.
//   2. Multi-workspace fan-out — N workspaces => N loads each, regardless of
//      total source count.
//   3. Workspace error isolation — if the embedding load throws for one
//      workspace, that workspace's sources still process (with embedding
//      null) and other workspaces are unaffected.
//   4. Map iteration order — sources within a workspace are processed in
//      grouped order (Map preserves insertion order).
//
// Per the spec (`docs/specs/si-hardening-company-embedding-hoist.md`), no
// existing test exercised `runPipeline` end-to-end, so these tests are the
// only regression net for the refactor.

interface MockBuildOptions {
  /** Sources returned by the get_due_feed_sources RPC (in this exact order). */
  dueSources: Array<{
    id: string;
    workspace_id: string;
    name: string;
    url: string;
    etag: string | null;
    last_modified: string | null;
    polling_interval_minutes: number;
    consecutive_failures: number;
    article_count: number;
  }>;
  /** Map of workspace_id → company profile id (or null for "no profile"). */
  workspaceProfiles?: Record<string, string | null>;
  /** Map of profile_id → cached company embedding string (or null). */
  cachedEmbeddings?: Record<string, string | null>;
}

interface MockTracking {
  fromCalls: Array<{ table: string; op: string; payload?: unknown }>;
  workspaceContextLoads: number;
  companyProfileLoads: number;
  companyEmbeddingLoads: number;
  feedPromptLoads: number;
  processedSourceOrder: string[];
}

/**
 * Build a mock Supabase client suitable for `runPipeline()` tests.
 *
 * The mock tracks each `.from(table)` invocation and threads the chained
 * builder methods so the production code paths execute without touching the
 * network. The `tracking` object exposes counts so each test can assert
 * "loaded once per workspace" precisely.
 */
function buildRunPipelineMock(options: MockBuildOptions): {
  supabase: any;
  tracking: MockTracking;
} {
  const tracking: MockTracking = {
    fromCalls: [],
    workspaceContextLoads: 0,
    companyProfileLoads: 0,
    companyEmbeddingLoads: 0,
    feedPromptLoads: 0,
    processedSourceOrder: [],
  };

  const workspaceProfiles = options.workspaceProfiles ?? {};
  const cachedEmbeddings = options.cachedEmbeddings ?? {};

  // Tracks the most recently selected column list per from() chain so the
  // company_profiles select can distinguish "context load" from "embedding
  // load" (both query the same table with different columns).
  const supabase: any = {
    rpc: vi.fn((name: string) => {
      if (name === 'get_due_feed_sources') {
        return Promise.resolve({ data: options.dueSources, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    }),
    from: vi.fn((table: string) => {
      tracking.fromCalls.push({ table, op: 'from' });

      // Builder state captured per chain
      let selectedColumns: string | null = null;
      const eqFilters: Record<string, unknown> = {};

      // Resolves to an array result for thenable chains (e.g. select+eq+await
      // without .maybeSingle/.single/.limit). Used by the in-progress queue
      // check at the top of runPipeline.
      const resolveListResult = (): Promise<{ data: unknown[]; error: null }> =>
        Promise.resolve({ data: [], error: null });

      const builder: any = {
        select: vi.fn((cols: string) => {
          selectedColumns = cols;
          return builder;
        }),
        eq: vi.fn((col: string, val: unknown) => {
          eqFilters[col] = val;
          return builder;
        }),
        // Make the chain thenable so `await supabase.from(t).select(...).eq(...)`
        // resolves directly. The in-progress queue check relies on this.
        then: (
          onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
        ) => resolveListResult().then(onFulfilled),
        limit: vi.fn(() => {
          // For .from('feed_prompts').select('id, prompt_text').eq(...).eq(...).limit(1)
          if (table === 'feed_prompts') {
            tracking.feedPromptLoads++;
            // Return empty list (no active prompt) — keeps the test simple
            return Promise.resolve({ data: [], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        }),
        maybeSingle: vi.fn(() => {
          if (table === 'workspaces') {
            tracking.workspaceContextLoads++;
            const workspaceId = eqFilters.id as string;
            const profileId = workspaceProfiles[workspaceId] ?? null;
            return Promise.resolve({
              data: {
                domain_metadata: profileId
                  ? { company_profile_id: profileId }
                  : {},
              },
              error: null,
            });
          }
          if (table === 'company_profiles') {
            // Distinguish context load from embedding load by columns selected
            if (selectedColumns && selectedColumns.includes('company_embedding')) {
              tracking.companyEmbeddingLoads++;
              const profileId = eqFilters.id as string;
              return Promise.resolve({
                data: { company_embedding: cachedEmbeddings[profileId] ?? null },
                error: null,
              });
            }
            tracking.companyProfileLoads++;
            return Promise.resolve({
              data: {
                name: 'Test Co',
                sectors: ['tech'],
                services: ['consulting'],
                key_topics: ['ai'],
                target_customers: 'SMBs',
                value_proposition: 'Quality services',
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        single: vi.fn(() => {
          if (table === 'si_processing_queue') {
            return Promise.resolve({
              data: { id: `queue-${tracking.fromCalls.length}` },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        }),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: { id: `queue-${tracking.fromCalls.length}` },
                error: null,
              }),
            ),
          })),
        })),
      };
      return builder;
    }),
  };

  return { supabase, tracking };
}

describe('runPipeline (§2.1.8 hoist regression)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads workspace context, prompt and embedding ONCE per workspace when multiple sources share a workspace', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    // Return zero items so per-source processing is a no-op (we are testing
    // the outer-loop hoist, not item processing).
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'unused',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    const { supabase, tracking } = buildRunPipelineMock({
      dueSources: [
        {
          id: 'source-1',
          workspace_id: 'ws-A',
          name: 'Feed 1',
          url: 'https://example.com/feed1.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-2',
          workspace_id: 'ws-A',
          name: 'Feed 2',
          url: 'https://example.com/feed2.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
      ],
      workspaceProfiles: { 'ws-A': 'profile-A' },
      // Cached embedding present so loadOrGenerateCompanyEmbedding does not
      // call the OpenAI mock — the read counter is what matters.
      cachedEmbeddings: { 'profile-A': JSON.stringify([0.1, 0.2, 0.3]) },
    });

    const result = await runPipeline(supabase);

    // Two sources processed
    expect(result.sourcesProcessed).toBe(2);

    // The hoist invariant: each per-workspace load happens exactly ONCE,
    // not once per source. Before the refactor these would each be 2.
    expect(tracking.workspaceContextLoads).toBe(1);
    expect(tracking.companyProfileLoads).toBe(1);
    expect(tracking.companyEmbeddingLoads).toBe(1);
    expect(tracking.feedPromptLoads).toBe(1);
  });

  it('loads context exactly once per workspace across multiple workspaces (fan-out)', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'unused',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    // 4 sources total: workspace A has 3, workspace B has 1.
    const { supabase, tracking } = buildRunPipelineMock({
      dueSources: [
        {
          id: 'source-A1',
          workspace_id: 'ws-A',
          name: 'A Feed 1',
          url: 'https://example.com/a1.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-A2',
          workspace_id: 'ws-A',
          name: 'A Feed 2',
          url: 'https://example.com/a2.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-A3',
          workspace_id: 'ws-A',
          name: 'A Feed 3',
          url: 'https://example.com/a3.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-B1',
          workspace_id: 'ws-B',
          name: 'B Feed 1',
          url: 'https://example.com/b1.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
      ],
      workspaceProfiles: {
        'ws-A': 'profile-A',
        'ws-B': 'profile-B',
      },
      cachedEmbeddings: {
        'profile-A': JSON.stringify([0.1, 0.2, 0.3]),
        'profile-B': JSON.stringify([0.4, 0.5, 0.6]),
      },
    });

    const result = await runPipeline(supabase);

    expect(result.sourcesProcessed).toBe(4);

    // Two workspaces => exactly two of each per-workspace load. Before the
    // refactor these would each be 4 (one per source).
    expect(tracking.workspaceContextLoads).toBe(2);
    expect(tracking.companyProfileLoads).toBe(2);
    expect(tracking.companyEmbeddingLoads).toBe(2);
    expect(tracking.feedPromptLoads).toBe(2);

    // Both workspaces' sources are still processed (workspace B is not
    // accidentally dropped).
    expect(result.feedResults.map((r) => r.feedSourceId).sort()).toEqual([
      'source-A1',
      'source-A2',
      'source-A3',
      'source-B1',
    ]);
  });

  it('isolates workspace failures: a failing embedding load for one workspace does not break other workspaces', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { generateEmbedding } = await import('@/lib/ai/embed');
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'unused',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });
    // Force the embedding generator to throw — workspace A has no cached
    // embedding so loadOrGenerateCompanyEmbedding will call the generator.
    vi.mocked(generateEmbedding).mockRejectedValueOnce(
      new Error('OpenAI rate limit'),
    );

    const { supabase, tracking } = buildRunPipelineMock({
      dueSources: [
        {
          id: 'source-A1',
          workspace_id: 'ws-A',
          name: 'A Feed',
          url: 'https://example.com/a.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-B1',
          workspace_id: 'ws-B',
          name: 'B Feed',
          url: 'https://example.com/b.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
      ],
      workspaceProfiles: {
        'ws-A': 'profile-A',
        'ws-B': 'profile-B',
      },
      cachedEmbeddings: {
        // Workspace A: NO cached embedding → triggers generation → throws
        'profile-A': null,
        // Workspace B: cached embedding present → skips generation
        'profile-B': JSON.stringify([0.4, 0.5, 0.6]),
      },
    });

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runPipeline(supabase);

    // Both workspaces processed despite workspace A's embedding failure.
    expect(result.sourcesProcessed).toBe(2);
    expect(result.feedResults.map((r) => r.feedSourceId).sort()).toEqual([
      'source-A1',
      'source-B1',
    ]);

    // Each workspace still loaded its context exactly once.
    expect(tracking.workspaceContextLoads).toBe(2);
    expect(tracking.companyProfileLoads).toBe(2);
    expect(tracking.feedPromptLoads).toBe(2);

    // The best-effort warning was logged for workspace A.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('intelligence.pipeline.embedding.load'),
      expect.objectContaining({
        workspaceId: 'ws-A',
        error: expect.stringContaining('OpenAI rate limit'),
      }),
    );

    consoleSpy.mockRestore();
  });

  it('processes sources in workspace-grouped order (Map insertion order)', async () => {
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'unused',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    // Interleave workspaces in the source list to prove the grouping
    // happens before iteration. Insertion order: A, B, A, B.
    const { supabase } = buildRunPipelineMock({
      dueSources: [
        {
          id: 'source-A1',
          workspace_id: 'ws-A',
          name: 'A Feed 1',
          url: 'https://example.com/a1.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-B1',
          workspace_id: 'ws-B',
          name: 'B Feed 1',
          url: 'https://example.com/b1.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-A2',
          workspace_id: 'ws-A',
          name: 'A Feed 2',
          url: 'https://example.com/a2.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
        {
          id: 'source-B2',
          workspace_id: 'ws-B',
          name: 'B Feed 2',
          url: 'https://example.com/b2.xml',
          etag: null,
          last_modified: null,
          polling_interval_minutes: 30,
          consecutive_failures: 0,
          article_count: 0,
        },
      ],
      workspaceProfiles: { 'ws-A': null, 'ws-B': null },
    });

    const result = await runPipeline(supabase);

    // Map insertion order is A then B (A appears first in the source list),
    // so both A sources should appear before both B sources, even though
    // they were interleaved in the input. This locks in the grouped-order
    // behaviour change called out in the spec's Gotchas section.
    expect(result.feedResults.map((r) => r.feedSourceId)).toEqual([
      'source-A1',
      'source-A2',
      'source-B1',
      'source-B2',
    ]);
  });
});
