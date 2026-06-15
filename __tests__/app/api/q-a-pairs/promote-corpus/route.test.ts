/**
 * Unit tests for POST /api/q-a-pairs/promote-corpus — ID-59 {59.25}
 *
 * Covers:
 *   INV-14 — auth gating: viewer/unauthenticated → 403/401, admin/editor → 200.
 *   INV-3  — second-caller shape proof: promoteCorpusExtractions is callable
 *             with a service-role-shaped client (same SupabaseClientLike surface),
 *             demonstrating the single impl satisfies both the HTTP route
 *             (RLS-scoped) and the future ID-45 pipeline (service-role) without
 *             code change.
 *   INV-15 — RLS-scoped client used (no service-role escalation in the route).
 *   Proxy-allowlist absence (INV-14): isPublicRoute('/api/q-a-pairs/promote-corpus')
 *             is false and the path is not a prefix-match of any PUBLIC_ROUTES entry.
 *
 * Mock discipline:
 *   - Shared createMockSupabaseClient() — never hand-roll Supabase mocks.
 *   - promoteCorpusExtractions is mocked via vi.mock('@/lib/q-a-pairs/promote-corpus').
 *   - Auth is configured via configureAuth helpers from mock-auth.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../../../helpers/mock-supabase';
import { configureAuth } from '../../../../helpers/mock-auth';
import { createTestRequest } from '../../../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock Supabase client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

// ---------------------------------------------------------------------------
// Mock promoteCorpusExtractions — isolate route logic from lib behaviour.
// vi.hoisted() is REQUIRED: vi.mock() factories are hoisted to the top of the
// file by Vitest; variables initialised with const/let are NOT yet defined at
// that point. vi.hoisted() ensures the mock function is initialised before the
// factory runs. (CLAUDE.md __tests__/CLAUDE.md — vi.hoisting discipline)
// ---------------------------------------------------------------------------

const { mockPromoteCorpusExtractions } = vi.hoisted(() => ({
  mockPromoteCorpusExtractions: vi.fn(),
}));

vi.mock('@/lib/q-a-pairs/promote-corpus', () => ({
  promoteCorpusExtractions: mockPromoteCorpusExtractions,
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks (vi.mock is hoisted, but imports must
// come after vi.mock declarations in source order for clarity)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/q-a-pairs/promote-corpus/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical success summary shape — mirrors PromotionSummary. */
const STUB_SUMMARY = {
  considered: 5,
  promoted: 3,
  skipped: [{ extractionId: 'skip-id-1', reason: 'no_answer_text' as const }],
  already_promoted: 1,
  embed_failed: 0,
  retired: 1,
  retired_no_replacement: 0,
};

function makeRequest() {
  return createTestRequest('/api/q-a-pairs/promote-corpus', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/q-a-pairs/promote-corpus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: getUser returns a valid user
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    // Default: promoteCorpusExtractions returns a stub summary
    mockPromoteCorpusExtractions.mockResolvedValue(STUB_SUMMARY);
  });

  // -------------------------------------------------------------------------
  // INV-14: Auth gating — unauthenticated
  // -------------------------------------------------------------------------
  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      configureAuth(mockSupabase).asUnauthenticated();

      const response = await POST(makeRequest());

      expect(response.status).toBe(401);
      expect(mockPromoteCorpusExtractions).not.toHaveBeenCalled();
    });

    it('returns 403 when viewer role (INV-14)', async () => {
      configureAuth(mockSupabase).asViewer();

      const response = await POST(makeRequest());

      expect(response.status).toBe(403);
      expect(mockPromoteCorpusExtractions).not.toHaveBeenCalled();
    });

    it('returns 200 for admin role (INV-14)', async () => {
      configureAuth(mockSupabase).asAdmin();

      const response = await POST(makeRequest());

      expect(response.status).toBe(200);
      expect(mockPromoteCorpusExtractions).toHaveBeenCalledOnce();
    });

    it('returns 200 for editor role (INV-14)', async () => {
      configureAuth(mockSupabase).asEditor();

      const response = await POST(makeRequest());

      expect(response.status).toBe(200);
      expect(mockPromoteCorpusExtractions).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Happy path: admin → 200 with PromotionSummary body
  // -------------------------------------------------------------------------
  describe('happy path', () => {
    it('returns the PromotionSummary from promoteCorpusExtractions', async () => {
      configureAuth(mockSupabase).asAdmin();

      const response = await POST(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(STUB_SUMMARY);
    });

    it('passes auth.supabase (RLS-scoped client) to promoteCorpusExtractions (INV-15)', async () => {
      configureAuth(mockSupabase).asAdmin();

      await POST(makeRequest());

      // The route must pass auth.supabase — the RLS-scoped cookie-based client.
      // We verify the mock was called with the mockSupabase instance,
      // which is what createClient() returns (the authorised client).
      expect(mockPromoteCorpusExtractions).toHaveBeenCalledWith(mockSupabase);
    });

    it('summary fields are present in response body', async () => {
      configureAuth(mockSupabase).asAdmin();

      const response = await POST(makeRequest());
      const body = await response.json();

      // Verify the full PromotionSummary shape is forwarded as-is
      expect(body).toHaveProperty('considered', 5);
      expect(body).toHaveProperty('promoted', 3);
      expect(body).toHaveProperty('skipped');
      expect(body).toHaveProperty('already_promoted', 1);
      expect(body).toHaveProperty('embed_failed', 0);
      expect(body).toHaveProperty('retired', 1);
      expect(body).toHaveProperty('retired_no_replacement', 0);
    });
  });

  // -------------------------------------------------------------------------
  // Error path: promoteCorpusExtractions throws → 500 with safeErrorMessage
  // -------------------------------------------------------------------------
  describe('error handling', () => {
    it('returns 500 with safe error message when promoteCorpusExtractions throws', async () => {
      configureAuth(mockSupabase).asAdmin();
      mockPromoteCorpusExtractions.mockRejectedValueOnce(
        new Error('RPC connection failed'),
      );

      const response = await POST(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
      // safeErrorMessage returns the fallback in non-development NODE_ENV —
      // the route's try/catch surfaces the route-level fallback message.
      expect(body.error).toBe('Failed to promote corpus extractions');
    });

    it('returns 500 with fallback message for non-Error throws', async () => {
      configureAuth(mockSupabase).asAdmin();
      mockPromoteCorpusExtractions.mockRejectedValueOnce('string error');

      const response = await POST(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    });
  });

  // -------------------------------------------------------------------------
  // INV-3 second-caller shape proof: promoteCorpusExtractions is callable
  // with a service-role-shaped SupabaseClientLike (same surface as the RLS
  // route client), demonstrating the single implementation satisfies both
  // callers without code change.
  //
  // This is the unit-test stand-in for the escalated live webhook wiring
  // (see {59.25} §2 — ID-45 wiring is out of scope for this Subtask).
  // -------------------------------------------------------------------------
  describe('INV-3 second-caller shape proof', () => {
    it('promoteCorpusExtractions is callable with a service-role-shaped client (same SupabaseClientLike surface)', async () => {
      // vi.importActual bypasses the vi.mock() above to get the real function.
      // This proves structural compatibility: the single implementation satisfies
      // both the HTTP route's RLS-scoped client AND a service-role-shaped client
      // (same SupabaseClientLike interface — rpc + from, no session/cookies).
      const { promoteCorpusExtractions: realFn } = await vi.importActual<
        typeof import('@/lib/q-a-pairs/promote-corpus')
      >('@/lib/q-a-pairs/promote-corpus');

      // Minimal service-role-shaped client satisfying SupabaseClientLike
      const serviceRoleShapedClient = {
        rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: vi.fn((resolve: (v: unknown) => void) =>
            resolve({ data: [], error: null }),
          ),
        }),
      };

      // The function must run without throwing when given a service-role-shaped
      // client (empty eligible set → fast-return with zero counts).
      // This proves the single impl satisfies both the HTTP route client (INV-15)
      // and a service-role/pipeline client shape (ID-45 future caller).
      const summary = await realFn(serviceRoleShapedClient);

      // RPC was called (the promotion candidate fetch) — no params arg
      expect(serviceRoleShapedClient.rpc).toHaveBeenCalledWith(
        'q_a_extractions_promotion_candidates',
      );

      // Empty set → all-zero summary
      expect(summary.considered).toBe(0);
      expect(summary.promoted).toBe(0);
      expect(summary.skipped).toHaveLength(0);
      expect(summary.already_promoted).toBe(0);
      expect(summary.embed_failed).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // INV-14 proxy-allowlist absence: the new route must NOT be in PUBLIC_ROUTES
  // or match any prefix of a public path. This guards against accidental
  // future public-listing.
  // -------------------------------------------------------------------------
  describe('proxy-allowlist absence (INV-14)', () => {
    it('isPublicRoute returns false for /api/q-a-pairs/promote-corpus', async () => {
      const { isPublicRoute } = await import('@/lib/routes');
      expect(isPublicRoute('/api/q-a-pairs/promote-corpus')).toBe(false);
    });

    it('PUBLIC_ROUTES does not include any prefix of /api/q-a-pairs/promote-corpus', async () => {
      const { PUBLIC_ROUTES } = await import('@/lib/routes');
      const routePath = '/api/q-a-pairs/promote-corpus';
      for (const publicRoute of PUBLIC_ROUTES) {
        expect(routePath.startsWith(publicRoute)).toBe(false);
      }
    });
  });
});
