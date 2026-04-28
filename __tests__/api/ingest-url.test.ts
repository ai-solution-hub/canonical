import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// ---------------------------------------------------------------------------
// Mock external dependencies
// ---------------------------------------------------------------------------

const {
  mockCheckRateLimit,
  mockValidateUrl,
  mockDetectContentType,
  mockExtractFromUrl,
  mockGenerateEmbedding,
  mockClassifyContent,
  mockGenerateSummary,
  mockCheckForDuplicates,
  mockFormatDedupWarning,
  mockSuggestTopic,
  mockExtractTemporalReferences,
  mockFindExpiryDate,
  mockExtractDates,
  mockCalculateAndRoundQualityScore,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockValidateUrl: vi.fn(),
  mockDetectContentType: vi.fn(),
  mockExtractFromUrl: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockClassifyContent: vi.fn(),
  mockGenerateSummary: vi.fn(),
  mockCheckForDuplicates: vi.fn(),
  mockFormatDedupWarning: vi.fn(),
  mockSuggestTopic: vi.fn(),
  mockExtractTemporalReferences: vi.fn(),
  mockFindExpiryDate: vi.fn(),
  mockExtractDates: vi.fn(),
  mockCalculateAndRoundQualityScore: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/extraction/url-validation', () => ({
  validateUrl: mockValidateUrl,
}));

vi.mock('@/lib/extraction/content-type-detect', () => ({
  detectContentType: mockDetectContentType,
}));

vi.mock('@/lib/extraction/url', () => ({
  extractFromUrl: mockExtractFromUrl,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: mockGenerateSummary,
}));

vi.mock('@/lib/dedup', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/dedup')>('@/lib/dedup');
  return {
    ...actual,
    checkForDuplicates: mockCheckForDuplicates,
    formatDedupWarning: mockFormatDedupWarning,
  };
});

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: mockSuggestTopic,
}));

vi.mock('@/lib/date-extraction', () => ({
  extractTemporalReferences: mockExtractTemporalReferences,
  findExpiryDate: mockFindExpiryDate,
  extractDates: mockExtractDates,
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: mockCalculateAndRoundQualityScore,
}));

// Import route AFTER mocks are registered
import { POST } from '@/app/api/ingest/url/route';

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

const SAMPLE_URL = 'https://example.com/article';

const SAMPLE_EXTRACTION = {
  title: 'Test Article',
  content:
    '<p>This is a sufficiently long test article content that exceeds the minimum threshold for quality checks. It needs to be over five hundred characters to avoid the low-content warning. Let us add more text to make sure we pass the checks. Here is additional content about testing URL ingestion for the knowledge hub platform. The article discusses various aspects of content management and knowledge base systems. More filler text to ensure we comfortably exceed the threshold.</p>',
  author: 'Test Author',
  excerpt: 'A test article',
  ogImage: 'https://example.com/image.jpg',
  ogDescription: 'A test article description',
  ogDate: '2026-01-01',
  extractionMethod: 'readability' as const,
  contentLength: 550,
};

const SAMPLE_EMBEDDING = [0.1, 0.2, 0.3];

function setupSuccessPath() {
  mockValidateUrl.mockReturnValue({ valid: true });
  mockDetectContentType.mockReturnValue('article');
  mockExtractFromUrl.mockResolvedValue(SAMPLE_EXTRACTION);
  mockGenerateEmbedding.mockResolvedValue(SAMPLE_EMBEDDING);
  mockCheckForDuplicates.mockResolvedValue({
    has_duplicates: false,
    matches: [],
  });
  mockFormatDedupWarning.mockReturnValue(null);
  mockClassifyContent.mockResolvedValue(undefined);
  mockGenerateSummary.mockResolvedValue(undefined);
  mockExtractTemporalReferences.mockReturnValue([]);
  mockFindExpiryDate.mockReturnValue(null);
  mockExtractDates.mockReturnValue([]);
  mockCalculateAndRoundQualityScore.mockReturnValue(65);
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const method of chainable) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Default: rate limit allows
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  mockSuggestTopic.mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth & Authorisation
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Auth', () => {
  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Rate Limiting', () => {
  it('returns 429 when rate limited', async () => {
    configureRole(mockSupabase, 'editor');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Validation', () => {
  it('returns 400 for missing URL', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid URL format', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: 'not-a-url' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for localhost URL (SSRF protection)', async () => {
    configureRole(mockSupabase, 'editor');
    mockValidateUrl.mockReturnValue({
      valid: false,
      error: 'URLs pointing to localhost or loopback addresses are not allowed',
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: 'http://localhost:3000/secret' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('localhost');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// URL Already Exists
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Existing URL', () => {
  it('returns existing item info when URL already in KB', async () => {
    configureRole(mockSupabase, 'editor');
    mockValidateUrl.mockReturnValue({ valid: true });

    // maybeSingle returns existing item
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'existing-id', title: 'Existing Article' },
      error: null,
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url_already_exists).toBe(true);
    expect(body.existing_item.id).toBe('existing-id');
    expect(body.existing_item.title).toBe('Existing Article');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Successful Import
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Successful Import', () => {
  beforeEach(() => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();

    // maybeSingle for URL check — no existing item
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // single for insert — returns new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-03-19T00:00:00Z',
      },
      error: null,
    });

    // then for content_history insert
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // single for quality score fetch (latestItem)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });

    // maybeSingle for domain/subtopic re-fetch (topic suggestion step)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
      },
      error: null,
    });

    // maybeSingle for final item fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
        summary: 'A test summary',
      },
      error: null,
    });
  });

  it('returns 200 with item ID on successful HTML import', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('new-item-id');
    expect(body.title).toBe('Test Article');
    expect(body.source_url).toBe(SAMPLE_URL);
    expect(body.primary_domain).toBe('General Business');
  });

  it('passes content_type through when provided', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL, content_type: 'blog' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content_type).toBe('blog');
  });

  it('passes user_tags through when provided', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL, user_tags: ['tag-a', 'tag-b'] },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify insert was called with user_tags
    const insertCall = mockSupabase._chain.insert.mock.calls[0];
    expect(insertCall).toBeDefined();
    const insertData = insertCall[0];
    expect(insertData.user_tags).toEqual(['tag-a', 'tag-b']);
  });

  it('creates content_items record with correct fields', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    // Verify insert was called
    expect(mockSupabase._chain.insert).toHaveBeenCalled();
    const insertData = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertData.title).toBe('Test Article');
    expect(insertData.content).toBe(SAMPLE_EXTRACTION.content);
    expect(insertData.source_url).toBe(SAMPLE_URL);
    expect(insertData.source_domain).toBe('example.com');
    expect(insertData.author_name).toBe('Test Author');
    expect(insertData.created_by).toBe('test-user-id');
  });

  // ───────────────────────────────────────────────────────────────────
  // S206 WP-A Phase 2 — content_owner_id default at URL ingest EP
  // ───────────────────────────────────────────────────────────────────

  it('defaults content_owner_id to authenticated user UUID', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const insertData = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertData.content_owner_id).toBe('test-user-id');
    expect(insertData.created_by).toBe('test-user-id');
  });

  it('sets platform to web', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    const insertData = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertData.platform).toBe('web');
  });

  it('sets metadata.ingestion_source to url_import', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    const insertData = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertData.metadata.ingestion_source).toBe('url_import');
    expect(insertData.metadata.extraction_method).toBe('readability');
  });

  it('calls classifyContent with correct params', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    expect(mockClassifyContent).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'new-item-id',
        force: true,
        userId: 'test-user-id',
      }),
    );
  });

  it('calls generateSummary', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    expect(mockGenerateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'new-item-id',
        force: true,
        userId: 'test-user-id',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Warnings & Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Warnings & Edge Cases', () => {
  it('returns warnings for failed classify', async () => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();
    mockClassifyContent.mockRejectedValue(new Error('API rate limit'));

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single for insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test',
        content_type: 'article',
        created_at: '2026-03-19',
      },
      error: null,
    });
    // then for content_history
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    // single for quality score fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });
    // maybeSingle for domain/subtopic re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null },
      error: null,
    });
    // maybeSingle for final fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null, summary: null },
      error: null,
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toContain('Classification failed: API rate limit');
  });

  it('returns 422 for content < 100 chars', async () => {
    configureRole(mockSupabase, 'editor');
    mockValidateUrl.mockReturnValue({ valid: true });
    mockExtractFromUrl.mockResolvedValue({
      ...SAMPLE_EXTRACTION,
      content: 'Short content',
      contentLength: 13,
    });

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('less than 100 characters');
  });

  it('returns warning for content 100-500 chars', async () => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();
    mockExtractFromUrl.mockResolvedValue({
      ...SAMPLE_EXTRACTION,
      content: 'A'.repeat(200),
      contentLength: 200,
    });

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single for insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test',
        content_type: 'article',
        created_at: '2026-03-19',
      },
      error: null,
    });
    // then for content_history
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    // single for quality score fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });
    // maybeSingle for domain/subtopic re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null },
      error: null,
    });
    // maybeSingle for final fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null, summary: null },
      error: null,
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toContain(
      'Limited text extracted from this page. The content may be incomplete.',
    );
  });

  it('returns dedup matches when found', async () => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();

    const dedupMatches = [
      {
        id: 'dup-1',
        title: 'Similar Item',
        similarity: 0.95,
        match_type: 'near_duplicate' as const,
      },
    ];
    mockCheckForDuplicates.mockResolvedValue({
      has_duplicates: true,
      matches: dedupMatches,
    });
    mockFormatDedupWarning.mockReturnValue('1 near-duplicate found');

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single for insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test',
        content_type: 'article',
        created_at: '2026-03-19',
      },
      error: null,
    });
    // then for content_history
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    // single for quality score fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });
    // maybeSingle for domain/subtopic re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null },
      error: null,
    });
    // maybeSingle for final fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null, summary: null },
      error: null,
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate_matches).toHaveLength(1);
    expect(body.duplicate_matches[0].id).toBe('dup-1');
    expect(body.warnings).toContain('1 near-duplicate found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Topic Suggestion
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Topic Suggestion', () => {
  beforeEach(() => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();

    // maybeSingle for URL check — no existing item
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // single for insert — returns new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-03-19T00:00:00Z',
      },
      error: null,
    });

    // then for content_history insert
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );

    // single for quality score fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });

    // maybeSingle for domain/subtopic re-fetch (for topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
      },
      error: null,
    });

    // maybeSingle for final item fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
        summary: 'A test summary',
      },
      error: null,
    });
  });

  it('includes topic_suggestion in response when topic match found', async () => {
    mockSuggestTopic.mockResolvedValueOnce({
      topicId: 'general-business-strategy',
      reason:
        'Existing topic group "general-business-strategy" covers this domain and subtopic',
      existingLayers: [
        { id: 'other-id', title: 'Strategy Guide', layer: 'bid_detail' },
      ],
      missingLayers: ['sales_brief', 'research'],
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topic_suggestion).toBeDefined();
    expect(body.topic_suggestion.topicId).toBe('general-business-strategy');
  });

  it('does not include topic_suggestion when no match found', async () => {
    mockSuggestTopic.mockResolvedValueOnce(null);

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topic_suggestion).toBeUndefined();
  });

  it('still returns success when topic suggestion fails', async () => {
    mockSuggestTopic.mockRejectedValueOnce(new Error('Network timeout'));

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('new-item-id');
    expect(body.topic_suggestion).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer Column Write (Gap 1b)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Layer Column Write', () => {
  beforeEach(() => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single for insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-03-19T00:00:00Z',
      },
      error: null,
    });
    // then for content_history
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    // maybeSingle for domain/subtopic re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null },
      error: null,
    });
    // maybeSingle for final fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null, summary: null },
      error: null,
    });
  });

  it('writes layer to column via .update() not rpc merge_item_metadata', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    // Layer should be written via .update() on content_items, not via rpc
    const rpcCalls = mockSupabase.rpc.mock.calls;
    const layerRpcCalls = rpcCalls.filter(
      (call: unknown[]) =>
        call[0] === 'merge_item_metadata' &&
        typeof call[1] === 'object' &&
        call[1] !== null &&
        'p_new_data' in call[1] &&
        typeof (call[1] as Record<string, unknown>).p_new_data === 'object' &&
        (call[1] as Record<string, unknown>).p_new_data !== null &&
        'layer' in
          ((call[1] as Record<string, unknown>).p_new_data as Record<
            string,
            unknown
          >),
    );
    expect(layerRpcCalls).toHaveLength(0);

    // Verify .update() was called (the from/update/eq chain)
    expect(mockSupabase._chain.update).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Date Extraction (Gap 13a)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Date Extraction', () => {
  beforeEach(() => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single for insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-03-19T00:00:00Z',
      },
      error: null,
    });
    // then for content_history
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    // maybeSingle for domain/subtopic re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null },
      error: null,
    });
    // maybeSingle for final fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null, summary: null },
      error: null,
    });
  });

  it('calls date extraction functions on extracted content', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    expect(mockExtractTemporalReferences).toHaveBeenCalledWith(
      SAMPLE_EXTRACTION.content,
    );
    expect(mockExtractDates).toHaveBeenCalledWith(SAMPLE_EXTRACTION.content);
    expect(mockFindExpiryDate).toHaveBeenCalled();
  });

  it('adds expiry date warning when expiry date detected', async () => {
    mockFindExpiryDate.mockReturnValue('2027-06-30');

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.warnings.some((w: string) => w.includes('Expiry date detected')),
    ).toBe(true);
  });

  it('still succeeds when date extraction fails', async () => {
    mockExtractTemporalReferences.mockImplementation(() => {
      throw new Error('Parse failure');
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('new-item-id');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Quality Score (Gap 13b)
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/ingest/url — Quality Score', () => {
  beforeEach(() => {
    configureRole(mockSupabase, 'editor');
    setupSuccessPath();

    // maybeSingle for URL check
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // single for insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-03-19T00:00:00Z',
      },
      error: null,
    });
    // then for content_history
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    );
    // single for quality score fetch (latestItem)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.85,
        brief: null,
        detail: null,
        reference: null,
        summary: 'A summary',
        citation_count: 0,
      },
      error: null,
    });
    // maybeSingle for domain/subtopic re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null },
      error: null,
    });
    // maybeSingle for final fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: null, primary_subtopic: null, summary: null },
      error: null,
    });
  });

  it('calls calculateAndRoundQualityScore after summarise', async () => {
    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    await POST(req);

    expect(mockCalculateAndRoundQualityScore).toHaveBeenCalledWith(
      expect.objectContaining({
        freshness: 'fresh',
        classification_confidence: 0.85,
        summary: 'A summary',
        citation_count: 0,
      }),
    );
  });

  it('still succeeds when quality score calculation fails', async () => {
    mockCalculateAndRoundQualityScore.mockImplementation(() => {
      throw new Error('Score calculation error');
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('new-item-id');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Dedup soft-block + admin override (WP1 / spec §6 D1, D2)
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/ingest/url — Dedup soft-block', () => {
  const EXISTING_ID = 'b2c3d4e5-f6a7-4890-8bcd-ef1234567891';

  function primeCommonMocks() {
    setupSuccessPath();

    // maybeSingle for URL pre-check — no URL match (so content-hash path runs)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // single for insert — returns new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-04-21T00:00:00Z',
      },
      error: null,
    });

    // single for quality score fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });

    // maybeSingle for domain re-fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
      },
      error: null,
    });

    // maybeSingle for final item fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
        summary: 'A test summary',
      },
      error: null,
    });
  }

  it('stamps dedup_status=suspected_duplicate on exact-hash match', async () => {
    configureRole(mockSupabase, 'editor');
    primeCommonMocks();
    mockCheckForDuplicates.mockResolvedValueOnce({
      has_duplicates: true,
      matches: [
        {
          id: EXISTING_ID,
          title: 'Existing Article',
          similarity: 1.0,
          match_type: 'exact',
        },
      ],
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dedup_status).toBe('suspected_duplicate');
    expect(body.suspected_duplicate_of).toBe(EXISTING_ID);

    const insertCall = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertCall.dedup_status).toBe('suspected_duplicate');
    expect(insertCall.metadata.suspected_duplicate_of).toBe(EXISTING_ID);
  });

  it('stamps dedup_status=clean when no exact match', async () => {
    configureRole(mockSupabase, 'editor');
    primeCommonMocks();
    // Default: no duplicates

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dedup_status).toBe('clean');
    expect(body.suspected_duplicate_of).toBeUndefined();

    const insertCall = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertCall.dedup_status).toBe('clean');
  });

  it('admin skip_dedup=true bypasses stamp even on exact match', async () => {
    configureRole(mockSupabase, 'admin');
    primeCommonMocks();
    mockCheckForDuplicates.mockResolvedValueOnce({
      has_duplicates: true,
      matches: [
        {
          id: EXISTING_ID,
          title: 'Existing Article',
          similarity: 1.0,
          match_type: 'exact',
        },
      ],
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL, skip_dedup: true },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dedup_status).toBe('clean');
    expect(body.suspected_duplicate_of).toBeUndefined();
  });

  it('non-admin skip_dedup=true is silently ignored', async () => {
    configureRole(mockSupabase, 'editor');
    primeCommonMocks();
    mockCheckForDuplicates.mockResolvedValueOnce({
      has_duplicates: true,
      matches: [
        {
          id: EXISTING_ID,
          title: 'Existing Article',
          similarity: 1.0,
          match_type: 'exact',
        },
      ],
    });

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL, skip_dedup: true },
    });
    // Should NOT 403 — silent-ignore per spec §6 D2
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.dedup_status).toBe('suspected_duplicate');
    expect(body.suspected_duplicate_of).toBe(EXISTING_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// S206 WP-A Phase 2 verifier finding M-3 — content_owner_id admin-override
// + silent-force coverage at the URL ingest entry point.
//
// Pattern mirrors the Dedup soft-block describe above: a local
// `primeCommonMocks()` queues the chain in the order the route consumes,
// so role-mock queueing is owned by each test (rather than the parent
// describe's beforeEach pre-queuing 'editor').
// ─────────────────────────────────────────────────────────────────────────

describe('POST /api/ingest/url — content_owner_id admin override', () => {
  const OTHER_UUID = '11111111-2222-4333-8444-555555555555';

  function primeCommonMocks() {
    setupSuccessPath();

    // maybeSingle for URL pre-check — no URL match
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    // single for insert — returns new item
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: 'new-item-id',
        title: 'Test Article',
        content_type: 'article',
        created_at: '2026-04-28T00:00:00Z',
      },
      error: null,
    });

    // single for quality score fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        freshness: 'fresh',
        classification_confidence: 0.9,
        brief: null,
        detail: null,
        reference: null,
        summary: null,
        citation_count: 0,
      },
      error: null,
    });

    // maybeSingle for domain re-fetch (topic suggestion)
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: { primary_domain: 'General Business', primary_subtopic: 'Strategy' },
      error: null,
    });

    // maybeSingle for final item fetch
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        primary_domain: 'General Business',
        primary_subtopic: 'Strategy',
        summary: 'A test summary',
      },
      error: null,
    });
  }

  it('admin override: explicit content_owner_id is respected when caller is admin', async () => {
    configureRole(mockSupabase, 'admin');
    primeCommonMocks();

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL, content_owner_id: OTHER_UUID },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const insertData = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertData.content_owner_id).toBe(OTHER_UUID);
    // created_by always tracks the caller, not the override target
    expect(insertData.created_by).toBe('test-user-id');
  });

  it('non-admin override is silent-forced: explicit content_owner_id ignored for editor', async () => {
    configureRole(mockSupabase, 'editor');
    primeCommonMocks();

    const req = createTestRequest('/api/ingest/url', {
      method: 'POST',
      body: { url: SAMPLE_URL, content_owner_id: OTHER_UUID },
    });
    const res = await POST(req);
    // Silent-force = legitimate write, not 403
    expect(res.status).toBe(200);

    const insertData = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertData.content_owner_id).toBe('test-user-id');
    expect(insertData.created_by).toBe('test-user-id');
  });
});
