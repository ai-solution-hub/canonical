/**
 * POST /api/dedup/check — Dedup check endpoint tests.
 *
 * Tests the per-pair dedup checking endpoint used by the Q&A preview flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Mock checkForDuplicates to avoid real DB calls
const { mockCheckForDuplicates } = vi.hoisted(() => ({
  mockCheckForDuplicates: vi.fn(),
}));

vi.mock('@/lib/dedup', () => ({
  checkForDuplicates: mockCheckForDuplicates,
}));

// Mock rate limiter — allow all by default
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({
    allowed: true,
    remaining: 29,
    resetAt: Date.now() + 60000,
  })),
}));

// Import route AFTER mocks are registered
const { POST } = await import('@/app/api/dedup/check/route');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/dedup/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/dedup/check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user with editor role
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'editor@example.com' } },
      error: null,
    });
  });

  describe('authentication and authorisation', () => {
    it('returns 401 when not authenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const res = await POST(makeRequest({ text: 'test content' }));
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const res = await POST(makeRequest({ text: 'test content' }));
      expect(res.status).toBe(403);
    });

    it('allows editor role', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: false,
        matches: [],
      });

      const res = await POST(makeRequest({ text: 'test content' }));
      expect(res.status).toBe(200);
    });

    it('allows admin role', async () => {
      configureRole(mockSupabase, 'admin');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: false,
        matches: [],
      });

      const res = await POST(makeRequest({ text: 'test content' }));
      expect(res.status).toBe(200);
    });
  });

  describe('request validation', () => {
    it('returns 400 when text is missing', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({}));
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 when text is empty string', async () => {
      configureRole(mockSupabase, 'editor');

      const res = await POST(makeRequest({ text: '' }));
      expect(res.status).toBe(400);
    });

    it('accepts text-only request (no embedding)', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: false,
        matches: [],
      });

      const res = await POST(makeRequest({ text: 'Some Q&A content' }));
      expect(res.status).toBe(200);
      expect(mockCheckForDuplicates).toHaveBeenCalledWith(
        expect.anything(),
        'Some Q&A content',
        undefined,
      );
    });

    it('accepts text with embedding', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: false,
        matches: [],
      });

      const embedding = [0.1, 0.2, 0.3];
      const res = await POST(makeRequest({ text: 'content', embedding }));
      expect(res.status).toBe(200);
      expect(mockCheckForDuplicates).toHaveBeenCalledWith(
        expect.anything(),
        'content',
        embedding,
      );
    });
  });

  describe('duplicate detection results', () => {
    it('returns isDuplicate: false when no matches', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: false,
        matches: [],
      });

      const res = await POST(makeRequest({ text: 'unique content' }));
      const body = await res.json();

      expect(body.isDuplicate).toBe(false);
      expect(body.matches).toEqual([]);
    });

    it('returns isDuplicate: true with matches when duplicates found', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: true,
        matches: [
          {
            id: 'item-1',
            title: 'Existing Q&A pair',
            similarity: 0.95,
            match_type: 'near_duplicate',
          },
          {
            id: 'item-2',
            title: 'Another similar pair',
            similarity: 1.0,
            match_type: 'exact',
          },
        ],
      });

      const res = await POST(makeRequest({ text: 'duplicate content' }));
      const body = await res.json();

      expect(body.isDuplicate).toBe(true);
      expect(body.matches).toHaveLength(2);
      expect(body.matches[0]).toEqual({
        id: 'item-1',
        title: 'Existing Q&A pair',
        similarity: 0.95,
      });
      expect(body.matches[1]).toEqual({
        id: 'item-2',
        title: 'Another similar pair',
        similarity: 1.0,
      });
    });

    it('strips match_type from response (returns only id, title, similarity)', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockResolvedValue({
        has_duplicates: true,
        matches: [
          {
            id: 'item-1',
            title: 'Match',
            similarity: 0.93,
            match_type: 'near_duplicate',
          },
        ],
      });

      const res = await POST(makeRequest({ text: 'content' }));
      const body = await res.json();

      expect(body.matches[0]).not.toHaveProperty('match_type');
    });
  });

  describe('error handling', () => {
    it('returns 500 when checkForDuplicates throws', async () => {
      configureRole(mockSupabase, 'editor');
      mockCheckForDuplicates.mockRejectedValue(
        new Error('DB connection failed'),
      );

      const res = await POST(makeRequest({ text: 'content' }));
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limit exceeded', async () => {
      configureRole(mockSupabase, 'editor');

      // Override the rate limiter mock for this test
      const { checkRateLimit } = await import('@/lib/rate-limit');
      vi.mocked(checkRateLimit).mockReturnValueOnce({
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + 30000,
      });

      const res = await POST(makeRequest({ text: 'content' }));
      expect(res.status).toBe(429);
    });
  });
});
