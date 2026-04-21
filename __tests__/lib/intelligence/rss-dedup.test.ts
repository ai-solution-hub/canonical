// __tests__/lib/intelligence/rss-dedup.test.ts
//
// EP11 RSS feed promotion dedup coverage (WP1 / spec §6 D1, D3):
// - Same source_url already in KB → insert junction only, no new item
// - New URL + exact-hash content match → insert with dedup_status=suspected_duplicate
// - Clean (no match) → insert as clean
//
// RSS runs as an automated pipeline, so there is no skip_dedup override
// path — only the D3 many-to-many and D1 soft-block branches apply.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFeedSource } from '@/lib/intelligence/pipeline';

// ─────────────────────────────────────────────────────────────────────
// Shared pipeline dependency mocks
// ─────────────────────────────────────────────────────────────────────

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
  generateArticleSummary: vi
    .fn()
    .mockResolvedValue('A concise article summary.'),
}));

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const ARTICLE_URL = 'https://example.com/articles/rss-1';
const EXISTING_URL_MATCH_ID = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const EXISTING_HASH_MATCH_ID = 'b2c3d4e5-f6a7-4890-8bcd-ef1234567890';
const NEW_ITEM_ID = 'c3d4e5f6-a7b8-4901-9cde-f23456789012';
const LONG_CONTENT =
  'This article discusses the UK government procurement framework and the new guidance issued in 2026 affecting SMB suppliers across multiple sectors and supply chains.';

interface FromCall {
  table: string;
  op: string;
  filter?: Record<string, unknown>;
  payload?: unknown;
}

function buildMockSupabase(options: {
  existingByUrl: { id: string } | null;
  existingByHash: Array<{ id: string; title: string }>;
  existingJunctionLink: boolean;
}) {
  const fromCalls: FromCall[] = [];
  let rpcHashCallIndex = 0;

  // Build a chain factory scoped to a specific table query. The chain
  // is both usable as a query builder AND awaitable — `sb()` terminates
  // builders via `.then()` after `.limit()`, while other paths chain
  // onto `.maybeSingle()` / `.single()`.
  const makeFromChain = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain: any = {};

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    });
    chain.is = vi.fn((col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    });
    chain.limit = vi.fn(() => chain);

    // Thenable — resolves with an array-shaped result (matches the
    // `.limit(1)` terminal path used by `sb(...)`).
    chain.then = (resolve: any) => {
      fromCalls.push({ table, op: 'limitAwait', filter: { ...filters } });
      resolve({ data: [], error: null });
    };

    chain.maybeSingle = vi.fn(() => {
      fromCalls.push({ table, op: 'maybeSingle', filter: { ...filters } });
      if (table === 'content_items' && 'source_url' in filters) {
        return Promise.resolve({
          data: options.existingByUrl,
          error: null,
        });
      }
      if (table === 'content_item_workspaces') {
        return Promise.resolve({
          data: options.existingJunctionLink ? { content_item_id: 'x' } : null,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    chain.single = vi.fn(() => {
      fromCalls.push({ table, op: 'single', filter: { ...filters } });
      if (table === 'content_items') {
        return Promise.resolve({
          data: {
            content_type: 'article',
            primary_domain: 'general-business',
            primary_subtopic: 'operations',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    chain.insert = vi.fn((payload: unknown) => {
      fromCalls.push({ table, op: 'insert', payload });
      const insertChain: any = {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({ data: { id: NEW_ITEM_ID }, error: null }),
          ),
        })),
        then: (resolve: any) => resolve({ error: null }),
      };
      return insertChain;
    });

    chain.update = vi.fn((payload: unknown) => {
      fromCalls.push({ table, op: 'update', payload });
      const updateChain: any = {
        eq: vi.fn(() => updateChain),
        then: (resolve: any) => resolve({ error: null }),
      };
      return updateChain;
    });

    return chain;
  };

  const mockSupabase = {
    from: vi.fn((table: string) => makeFromChain(table)),
    rpc: vi.fn((name: string) => {
      if (name === 'find_exact_duplicates') {
        const result = options.existingByHash;
        rpcHashCallIndex++;
        return Promise.resolve({ data: result, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  };

  return {
    mockSupabase,
    fromCalls,
    getRpcHashCalls: () => rpcHashCallIndex,
  };
}

async function primePipelineMocks() {
  const { pollFeed } = await import('@/lib/intelligence/feed-poller');
  const { extractContent } = await import(
    '@/lib/intelligence/content-extractor'
  );
  const { embeddingPreFilter, scoreRelevance } = await import(
    '@/lib/intelligence/relevance-scorer'
  );
  const { classifyContent } = await import('@/lib/ai/classify');

  vi.mocked(pollFeed).mockResolvedValue({
    feedSourceId: 'src-1',
    status: 'success',
    items: [
      {
        title: 'Test Article',
        url: ARTICLE_URL,
        guid: 'g-1',
        publishedAt: '2026-04-21T10:00:00Z',
        summary: 'Summary',
        contentEncoded: null,
        categories: [],
      },
    ],
    etag: null,
    lastModified: null,
  });

  vi.mocked(extractContent).mockResolvedValue({
    content: LONG_CONTENT,
    title: 'Test Article',
    description: 'Summary',
    thumbnailUrl: null,
    method: 'fetch',
    wordCount: 200,
  });

  vi.mocked(embeddingPreFilter).mockResolvedValue({
    similarity: 0.9,
    passed: true,
  });
  vi.mocked(scoreRelevance).mockResolvedValue({
    score: 0.8,
    category: 'high',
    reasoning: 'Relevant',
    matchedCategories: ['operations'],
    passed: true,
  });
  vi.mocked(classifyContent).mockResolvedValue({
    primary_domain: 'general-business',
    primary_subtopic: 'operations',
    secondary_domain: null,
    secondary_subtopic: null,
    confidence: 0.9,
    reasoning: 'mocked',
  } as any);
}

const source = {
  id: 'src-1',
  workspace_id: 'ws-1',
  name: 'Test Feed',
  url: 'https://example.com/feed.atom',
  etag: null,
  last_modified: null,
  polling_interval_minutes: 30,
  consecutive_failures: 0,
  article_count: 0,
};

const companyContext = {
  name: 'Acme',
  sectors: ['General'],
  services: ['Consulting'],
  keyTopics: ['procurement'],
  targetCustomers: 'SMBs',
  valueProposition: 'Insight',
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('EP11 RSS promotion — dedup behaviour', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await primePipelineMocks();
  });

  it('D3: same source_url already in KB → links existing item, no duplicate insert', async () => {
    const { mockSupabase, fromCalls } = buildMockSupabase({
      existingByUrl: { id: EXISTING_URL_MATCH_ID },
      existingByHash: [],
      existingJunctionLink: false,
    });

    await processFeedSource(
      mockSupabase as any,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    // No content_items insert — only feed_articles.update and junction insert
    const contentItemsInserts = fromCalls.filter(
      (c) => c.table === 'content_items' && c.op === 'insert',
    );
    expect(contentItemsInserts).toHaveLength(0);

    // Junction insert points at the existing item + new workspace
    const junctionInserts = fromCalls.filter(
      (c) => c.table === 'content_item_workspaces' && c.op === 'insert',
    );
    expect(junctionInserts).toHaveLength(1);
    expect(junctionInserts[0].payload).toEqual({
      workspace_id: 'ws-1',
      content_item_id: EXISTING_URL_MATCH_ID,
    });

    // feed_articles.content_item_id was linked to the existing id
    const feedArticleUpdates = fromCalls.filter(
      (c) => c.table === 'feed_articles' && c.op === 'update',
    );
    expect(feedArticleUpdates.length).toBeGreaterThanOrEqual(1);
    expect(feedArticleUpdates[0].payload).toEqual({
      content_item_id: EXISTING_URL_MATCH_ID,
    });
  });

  it('D3: same URL, junction already linked → skips redundant junction insert', async () => {
    const { mockSupabase, fromCalls } = buildMockSupabase({
      existingByUrl: { id: EXISTING_URL_MATCH_ID },
      existingByHash: [],
      existingJunctionLink: true,
    });

    await processFeedSource(
      mockSupabase as any,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    const junctionInserts = fromCalls.filter(
      (c) => c.table === 'content_item_workspaces' && c.op === 'insert',
    );
    // Already linked → no junction insert
    expect(junctionInserts).toHaveLength(0);
  });

  it('D1: new URL + exact-hash content match → insert with dedup_status=suspected_duplicate', async () => {
    const { mockSupabase, fromCalls } = buildMockSupabase({
      existingByUrl: null,
      existingByHash: [
        { id: EXISTING_HASH_MATCH_ID, title: 'Different URL same content' },
      ],
      existingJunctionLink: false,
    });

    await processFeedSource(
      mockSupabase as any,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    const insertPayload = fromCalls.find(
      (c) => c.table === 'content_items' && c.op === 'insert',
    )?.payload as Record<string, unknown> | undefined;

    expect(insertPayload).toBeDefined();
    expect(insertPayload!.dedup_status).toBe('suspected_duplicate');
    expect(insertPayload!.source_url).toBe(ARTICLE_URL);
    const metadata = insertPayload!.metadata as Record<string, unknown>;
    expect(metadata.suspected_duplicate_of).toBe(EXISTING_HASH_MATCH_ID);
  });

  it('archived items do not trigger D3 M2M (query filters archived_at IS NULL)', async () => {
    // When the URL exists but the row is archived, Supabase's
    // `.is('archived_at', null)` filter causes the pre-check to miss
    // the row and fall through to the content-hash path + fresh insert.
    // Simulate by returning null (filter excluded the archived row).
    const { mockSupabase, fromCalls } = buildMockSupabase({
      existingByUrl: null,
      existingByHash: [],
      existingJunctionLink: false,
    });

    await processFeedSource(
      mockSupabase as any,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    // The source_url pre-check filter must include archived_at IS NULL
    const urlPreCheck = fromCalls.find(
      (c) =>
        c.table === 'content_items' &&
        c.op === 'maybeSingle' &&
        c.filter?.source_url === ARTICLE_URL,
    );
    expect(urlPreCheck).toBeDefined();
    expect(urlPreCheck!.filter).toEqual(
      expect.objectContaining({ archived_at: null }),
    );
  });

  it('clean path: no URL match + no hash match → insert with dedup_status=clean', async () => {
    const { mockSupabase, fromCalls } = buildMockSupabase({
      existingByUrl: null,
      existingByHash: [],
      existingJunctionLink: false,
    });

    await processFeedSource(
      mockSupabase as any,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    const insertPayload = fromCalls.find(
      (c) => c.table === 'content_items' && c.op === 'insert',
    )?.payload as Record<string, unknown> | undefined;

    expect(insertPayload).toBeDefined();
    expect(insertPayload!.dedup_status).toBe('clean');
    const metadata = insertPayload!.metadata as Record<string, unknown>;
    expect(metadata.suspected_duplicate_of).toBeUndefined();

    // Junction + feed_articles still wired
    const junctionInserts = fromCalls.filter(
      (c) => c.table === 'content_item_workspaces' && c.op === 'insert',
    );
    expect(junctionInserts).toHaveLength(1);
    expect(junctionInserts[0].payload).toEqual({
      workspace_id: 'ws-1',
      content_item_id: NEW_ITEM_ID,
    });
  });
});
