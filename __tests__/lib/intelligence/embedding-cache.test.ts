// __tests__/lib/intelligence/embedding-cache.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
}));
vi.mock('@/lib/intelligence/content-extractor', () => ({
  extractContent: vi.fn(),
  normaliseUrl: vi.fn((url: string) => url),
  checkFirecrawlApiKey: vi.fn(),
  isGoogleNewsUrl: vi.fn(() => false),
  resolveGoogleNewsUrl: vi.fn((url: string) => Promise.resolve(url)),
}));
vi.mock('@/lib/intelligence/relevance-scorer', () => ({
  embeddingPreFilter: vi.fn(),
  scoreRelevance: vi.fn(),
}));
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));

const mockGenerateEmbedding = vi.fn();
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  };
});

// Import after mocks are set up
// We test the embedding caching through runPipeline which calls loadOrGenerateCompanyEmbedding
import { runPipeline } from '@/lib/intelligence/pipeline';
import { pollFeed } from '@/lib/intelligence/feed-poller';

describe('Company embedding caching', () => {
  const fakeEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
  });

  function createMockSupabase(opts: {
    cachedEmbedding?: string | null;
    hasProfile?: boolean;
    hasSources?: boolean;
  }) {
    const {
      cachedEmbedding = null,
      hasProfile = true,
      hasSources = true,
    } = opts;

    const updateCalls: any[] = [];

    const supabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'si_processing_queue') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'queue-1' },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'workspaces') {
          const workspaceResult = {
            data: hasProfile
              ? { domain_metadata: { company_profile_id: 'profile-1' } }
              : { domain_metadata: {} },
            error: null,
          };
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue(workspaceResult),
                maybeSingle: vi.fn().mockResolvedValue(workspaceResult),
              }),
            }),
          };
        }
        if (table === 'company_profiles') {
          return {
            select: vi.fn().mockImplementation((cols: string) => {
              if (cols.includes('company_embedding')) {
                const embeddingResult = {
                  data:
                    cachedEmbedding !== undefined
                      ? { company_embedding: cachedEmbedding }
                      : null,
                  error: null,
                };
                return {
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue(embeddingResult),
                    maybeSingle: vi.fn().mockResolvedValue(embeddingResult),
                  }),
                };
              }
              // Profile fields query
              const profileResult = {
                data: hasProfile
                  ? {
                      name: 'Test Co',
                      sectors: ['education'],
                      services: ['training'],
                      key_topics: ['safeguarding'],
                      target_customers: 'Schools',
                      value_proposition: 'Expert training',
                    }
                  : null,
                error: null,
              };
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue(profileResult),
                  maybeSingle: vi.fn().mockResolvedValue(profileResult),
                }),
              };
            }),
            update: vi.fn().mockImplementation((data: any) => {
              updateCalls.push({ table: 'company_profiles', data });
              return {
                eq: vi.fn().mockResolvedValue({ error: null }),
              };
            }),
          };
        }
        if (table === 'feed_prompts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'feed_sources') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'feed_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi
                  .fn()
                  .mockResolvedValue({ data: { id: 'fa-1' }, error: null }),
              }),
              error: null,
            }),
          };
        }
        // Default chain
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }),
      rpc: vi.fn().mockResolvedValue({
        data: hasSources
          ? [
              {
                id: 'source-1',
                workspace_id: 'ws-1',
                name: 'Test Feed',
                url: 'https://example.com/feed.xml',
                etag: null,
                last_modified: null,
                polling_interval_minutes: 30,
                consecutive_failures: 0,
                article_count: 0,
              },
            ]
          : [],
        error: null,
      }),
      _updateCalls: updateCalls,
    };

    return supabase;
  }

  it('uses cached embedding when available (no API call)', async () => {
    const cachedEmbeddingStr = JSON.stringify(fakeEmbedding);
    const supabase = createMockSupabase({
      cachedEmbedding: cachedEmbeddingStr,
    });

    // pollFeed returns empty items so we skip article processing
    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    await runPipeline(supabase as any);

    // Should NOT have called generateEmbedding since cache had a value
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('generates and caches embedding when cache is empty', async () => {
    const supabase = createMockSupabase({ cachedEmbedding: null });

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    await runPipeline(supabase as any);

    // Should have called generateEmbedding
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);

    // Should have cached the embedding via update
    const profileUpdate = supabase._updateCalls.find(
      (c: any) => c.table === 'company_profiles' && c.data.company_embedding,
    );
    expect(profileUpdate).toBeDefined();
    expect(JSON.parse(profileUpdate.data.company_embedding)).toEqual(
      fakeEmbedding,
    );
  });

  it('skips embedding when no company profile exists', async () => {
    const supabase = createMockSupabase({ hasProfile: false });

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    await runPipeline(supabase as any);

    // Should NOT have called generateEmbedding
    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('regenerates embedding when cached value is invalid JSON', async () => {
    const supabase = createMockSupabase({ cachedEmbedding: 'not-valid-json' });

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [],
      etag: null,
      lastModified: null,
    });

    await runPipeline(supabase as any);

    // Should have fallen back to generating a new embedding
    expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
  });
});
