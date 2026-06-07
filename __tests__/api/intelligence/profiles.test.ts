/**
 * API route tests for intelligence company profile CRUD endpoints.
 *
 * Routes tested:
 *   GET    /api/intelligence/profiles       — list active profiles
 *   POST   /api/intelligence/profiles       — create a profile
 *   GET    /api/intelligence/profiles/:id   — get single profile
 *   PATCH  /api/intelligence/profiles/:id   — update a profile
 *   DELETE /api/intelligence/profiles/:id   — soft-delete (admin only)
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
} from '@/app/api/intelligence/profiles/route';
import {
  GET as detailGET,
  PATCH as detailPATCH,
  DELETE as detailDELETE,
} from '@/app/api/intelligence/profiles/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const VALID_PROFILE_INPUT = {
  name: 'Example Client',
  slug: 'example-client',
  sectors: ['education', 'safeguarding'],
  key_topics: ['KCSIE', 'MAT governance'],
};

const MOCK_PROFILE = {
  id: VALID_UUID,
  name: 'Example Client',
  slug: 'example-client',
  description: null,
  website_url: null,
  sectors: ['education', 'safeguarding'],
  services: [],
  certifications: [],
  geographic_scope: [],
  competitors: [],
  target_customers: null,
  value_proposition: null,
  key_topics: ['KCSIE', 'MAT governance'],
  is_active: true,
  created_by: 'test-user-id',
  created_at: '2025-01-01T00:00:00Z',
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

describe('Intelligence Profiles API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // ─── GET /api/intelligence/profiles ───

  describe('GET /api/intelligence/profiles', () => {
    it('returns profiles list for admin', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_PROFILE], error: null }),
      );

      const response = await listGET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Example Client');
    });

    it('returns profiles list for editor', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [MOCK_PROFILE], error: null }),
      );

      const response = await listGET();
      expect(response.status).toBe(200);
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

  // ─── POST /api/intelligence/profiles ───

  describe('POST /api/intelligence/profiles', () => {
    it('creates profile with valid data', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_PROFILE,
        error: null,
      });

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: VALID_PROFILE_INPUT,
      });

      const response = await listPOST(request);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.name).toBe('Example Client');
    });

    it('rejects missing required fields', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: { name: 'Test' }, // missing slug, sectors, key_topics
      });

      const response = await listPOST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
    });

    it('rejects empty sectors array', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: { ...VALID_PROFILE_INPUT, sectors: [] },
      });

      const response = await listPOST(request);
      expect(response.status).toBe(400);
    });

    it('rejects empty key_topics array', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: { ...VALID_PROFILE_INPUT, key_topics: [] },
      });

      const response = await listPOST(request);
      expect(response.status).toBe(400);
    });

    it('rejects invalid slug format', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: { ...VALID_PROFILE_INPUT, slug: 'Invalid Slug!' },
      });

      const response = await listPOST(request);
      expect(response.status).toBe(400);
    });

    it('returns 409 on duplicate slug', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'unique_violation' },
      });

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: VALID_PROFILE_INPUT,
      });

      const response = await listPOST(request);
      expect(response.status).toBe(409);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/intelligence/profiles', {
        method: 'POST',
        body: VALID_PROFILE_INPUT,
      });

      const response = await listPOST(request);
      expect(response.status).toBe(401);
    });
  });

  // ─── GET /api/intelligence/profiles/:id ───

  describe('GET /api/intelligence/profiles/:id', () => {
    it('returns a single profile', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: MOCK_PROFILE,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailGET(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.name).toBe('Example Client');
    });

    it('returns 404 for non-existent profile', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'not found' },
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailGET(request, { params });

      expect(response.status).toBe(404);
    });
  });

  // ─── PATCH /api/intelligence/profiles/:id ───

  describe('PATCH /api/intelligence/profiles/:id', () => {
    it('updates profile with valid data', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_PROFILE, name: 'Updated Name' },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
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

    it('returns 409 on duplicate slug during update', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'unique_violation' },
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
        {
          method: 'PATCH',
          body: { slug: 'existing-slug' },
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailPATCH(request, { params });

      expect(response.status).toBe(409);
    });

    it('returns 404 for non-existent profile', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
        {
          method: 'PATCH',
          body: { name: 'New Name' },
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailPATCH(request, { params });

      expect(response.status).toBe(404);
    });
  });

  // ─── DELETE /api/intelligence/profiles/:id ───

  describe('DELETE /api/intelligence/profiles/:id', () => {
    it('soft-deletes profile for admin', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { ...MOCK_PROFILE, is_active: false },
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
        {
          method: 'DELETE',
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailDELETE(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 403 for editor role (admin only)', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
        {
          method: 'DELETE',
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailDELETE(request, { params });

      expect(response.status).toBe(403);
    });

    it('returns 404 for non-existent profile', async () => {
      configureRole(mockSupabase, 'admin');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
        {
          method: 'DELETE',
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailDELETE(request, { params });

      expect(response.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/intelligence/profiles/${VALID_UUID}`,
        {
          method: 'DELETE',
        },
      );
      const params = createTestParams({ id: VALID_UUID });
      const response = await detailDELETE(request, { params });

      expect(response.status).toBe(401);
    });
  });
});
