// __tests__/lib/intelligence/pipeline.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect, vi } from 'vitest';
import {
  processFeedSource,
  getDueFeedSources,
} from '@/lib/intelligence/pipeline';

// Mock all dependencies
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
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
});
