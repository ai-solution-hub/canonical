/**
 * Guide Section Mapping — API Integration Tests
 *
 * Tests that guide section suggestions are properly integrated into
 * content creation pathways (upload, URL ingest, manual creation, MCP).
 *
 * These tests verify the integration layer behaviour:
 * - Suggestions included in responses when guides match
 * - Empty/absent when no guides match
 * - Failures are non-blocking (swallowed with console.error)
 *
 * Spec: docs/specs/guide-section-mapping-spec.md (Phase 2)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

// Hoisted mocks for vi.mock() factories
const {
  mockCookies,
  mockGenerateEmbedding,
  mockCheckRateLimit,
  mockClassifyContent,
  mockGenerateSummary,
  mockSuggestTopic,
  mockSuggestGuideSections,
  mockInferLayer,
  mockCalculateAndRoundQualityScore,
  mockCheckForDuplicates,
  mockFormatDedupWarning,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockClassifyContent: vi.fn(),
  mockGenerateSummary: vi.fn(),
  mockSuggestTopic: vi.fn(),
  mockSuggestGuideSections: vi.fn(),
  mockInferLayer: vi.fn(),
  mockCalculateAndRoundQualityScore: vi.fn(),
  mockCheckForDuplicates: vi.fn(),
  mockFormatDedupWarning: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: mockGenerateEmbedding,
  };
});

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: mockGenerateSummary,
}));

vi.mock('@/lib/topic-inference', () => ({
  suggestTopic: mockSuggestTopic,
}));

vi.mock('@/lib/guide-section-mapping', () => ({
  suggestGuideSections: mockSuggestGuideSections,
}));

vi.mock('@/lib/layer-inference', () => ({
  inferLayer: mockInferLayer,
}));

vi.mock('@/lib/quality/quality-score', () => ({
  calculateAndRoundQualityScore: mockCalculateAndRoundQualityScore,
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

vi.mock('@/lib/change-summary', () => ({
  generateSingleFieldChangeSummary: vi.fn().mockReturnValue('Field updated'),
}));

// Import routes AFTER mocks are registered
import { POST as itemsPost } from '@/app/api/items/route';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_GUIDE_SUGGESTIONS = [
  {
    guideId: 'guide-1',
    guideName: 'SCP Sector Guide',
    guideSlug: 'scp-sector-guide',
    sectionId: 'section-1',
    sectionName: 'Security',
    sectionOrder: 1,
    isRequired: true,
    matchStrength: 'exact' as const,
    matchReason:
      'Matches "SCP Sector Guide" > "Security" — all filters match (subtopic, layer)',
  },
  {
    guideId: 'guide-1',
    guideName: 'SCP Sector Guide',
    guideSlug: 'scp-sector-guide',
    sectionId: 'section-2',
    sectionName: 'Compliance',
    sectionOrder: 2,
    isRequired: false,
    matchStrength: 'partial' as const,
    matchReason:
      'Partially matches "SCP Sector Guide" > "Compliance" — matches subtopic but not layer',
  },
];

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function validItemCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Security Policy',
    content: '<p>Security policy content for the knowledge base.</p>',
    content_type: 'policy',
    primary_domain: 'Security',
    primary_subtopic: 'Physical Security',
    auto_classify: false,
    auto_summarise: false,
    auto_embed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset mocks
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
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.csv.mockReset();
  mockSupabase._chain.csv.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // Storage mocks
  const storageBucket = {
    upload: vi
      .fn()
      .mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi
      .fn()
      .mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);

  // Default mock implementations
  mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockClassifyContent.mockResolvedValue({ domains: [] });
  mockGenerateSummary.mockResolvedValue({ summary_data: {} });
  mockSuggestTopic.mockResolvedValue(null);
  mockSuggestGuideSections.mockResolvedValue([]);
  mockInferLayer.mockReturnValue({
    suggestedLayer: 'reference',
    reason: 'Policy documents are typically reference material',
    confidence: 'high',
  });
  mockCalculateAndRoundQualityScore.mockReturnValue(0.5);
  mockCheckForDuplicates.mockResolvedValue({
    has_duplicates: false,
    matches: [],
  });
  mockFormatDedupWarning.mockReturnValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════
// Items route — guide section integration
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/items — guide section suggestions', () => {
  function setupItemsSuccessPath() {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID,
        title: 'Test Security Policy',
        content_type: 'policy',
        created_at: '2026-01-01',
      },
      error: null,
    });
  }

  it('includes guide_section_suggestions in response when guides match', async () => {
    setupItemsSuccessPath();
    mockSuggestGuideSections.mockResolvedValue(SAMPLE_GUIDE_SUGGESTIONS);

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validItemCreateBody(),
    });

    const res = await itemsPost(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.guide_section_suggestions).toBeDefined();
    expect(body.guide_section_suggestions).toHaveLength(2);
    expect(body.guide_section_suggestions[0].guideName).toBe(
      'SCP Sector Guide',
    );
    expect(body.guide_section_suggestions[0].sectionName).toBe('Security');
    expect(body.guide_section_suggestions[0].matchStrength).toBe('exact');
  });

  it('omits guide_section_suggestions when no guides match', async () => {
    setupItemsSuccessPath();
    mockSuggestGuideSections.mockResolvedValue([]);

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validItemCreateBody(),
    });

    const res = await itemsPost(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.guide_section_suggestions).toBeUndefined();
  });

  it('does not include guide_section_suggestions when domain is missing', async () => {
    setupItemsSuccessPath();

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validItemCreateBody({ primary_domain: undefined }),
    });

    const res = await itemsPost(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.guide_section_suggestions).toBeUndefined();
    // suggestGuideSections should not have been called without a domain
    expect(mockSuggestGuideSections).not.toHaveBeenCalled();
  });

  it('still creates item when guide section suggestion throws', async () => {
    setupItemsSuccessPath();
    mockSuggestGuideSections.mockRejectedValue(
      new Error('Database connection failed'),
    );

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validItemCreateBody(),
    });

    const res = await itemsPost(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    // Item created successfully despite guide section failure
    expect(body.id).toBe(VALID_UUID);
    // guide_section_suggestions should be absent (not present with error)
    expect(body.guide_section_suggestions).toBeUndefined();
  });

  it('passes correct parameters to suggestGuideSections', async () => {
    setupItemsSuccessPath();
    mockSuggestGuideSections.mockResolvedValue([]);

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validItemCreateBody({
        primary_domain: 'Security',
        primary_subtopic: 'Physical Security',
        content_type: 'policy',
      }),
    });

    await itemsPost(req);

    expect(mockSuggestGuideSections).toHaveBeenCalledWith(
      expect.anything(), // service client
      expect.objectContaining({
        primaryDomain: 'Security',
        primarySubtopic: 'Physical Security',
        contentType: 'policy',
        layer: 'reference', // from mockInferLayer
      }),
    );
  });
});
