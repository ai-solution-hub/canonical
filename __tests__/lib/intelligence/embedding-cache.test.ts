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
import {
  createMockSupabaseTableDispatch,
  type MockQueryChain,
} from '@/__tests__/helpers/mock-supabase';

describe('Company embedding caching', () => {
  const fakeEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(fakeEmbedding);
  });

  // Migrated onto the canonical createMockSupabaseTableDispatch (W-RG).
  // Most tables resolve to one fixed shape (per-table dispatch). Two
  // behaviours need per-table customisation that the helper exposes via
  // `_chains`:
  //   1. company_profiles.select is COLUMN-ARG-AWARE — the pipeline reads
  //      'company_embedding' and the profile-field set on the SAME table via
  //      two distinct .select(...).eq('id').maybeSingle() chains that must
  //      resolve to different read-back data. A single per-table resolution
  //      cannot express this, so we make .select arg-aware (and keep .eq
  //      returning the chain so .maybeSingle resolves the chosen shape).
  //   2. the embedding cache WRITE is a VOID .update(...).eq() — nothing is
  //      read back. We capture the update payload as the documented
  //      persistence contract (see "generates and caches" test).
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
        // Pre-seed so its chain exists in `_chains` for arg-aware override.
        company_profiles: { data: null, error: null },
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

    // --- company_profiles: column-arg-aware select read-back ---------------
    const profileChain: MockQueryChain = supabase._chains.company_profiles;
    const embeddingResult = {
      data: { company_embedding: cachedEmbedding },
      error: null,
    };
    const profileResult = { data: profileFields, error: null };
    profileChain.select.mockImplementation((cols: string) => {
      const result = cols.includes('company_embedding')
        ? embeddingResult
        : profileResult;
      // The chain's terminals resolve the chosen read-back; .eq stays
      // chainable so .maybeSingle() (the pipeline's terminator) wins.
      profileChain.maybeSingle.mockResolvedValue(result);
      profileChain.single.mockResolvedValue(result);
      return profileChain;
    });
    // VOID cache write — capture payload (persistence contract, no read-back).
    profileChain.update.mockImplementation((data: any) => {
      updateCalls.push({ table: 'company_profiles', data });
      return profileChain;
    });

    return Object.assign(supabase, { _updateCalls: updateCalls });
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
