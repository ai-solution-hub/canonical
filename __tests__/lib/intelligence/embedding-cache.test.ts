// __tests__/lib/intelligence/embedding-cache.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
}));
vi.mock('@/lib/intelligence/content-extractor', () => ({
  extractContent: vi.fn(),
  checkFirecrawlApiKey: vi.fn(),
  isGoogleNewsUrl: vi.fn(() => false),
  resolveGoogleNewsUrl: vi.fn((url: string) => Promise.resolve(url)),
}));
// {112.11}: normaliseUrl relocated to @/lib/extraction/url-normalise.
vi.mock('@/lib/extraction/url-normalise', () => ({
  normaliseUrl: vi.fn((url: string) => url),
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
import { createMockSupabaseTableDispatch } from '@/__tests__/helpers/mock-supabase';

describe('Company embedding caching', () => {
  const fakeEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
  });

  // Migrated onto the canonical createMockSupabaseTableDispatch (W-RG).
  // ID-131 {131.11} G-SEARCH residual: the embedding cache read/write moved
  // off company_profiles.company_embedding onto the polymorphic
  // record_embeddings store (owner_kind='company_profile') — see
  // lib/intelligence/pipeline.ts's loadOrGenerateCompanyEmbedding. The
  // cache read is a single fixed-shape .select('embedding').eq(...).eq(...)
  // .eq(...).maybeSingle() on record_embeddings (one resolution per test,
  // no column-arg branching needed); the cache write is a VOID .upsert(...)
  // — we capture the payload via the chain's own vi.fn() call record as the
  // documented persistence contract (see "generates and caches" test).
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

    const profileFields = hasProfile
      ? {
          name: 'Test Co',
          sectors: ['education'],
          services: ['training'],
          key_topics: ['safeguarding'],
          target_customers: 'Schools',
          value_proposition: 'Expert training',
        }
      : null;

    const supabase = createMockSupabaseTableDispatch(
      {
        // Satellite read by getIntelligenceWorkspaceContext (S246): flat row
        // with company_profile_id, resolved via .eq().maybeSingle().
        intelligence_workspaces: {
          data: hasProfile
            ? {
                company_profile_id: 'profile-1',
                guide_id: null,
                relevance_threshold: null,
              }
            : null,
          error: null,
        },
        // company_profiles now serves ONLY the profile-field context load
        // (name/sectors/…) — the embedding cache lives on record_embeddings.
        company_profiles: { data: profileFields, error: null },
        // Cache read: .select('embedding').eq('owner_kind', 'company_profile')
        // .eq('owner_id', profileId).eq('model', ...).maybeSingle().
        record_embeddings: {
          data: cachedEmbedding ? { embedding: cachedEmbedding } : null,
          error: null,
        },
        si_processing_queue: { data: [], error: null },
        feed_prompts: { data: [], error: null },
        feed_articles: { data: [], error: null },
        feed_sources: { data: [], error: null },
      },
      {
        // get_due_feed_sources RPC — returns the due source(s).
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
      },
    );

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

    // Should have cached the embedding via an upsert onto record_embeddings
    // (owner_kind='company_profile'), not company_profiles.company_embedding.
    const upsertCall = supabase._chains.record_embeddings.upsert.mock.calls[0];
    expect(upsertCall).toBeDefined();
    const [row] = upsertCall;
    expect(row).toMatchObject({
      owner_kind: 'company_profile',
      owner_id: 'profile-1',
      model: 'text-embedding-3-large',
    });
    expect(JSON.parse(row.embedding)).toEqual(fakeEmbedding);
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
