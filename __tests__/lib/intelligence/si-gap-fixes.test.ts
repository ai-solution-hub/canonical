// __tests__/lib/intelligence/si-gap-fixes.test.ts
// Tests for SI gap analysis fixes: SI-L3 (dynamic content type), SI-L5 (workspace scoring threshold)
/* eslint-disable @typescript-eslint/no-explicit-any -- mock supabase clients require flexible typing */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── SI-L3: Dynamic Content Type Detection ──

// Mock pipeline dependencies so we can import inferContentType
vi.mock('@/lib/intelligence/feed-poller', () => ({
  pollFeed: vi.fn(),
  validateFeedUrl: vi.fn(),
}));
vi.mock('@/lib/intelligence/content-extractor', () => ({
  extractContent: vi.fn(),
  normaliseUrl: vi.fn((url: string) => url),
  isGoogleNewsUrl: vi.fn(() => false),
  resolveGoogleNewsUrl: vi.fn((url: string) => Promise.resolve(url)),
  checkFirecrawlApiKey: vi.fn(),
}));
vi.mock('@/lib/intelligence/relevance-scorer', () => ({
  embeddingPreFilter: vi.fn(),
  scoreRelevance: vi.fn(),
}));
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(),
  };
});
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));

describe('SI-L3: inferContentType', () => {
  it('infers policy type from subtopic', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('education', 'education-policy')).toBe('policy');
    expect(inferContentType('safeguarding', 'regulation-updates')).toBe(
      'policy',
    );
    expect(inferContentType('legal', 'new-legislation')).toBe('policy');
  });

  it('infers research type from subtopic', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('education', 'academic-research')).toBe('research');
    expect(inferContentType('health', 'longitudinal-study')).toBe('research');
    expect(inferContentType('data', 'market-analysis')).toBe('research');
  });

  it('infers compliance type from subtopic', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('safeguarding', 'compliance-requirements')).toBe(
      'compliance',
    );
    expect(inferContentType('finance', 'audit-standards')).toBe('compliance');
  });

  it('infers certification type from subtopic', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('quality', 'iso-certification')).toBe(
      'certification',
    );
    expect(inferContentType('education', 'school-accreditation')).toBe(
      'certification',
    );
  });

  it('infers case_study type from subtopic', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('education', 'implementation-case-study')).toBe(
      'case_study',
    );
  });

  it('infers methodology type', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('methodology', 'assessment-frameworks')).toBe(
      'methodology',
    );
    expect(inferContentType('education', 'teaching-methodology')).toBe(
      'methodology',
    );
  });

  it('returns null for generic article content', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType('education', 'curriculum-update')).toBeNull();
    expect(inferContentType('technology', 'ai-tools')).toBeNull();
  });

  it('returns null for null inputs', async () => {
    const { inferContentType } = await import('@/lib/intelligence/pipeline');
    expect(inferContentType(null, null)).toBeNull();
  });
});

// ── SI-L5: Workspace-Level Scoring Threshold ──

describe('SI-L5: Workspace-Level Scoring Threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes workspace threshold to scoreRelevance', async () => {
    const { processFeedSource } = await import('@/lib/intelligence/pipeline');
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { extractContent } =
      await import('@/lib/intelligence/content-extractor');
    const { embeddingPreFilter, scoreRelevance } =
      await import('@/lib/intelligence/relevance-scorer');

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

    vi.mocked(embeddingPreFilter).mockResolvedValue({
      similarity: 0.6,
      passed: true,
    });

    vi.mocked(scoreRelevance).mockResolvedValue({
      score: 0.7,
      category: 'medium',
      reasoning: 'Somewhat relevant',
      matchedCategories: ['education'],
      passed: true,
    });

    const mockSupabase = {
      from: vi.fn().mockImplementation(() => ({
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
        insert: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: { id: 'ci-1' }, error: null }),
          }),
          error: null,
        })),
      })),
    } as any;

    const source = {
      id: 'source-1',
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
      name: 'Test Co',
      sectors: ['education'],
      services: ['training'],
      keyTopics: ['safeguarding'],
      targetCustomers: null,
      valueProposition: null,
    };

    const customThreshold = 0.7;
    await processFeedSource(
      mockSupabase,
      source,
      companyContext,
      [0.1, 0.2, 0.3], // dummy embedding
      null,
      customThreshold,
    );

    // Verify scoreRelevance was called with the custom threshold
    expect(scoreRelevance).toHaveBeenCalledWith(
      'Test Article',
      expect.any(String),
      companyContext,
      customThreshold,
      undefined,
    );
  });

  it('uses default threshold when not specified', async () => {
    const { processFeedSource } = await import('@/lib/intelligence/pipeline');
    const { pollFeed } = await import('@/lib/intelligence/feed-poller');
    const { extractContent } =
      await import('@/lib/intelligence/content-extractor');
    const { embeddingPreFilter, scoreRelevance } =
      await import('@/lib/intelligence/relevance-scorer');

    vi.mocked(pollFeed).mockResolvedValue({
      feedSourceId: 'source-1',
      status: 'success',
      items: [
        {
          title: 'Test Article',
          url: 'https://example.com/article2',
          guid: 'guid-2',
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

    vi.mocked(embeddingPreFilter).mockResolvedValue({
      similarity: 0.6,
      passed: true,
    });

    vi.mocked(scoreRelevance).mockResolvedValue({
      score: 0.6,
      category: 'medium',
      reasoning: 'Relevant',
      matchedCategories: ['education'],
      passed: true,
    });

    const mockSupabase = {
      from: vi.fn().mockImplementation(() => ({
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
        insert: vi.fn().mockImplementation(() => ({
          select: vi.fn().mockReturnValue({
            single: vi
              .fn()
              .mockResolvedValue({ data: { id: 'ci-2' }, error: null }),
          }),
          error: null,
        })),
      })),
    } as any;

    const source = {
      id: 'source-2',
      workspace_id: 'ws-2',
      name: 'Test Feed 2',
      url: 'https://example.com/feed2.atom',
      etag: null,
      last_modified: null,
      polling_interval_minutes: 30,
      consecutive_failures: 0,
      article_count: 0,
    };

    const companyContext = {
      name: 'Test Co',
      sectors: ['education'],
      services: ['training'],
      keyTopics: ['safeguarding'],
      targetCustomers: null,
      valueProposition: null,
    };

    // No threshold specified — should use DEFAULT_RELEVANCE_THRESHOLD (0.5)
    await processFeedSource(
      mockSupabase,
      source,
      companyContext,
      [0.1, 0.2, 0.3],
    );

    expect(scoreRelevance).toHaveBeenCalledWith(
      'Test Article',
      expect.any(String),
      companyContext,
      0.5, // DEFAULT_RELEVANCE_THRESHOLD
      undefined,
    );
  });
});
