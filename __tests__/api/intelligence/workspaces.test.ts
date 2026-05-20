/**
 * API route tests for intelligence workspace CRUD endpoints.
 *
 * Routes tested:
 *   GET    /api/intelligence/workspaces       — list intelligence workspaces
 *   POST   /api/intelligence/workspaces       — create workspace with auto-prompt
 *   GET    /api/intelligence/workspaces/:id   — get single workspace
 *   PATCH  /api/intelligence/workspaces/:id   — update workspace
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import {
  GET as listGET,
  POST as listPOST,
} from '@/app/api/intelligence/workspaces/route';
import {
  GET as detailGET,
  PATCH as detailPATCH,
} from '@/app/api/intelligence/workspaces/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PROFILE_UUID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

/**
 * DB-row shape: `domain_metadata` stays JSONB pre-T2. The route handler
 * projects the 3 intelligence-context fields onto typed top-level keys via
 * `extractContextFromDomainMetadata()` — these are what API consumers see.
 * S246 WP2b will swap the helper internals to a satellite JOIN without
 * changing the API response shape.
 */
const MOCK_WORKSPACE = {
  id: VALID_UUID,
  name: 'Education Watch',
  description: 'Monitoring education sector',
  type: 'intelligence',
  colour: '#059669',
  icon: 'globe',
  is_archived: false,
  domain_metadata: { company_profile_id: PROFILE_UUID },
  created_by: 'test-user-id',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const MOCK_PROFILE = {
  id: PROFILE_UUID,
  name: 'example-client Design',
  sectors: ['education'],
  services: ['curriculum design'],
  key_topics: ['KCSIE'],
  is_active: true,
};

const VALID_WORKSPACE_INPUT = {
  name: 'Education Watch',
  description: 'Monitoring education sector',
  company_profile_id: PROFILE_UUID,
};

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Intelligence Workspaces API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // ─── GET /api/intelligence/workspaces ───

  describe('GET /api/intelligence/workspaces', () => {
    it('returns workspaces list for admin', async () => {
      configureRole(mockSupabase, 'admin');
      // Workspace query
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_WORKSPACE], error: null }),
      );
      // Profile query
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: PROFILE_UUID, name: 'example-client Design' }],
            error: null,
          }),
      );
      // Source counts query
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );
      // Article counts query
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );

      const response = await listGET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Education Watch');
      expect(body[0].company_profile_name).toBe('example-client Design');
    });

    it('returns empty array when no workspaces', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );

      const response = await listGET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual([]);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const response = await listGET();
      expect(response.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const response = await listGET();
      expect(response.status).toBe(403);
    });
  });

  // ─── POST /api/intelligence/workspaces ───

  describe('POST /api/intelligence/workspaces', () => {
    it('creates workspace with valid data and includes guide fields', async () => {
      configureRole(mockSupabase, 'admin');
      // Profile lookup
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_PROFILE,
        error: null,
      });
      // Workspace insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Feed prompt insert (returns via then)
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [{ id: 'prompt-1' }], error: null }),
      );
      // Guide insert (.single() for guide creation)
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: 'guide-id-123' },
        error: null,
      });
      // Guide sections insert (returns via then)
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );
      // Workspace domain_metadata update (returns via then)
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      const request = createTestRequest('/api/intelligence/workspaces', {
        method: 'POST',
        body: VALID_WORKSPACE_INPUT,
      });

      const response = await listPOST(request);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.name).toBe('Education Watch');
      expect(body).toHaveProperty('guide_created');
      expect(body).toHaveProperty('guide_id');
      expect(body.guide_created).toBe(true);
      expect(body.guide_id).toBe('guide-id-123');
    });

    it('returns guide_created false when guide creation fails', async () => {
      configureRole(mockSupabase, 'admin');
      // Profile lookup
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_PROFILE,
        error: null,
      });
      // Workspace insert
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Feed prompt insert (returns via then)
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [{ id: 'prompt-1' }], error: null }),
      );
      // Guide insert fails (first attempt)
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'guide insert failed' },
      });
      // Guide insert fails (retry attempt)
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'guide insert failed again' },
      });

      const request = createTestRequest('/api/intelligence/workspaces', {
        method: 'POST',
        body: VALID_WORKSPACE_INPUT,
      });

      const response = await listPOST(request);
      const body = await response.json();

      // Workspace creation still succeeds
      expect(response.status).toBe(201);
      expect(body.name).toBe('Education Watch');
      expect(body.guide_created).toBe(false);
      expect(body.guide_id).toBeNull();
    });

    it('rejects missing company_profile_id', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/intelligence/workspaces', {
        method: 'POST',
        body: { name: 'Test Workspace' },
      });

      const response = await listPOST(request);
      expect(response.status).toBe(400);
    });

    it('rejects invalid UUID for company_profile_id', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/intelligence/workspaces', {
        method: 'POST',
        body: { name: 'Test', company_profile_id: 'not-a-uuid' },
      });

      const response = await listPOST(request);
      expect(response.status).toBe(400);
    });

    it('returns 404 when profile not found', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const request = createTestRequest('/api/intelligence/workspaces', {
        method: 'POST',
        body: VALID_WORKSPACE_INPUT,
      });

      const response = await listPOST(request);
      expect(response.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/intelligence/workspaces', {
        method: 'POST',
        body: VALID_WORKSPACE_INPUT,
      });

      const response = await listPOST(request);
      expect(response.status).toBe(401);
    });
  });

  // ─── GET /api/intelligence/workspaces/:id ───

  describe('GET /api/intelligence/workspaces/:id', () => {
    it('returns a single workspace with profile name', async () => {
      configureRole(mockSupabase, 'admin');
      // Workspace query
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_WORKSPACE,
        error: null,
      });
      // Profile name query (now uses maybeSingle())
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { name: 'example-client Design' },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${VALID_UUID}`,
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Education Watch');
      expect(body.company_profile_name).toBe('example-client Design');
    });

    it('returns 404 for non-existent workspace', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${VALID_UUID}`,
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailGET(request, { params });

      expect(response.status).toBe(404);
    });
  });

  // ─── PATCH /api/intelligence/workspaces/:id ───

  describe('PATCH /api/intelligence/workspaces/:id', () => {
    it('updates workspace name', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_WORKSPACE, name: 'Updated Name' },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${VALID_UUID}`,
        {
          method: 'PATCH',
          body: { name: 'Updated Name' },
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailPATCH(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Updated Name');
    });

    it('returns 400 with no fields to update', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(
        `/api/intelligence/workspaces/${VALID_UUID}`,
        {
          method: 'PATCH',
          body: {},
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailPATCH(request, { params });

      expect(response.status).toBe(400);
    });

    it('returns 404 for non-existent workspace', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/workspaces/${VALID_UUID}`,
        {
          method: 'PATCH',
          body: { name: 'Updated' },
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailPATCH(request, { params });

      expect(response.status).toBe(404);
    });

    // ─── SI-L5: relevance_threshold write-path ───

    describe('SI-L5 relevance_threshold', () => {
      it('admin can update relevance_threshold (merges into domain_metadata)', async () => {
        configureRole(mockSupabase, 'admin');

        // 1. Initial fetch of existing workspace (for domain_metadata merge)
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: {
            domain_metadata: {
              company_profile_id: PROFILE_UUID,
              guide_id: 'guide-123',
            },
          },
          error: null,
        });

        // 2. Final updated workspace returned
        const updatedWorkspace = {
          ...MOCK_WORKSPACE,
          domain_metadata: {
            company_profile_id: PROFILE_UUID,
            guide_id: 'guide-123',
            relevance_threshold: 0.7,
          },
        };
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: updatedWorkspace,
          error: null,
        });

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { relevance_threshold: 0.7 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        // S245 WP2a API contract: typed top-level fields.
        expect(body.relevance_threshold).toBe(0.7);
        // Confirms the existing context fields are also surfaced typed-top-level
        // (the helper preserves company_profile_id + guide_id during the
        // JSONB → typed projection).
        expect(body.company_profile_id).toBe(PROFILE_UUID);
        expect(body.guide_id).toBe('guide-123');

        // Verify update was called with the merged metadata payload.
        // The DB write still goes to `domain_metadata` JSONB pre-T2;
        // S246 WP2b swaps this to a direct typed-column UPDATE.
        expect(mockSupabase._chain.update).toHaveBeenCalledWith(
          expect.objectContaining({
            domain_metadata: {
              company_profile_id: PROFILE_UUID,
              guide_id: 'guide-123',
              relevance_threshold: 0.7,
            },
          }),
        );
      });

      it('editor cannot change relevance_threshold (returns 403)', async () => {
        configureRole(mockSupabase, 'editor');

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { relevance_threshold: 0.6 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.error).toMatch(/admin/i);
        // Update should never be issued
        expect(mockSupabase._chain.update).not.toHaveBeenCalled();
      });

      it('rejects relevance_threshold below 0.1', async () => {
        configureRole(mockSupabase, 'admin');

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { relevance_threshold: 0.05 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });

        expect(response.status).toBe(400);
      });

      it('rejects relevance_threshold above 1.0', async () => {
        configureRole(mockSupabase, 'admin');

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { relevance_threshold: 1.5 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });

        expect(response.status).toBe(400);
      });

      it('returns 404 if workspace not found during merge fetch', async () => {
        configureRole(mockSupabase, 'admin');

        // Initial fetch returns nothing
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: null,
          error: { message: 'not found' },
        });

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { relevance_threshold: 0.6 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });

        expect(response.status).toBe(404);
      });

      it('admin can update name and threshold together', async () => {
        configureRole(mockSupabase, 'admin');

        mockSupabase._chain.single.mockResolvedValueOnce({
          data: {
            domain_metadata: { company_profile_id: PROFILE_UUID },
          },
          error: null,
        });
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: {
            ...MOCK_WORKSPACE,
            name: 'Combined',
            domain_metadata: {
              company_profile_id: PROFILE_UUID,
              relevance_threshold: 0.65,
            },
          },
          error: null,
        });

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { name: 'Combined', relevance_threshold: 0.65 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.name).toBe('Combined');
        // S245 WP2a API contract: typed top-level field.
        expect(body.relevance_threshold).toBe(0.65);
        expect(body.company_profile_id).toBe(PROFILE_UUID);
        // DB-side write still targets JSONB pre-T2.
        expect(mockSupabase._chain.update).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Combined',
            domain_metadata: {
              company_profile_id: PROFILE_UUID,
              relevance_threshold: 0.65,
            },
          }),
        );
      });

      it('handles missing existing domain_metadata gracefully', async () => {
        configureRole(mockSupabase, 'admin');

        // Initial fetch returns workspace with null metadata
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: { domain_metadata: null },
          error: null,
        });
        mockSupabase._chain.single.mockResolvedValueOnce({
          data: {
            ...MOCK_WORKSPACE,
            domain_metadata: { relevance_threshold: 0.4 },
          },
          error: null,
        });

        const request = createTestRequest(
          `/api/intelligence/workspaces/${VALID_UUID}`,
          {
            method: 'PATCH',
            body: { relevance_threshold: 0.4 },
          },
        );
        const params = createTestParams({ id: VALID_UUID });
        const response = await detailPATCH(request, { params });

        expect(response.status).toBe(200);
        expect(mockSupabase._chain.update).toHaveBeenCalledWith(
          expect.objectContaining({
            domain_metadata: { relevance_threshold: 0.4 },
          }),
        );
      });
    });
  });
});
