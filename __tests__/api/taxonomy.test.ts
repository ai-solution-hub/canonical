/**
 * API route integration tests for taxonomy CRUD endpoints.
 *
 * All taxonomy routes require admin role via getAuthorisedClient(['admin']).
 * When unauthenticated, returns 401. When wrong role, returns 403.
 *
 * Routes tested:
 *   GET  /api/taxonomy/domains       — list all domains with subtopic counts
 *   POST /api/taxonomy/domains       — create a domain
 *   PATCH /api/taxonomy/domains/:id  — update a domain
 *   POST /api/taxonomy/subtopics     — create a subtopic
 *   POST /api/taxonomy/reorder       — batch reorder domains or subtopics
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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
// Import route handlers AFTER mocks are declared
// ---------------------------------------------------------------------------

import {
  GET as domainsGET,
  POST as domainsPOST,
} from '@/app/api/taxonomy/domains/route';
import { PATCH as domainPATCH } from '@/app/api/taxonomy/domains/[id]/route';
import { POST as subtopicsPOST } from '@/app/api/taxonomy/subtopics/route';
import { POST as reorderPOST } from '@/app/api/taxonomy/reorder/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// UUIDs must be properly formatted v4 to pass Zod uuid() validation
const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const VALID_UUID_2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const WRONG_DOMAIN_UUID = 'b8d3e9a1-7c4f-4b2e-9a1d-3e5f7b8c9d0a';

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

describe('Taxonomy API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // =========================================================================
  // GET /api/taxonomy/domains
  // =========================================================================

  describe('GET /api/taxonomy/domains', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const response = await domainsGET();
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error).toBe('Unauthorised');
    });

    it('returns 403 for non-admin (editor)', async () => {
      configureRole(mockSupabase, 'editor');

      const response = await domainsGET();
      expect(response.status).toBe(403);
    });

    it('returns 403 for non-admin (viewer)', async () => {
      configureRole(mockSupabase, 'viewer');

      const response = await domainsGET();
      expect(response.status).toBe(403);
    });

    it('returns 200 with domains array for admin', async () => {
      configureRole(mockSupabase, 'admin');

      // Configure the chain to return domains when awaited
      const mockDomains = [
        {
          id: VALID_UUID,
          name: 'Engineering',
          display_order: 10,
          colour: '#3B82F6',
          is_active: true,
          taxonomy_subtopics: [{ count: 5 }],
        },
        {
          id: VALID_UUID_2,
          name: 'Operations',
          display_order: 20,
          colour: '#10B981',
          is_active: true,
          taxonomy_subtopics: [{ count: 3 }],
        },
      ];

      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: mockDomains, error: null, count: 2 }),
      );

      const response = await domainsGET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe('Engineering');
      expect(body[0].subtopic_count).toBe(5);
      expect(body[1].subtopic_count).toBe(3);
      // taxonomy_subtopics should be stripped from the response
      expect(body[0]).not.toHaveProperty('taxonomy_subtopics');
    });

    it('returns 500 when Supabase query fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'DB error' }, count: null }),
      );

      const response = await domainsGET();
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe('Failed to fetch domains');
    });
  });

  // =========================================================================
  // POST /api/taxonomy/domains
  // =========================================================================

  describe('POST /api/taxonomy/domains', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'New Domain' },
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'New Domain' },
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(403);
    });

    it('returns 400 for missing name', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: {},
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toBeDefined();
    });

    it('returns 400 for empty name string', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: '' },
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(400);
    });

    it('returns 201 on successful creation', async () => {
      configureRole(mockSupabase, 'admin');

      const createdDomain = {
        id: VALID_UUID,
        name: 'New Domain',
        display_order: 10,
        colour: '#FF0000',
        is_active: true,
      };

      // First call after role check: auto-assign display_order lookup (.maybeSingle)
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 30 },
        error: null,
      });
      // Second .single() call: the insert result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: createdDomain,
        error: null,
      });

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'New Domain', colour: '#FF0000' },
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.name).toBe('New Domain');
      expect(body.id).toBe(VALID_UUID);
    });

    it('returns 201 with explicit display_order (skips auto-assign)', async () => {
      configureRole(mockSupabase, 'admin');

      const createdDomain = {
        id: VALID_UUID,
        name: 'Ordered Domain',
        display_order: 50,
        colour: null,
        is_active: true,
      };

      // Only one .single() after role check: the insert result
      // (no display_order lookup when display_order is provided)
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: createdDomain,
        error: null,
      });

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'Ordered Domain', display_order: 50 },
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.display_order).toBe(50);
    });

    it('returns 409 for duplicate domain name', async () => {
      configureRole(mockSupabase, 'admin');

      // display_order lookup (.maybeSingle)
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 10 },
        error: null,
      });
      // insert fails with unique constraint violation
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });

      const request = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'Engineering' },
      });

      const response = await domainsPOST(request);
      expect(response.status).toBe(409);

      const body = await response.json();
      expect(body.error).toContain('already exists');
    });
  });

  // =========================================================================
  // PATCH /api/taxonomy/domains/:id
  // =========================================================================

  describe('PATCH /api/taxonomy/domains/:id', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Updated' },
      });

      const response = await domainPATCH(request, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Updated' },
      });

      const response = await domainPATCH(request, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(response.status).toBe(403);
    });

    it('returns 400 when no fields to update', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: {},
      });

      const response = await domainPATCH(request, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('No fields to update');
    });

    it('returns 200 on successful update', async () => {
      configureRole(mockSupabase, 'admin');

      const updatedDomain = {
        id: VALID_UUID,
        name: 'Updated Domain',
        display_order: 10,
        colour: '#3B82F6',
        is_active: true,
      };

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: updatedDomain,
        error: null,
      });

      const request = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Updated Domain' },
      });

      const response = await domainPATCH(request, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.name).toBe('Updated Domain');
    });

    it('returns 404 when domain does not exist', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const request = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Ghost' },
      });

      const response = await domainPATCH(request, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe('Domain not found');
    });

    it('returns 409 for duplicate domain name on update', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });

      const request = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Engineering' },
      });

      const response = await domainPATCH(request, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(response.status).toBe(409);

      const body = await response.json();
      expect(body.error).toContain('already exists');
    });
  });

  // =========================================================================
  // POST /api/taxonomy/subtopics
  // =========================================================================

  describe('POST /api/taxonomy/subtopics', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: VALID_UUID, name: 'New Subtopic' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: VALID_UUID, name: 'New Subtopic' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(403);
    });

    it('returns 400 for missing required fields', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { name: 'Orphan Subtopic' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 for invalid domain_id format', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: 'not-a-uuid', name: 'Bad Subtopic' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 when domain does not exist', async () => {
      configureRole(mockSupabase, 'admin');

      // Domain lookup returns no result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST116', message: 'No rows found' },
      });

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: VALID_UUID, name: 'Orphan Subtopic' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Domain not found');
    });

    it('returns 201 on successful creation', async () => {
      configureRole(mockSupabase, 'admin');

      const createdSubtopic = {
        id: VALID_UUID_2,
        domain_id: VALID_UUID,
        name: 'Cloud Infrastructure',
        display_order: 10,
        is_active: true,
      };

      // Domain existence check
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });
      // display_order auto-assign lookup (.maybeSingle)
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 20 },
        error: null,
      });
      // Insert result
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: createdSubtopic,
        error: null,
      });

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: VALID_UUID, name: 'Cloud Infrastructure' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.name).toBe('Cloud Infrastructure');
      expect(body.domain_id).toBe(VALID_UUID);
    });

    it('returns 409 for duplicate subtopic name in same domain', async () => {
      configureRole(mockSupabase, 'admin');

      // Domain existence check
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });
      // display_order lookup (.maybeSingle)
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 10 },
        error: null,
      });
      // Insert fails with unique constraint violation
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });

      const request = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: VALID_UUID, name: 'Existing Subtopic' },
      });

      const response = await subtopicsPOST(request);
      expect(response.status).toBe(409);

      const body = await response.json();
      expect(body.error).toContain('already exists');
    });
  });

  // =========================================================================
  // POST /api/taxonomy/reorder
  // =========================================================================

  describe('POST /api/taxonomy/reorder', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'domain',
          items: [{ id: VALID_UUID, display_order: 10 }],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(401);
    });

    it('returns 403 for non-admin', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'domain',
          items: [{ id: VALID_UUID, display_order: 10 }],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(403);
    });

    it('returns 400 for invalid body (missing type)', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          items: [{ id: VALID_UUID, display_order: 10 }],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 for empty items array', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'domain',
          items: [],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 when subtopic reorder is missing domain_id', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'subtopic',
          items: [{ id: VALID_UUID, display_order: 10 }],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'domain_id',
            message: expect.stringContaining('domain_id is required'),
          }),
        ]),
      );
    });

    it('returns 200 on successful domain reorder', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'domain',
          items: [
            { id: VALID_UUID, display_order: 20 },
            { id: VALID_UUID_2, display_order: 10 },
          ],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.updated).toBe(2);
    });

    it('returns 200 on successful subtopic reorder', async () => {
      configureRole(mockSupabase, 'admin');

      // Subtopic ownership validation: return matching subtopics
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              { id: VALID_UUID, domain_id: VALID_UUID },
              { id: VALID_UUID_2, domain_id: VALID_UUID },
            ],
            error: null,
            count: 2,
          }),
      );

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'subtopic',
          domain_id: VALID_UUID,
          items: [
            { id: VALID_UUID, display_order: 20 },
            { id: VALID_UUID_2, display_order: 10 },
          ],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.updated).toBe(2);
    });

    it('returns 400 when subtopics do not belong to specified domain', async () => {
      configureRole(mockSupabase, 'admin');

      const wrongDomainId = WRONG_DOMAIN_UUID;

      // Subtopic ownership validation: one subtopic belongs to a different domain
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [
              { id: VALID_UUID, domain_id: VALID_UUID },
              { id: VALID_UUID_2, domain_id: wrongDomainId },
            ],
            error: null,
            count: 2,
          }),
      );

      const request = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'subtopic',
          domain_id: VALID_UUID,
          items: [
            { id: VALID_UUID, display_order: 20 },
            { id: VALID_UUID_2, display_order: 10 },
          ],
        },
      });

      const response = await reorderPOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('do not belong');
    });
  });
});
