/**
 * Content Suggestions API Route Tests
 *
 * Tests GET /api/content-suggestions:
 *   - Authentication required
 *   - Query param handling (limit, domain)
 *   - Response shape
 *   - Error handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies, mockGenerateContentSuggestions } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGenerateContentSuggestions: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/content/content-suggestions', () => ({
  generateContentSuggestions: mockGenerateContentSuggestions,
}));

// Import route handler AFTER mocks are registered
const { GET } = await import('@/app/api/content-suggestions/route');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_SUGGESTIONS = [
  {
    id: 'abc123',
    suggestion_type: 'empty_subtopic',
    priority: 'critical',
    domain: 'Security',
    subtopic: 'Certifications',
    title: 'No content for Certifications',
    description:
      'Security has an active bid but zero content for Certifications.',
    suggested_content_type: 'policy',
    item_count: 0,
  },
  {
    id: 'def456',
    suggestion_type: 'thin_coverage',
    priority: 'medium',
    domain: 'Corporate',
    subtopic: 'Team',
    title: 'Thin coverage for Team',
    description: 'Corporate / Team has only 1 item.',
    suggested_content_type: 'article',
    item_count: 1,
    freshness_breakdown: { fresh: 1, aging: 0, stale: 0, expired: 0 },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/content-suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    mockGenerateContentSuggestions.mockResolvedValue(SAMPLE_SUGGESTIONS);
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest('/api/content-suggestions');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns suggestions with default limit', async () => {
    const req = createTestRequest('/api/content-suggestions');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toEqual(SAMPLE_SUGGESTIONS);

    // Should have been called with limit 5 (default)
    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSuggestions: 5,
      }),
    );
  });

  it('honours the requested limit when generating suggestions', async () => {
    const req = createTestRequest('/api/content-suggestions', {
      searchParams: { limit: '10' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSuggestions: 10,
      }),
    );
  });

  it('clamps limit to 1-20 range', async () => {
    // Too high
    const req1 = createTestRequest('/api/content-suggestions', {
      searchParams: { limit: '100' },
    });
    await GET(req1);
    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSuggestions: 20,
      }),
    );

    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    mockGenerateContentSuggestions.mockResolvedValue([]);

    // Too low
    const req2 = createTestRequest('/api/content-suggestions', {
      searchParams: { limit: '0' },
    });
    await GET(req2);
    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        maxSuggestions: 1,
      }),
    );
  });

  it('restricts suggestions to the requested domain when provided', async () => {
    const req = createTestRequest('/api/content-suggestions', {
      searchParams: { domain: 'Security' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        domainFilter: 'Security',
      }),
    );
  });

  it('omits domain filter when not provided', async () => {
    const req = createTestRequest('/api/content-suggestions');
    await GET(req);

    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        domainFilter: undefined,
      }),
    );
  });

  it('returns 500 on engine error', async () => {
    mockGenerateContentSuggestions.mockRejectedValue(
      new Error('DB connection failed'),
    );

    const req = createTestRequest('/api/content-suggestions');
    const res = await GET(req);
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('always enables template gaps', async () => {
    const req = createTestRequest('/api/content-suggestions');
    await GET(req);

    expect(mockGenerateContentSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTemplateGaps: true,
      }),
    );
  });
});
