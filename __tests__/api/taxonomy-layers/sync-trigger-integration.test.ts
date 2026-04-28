/**
 * Integration tests verifying that `enqueueTaxonomySync()` is called
 * after successful mutations in all 9 taxonomy/layer admin API routes.
 *
 * P0-TX WP6: 10 insertion points across 8 files
 * Spec: docs/specs/p0-tx-taxonomy-sync-spec.md §5.1
 * Verifier F-1: DELETE /api/layers/:id included
 *
 * These tests mock the taxonomy sync trigger and Supabase client, then
 * verify that each successful mutation fires `enqueueTaxonomySync()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Mock sync trigger — must be declared before route imports
// ---------------------------------------------------------------------------

const mockEnqueueTaxonomySync = vi.fn();

vi.mock('@/lib/taxonomy/sync-trigger', () => ({
  enqueueTaxonomySync: (...args: unknown[]) => mockEnqueueTaxonomySync(...args),
  computeTaxonomyHash: vi.fn().mockReturnValue('mock-hash'),
}));

// ---------------------------------------------------------------------------
// Mock Supabase + Next.js headers
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { POST as domainsPOST } from '@/app/api/taxonomy/domains/route';
import { PATCH as domainPATCH } from '@/app/api/taxonomy/domains/[id]/route';
import { POST as subtopicsPOST } from '@/app/api/taxonomy/subtopics/route';
import { PATCH as subtopicPATCH } from '@/app/api/taxonomy/subtopics/[id]/route';
import { POST as taxonomyReorderPOST } from '@/app/api/taxonomy/reorder/route';
import { POST as layerPOST } from '@/app/api/layers/route';
import {
  PATCH as layerPATCH,
  DELETE as layerDELETE,
} from '@/app/api/layers/[id]/route';
import { PUT as layerReorderPUT } from '@/app/api/layers/reorder/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const VALID_UUID_2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

// ---------------------------------------------------------------------------
// Helpers — match the patterns from layers.test.ts and taxonomy.test.ts
// ---------------------------------------------------------------------------

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Re-establish chainable returns
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

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetMocks();
});

// ---------------------------------------------------------------------------
// Tests — one per insertion point
// ---------------------------------------------------------------------------

describe('enqueueTaxonomySync wiring across 9 routes', () => {
  // ---- 1. POST /api/taxonomy/domains ----

  describe('POST /api/taxonomy/domains', () => {
    it('calls enqueueTaxonomySync after successful domain creation', async () => {
      configureRole(mockSupabase, 'admin');

      // sb() maybeSingle for auto-order lookup
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 10 },
        error: null,
      });

      // insert().select().single() succeeds
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          name: 'New Domain',
          display_order: 20,
          colour: null,
          is_active: true,
          provenance: 'client',
        },
        error: null,
      });

      const req = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'New Domain' },
      });

      const res = await domainsPOST(req);
      expect(res.status).toBe(201);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 2. PATCH /api/taxonomy/domains/:id ----

  describe('PATCH /api/taxonomy/domains/:id', () => {
    it('calls enqueueTaxonomySync after successful domain update', async () => {
      configureRole(mockSupabase, 'admin');

      // update().eq().select().single() succeeds
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          name: 'Updated Domain',
          display_order: 10,
          colour: '#ff0000',
          is_active: true,
        },
        error: null,
      });

      const req = createTestRequest(`/api/taxonomy/domains/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Updated Domain' },
      });

      const res = await domainPATCH(req, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(res.status).toBe(200);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 3. POST /api/taxonomy/subtopics ----

  describe('POST /api/taxonomy/subtopics', () => {
    it('calls enqueueTaxonomySync after successful subtopic creation', async () => {
      configureRole(mockSupabase, 'admin');

      // Domain existence check: .single()
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { id: VALID_UUID },
        error: null,
      });

      // sb() maybeSingle for auto-order
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 10 },
        error: null,
      });

      // insert().select().single() succeeds
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID_2,
          domain_id: VALID_UUID,
          name: 'New Subtopic',
          display_order: 20,
          is_active: true,
          provenance: 'client',
        },
        error: null,
      });

      const req = createTestRequest('/api/taxonomy/subtopics', {
        method: 'POST',
        body: { domain_id: VALID_UUID, name: 'New Subtopic' },
      });

      const res = await subtopicsPOST(req);
      expect(res.status).toBe(201);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 4. PATCH /api/taxonomy/subtopics/:id ----

  describe('PATCH /api/taxonomy/subtopics/:id', () => {
    it('calls enqueueTaxonomySync after successful subtopic update', async () => {
      configureRole(mockSupabase, 'admin');

      // update().eq().select().single() succeeds
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          domain_id: VALID_UUID_2,
          name: 'Updated Subtopic',
          display_order: 10,
          is_active: true,
        },
        error: null,
      });

      const req = createTestRequest(`/api/taxonomy/subtopics/${VALID_UUID}`, {
        method: 'PATCH',
        body: { name: 'Updated Subtopic' },
      });

      const res = await subtopicPATCH(req, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(res.status).toBe(200);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 5. POST /api/taxonomy/reorder ----

  describe('POST /api/taxonomy/reorder', () => {
    it('calls enqueueTaxonomySync after successful reorder', async () => {
      configureRole(mockSupabase, 'admin');

      // Individual .update().eq() calls resolve via chain.then
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      const req = createTestRequest('/api/taxonomy/reorder', {
        method: 'POST',
        body: {
          type: 'domain',
          items: [
            { id: VALID_UUID, display_order: 10 },
            { id: VALID_UUID_2, display_order: 20 },
          ],
        },
      });

      const res = await taxonomyReorderPOST(req);
      expect(res.status).toBe(200);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 6. POST /api/layers ----

  describe('POST /api/layers', () => {
    it('calls enqueueTaxonomySync after successful layer creation', async () => {
      configureRole(mockSupabase, 'admin');

      // sb() maybeSingle for auto-order
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 10 },
        error: null,
      });

      // insert().select().single() succeeds
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          key: 'test_layer',
          label: 'Test Layer',
          description: null,
          display_order: 20,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      });

      const req = createTestRequest('/api/layers', {
        method: 'POST',
        body: { key: 'test_layer', label: 'Test Layer' },
      });

      const res = await layerPOST(req);
      expect(res.status).toBe(201);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 7. PATCH /api/layers/:id ----

  describe('PATCH /api/layers/:id', () => {
    it('calls enqueueTaxonomySync after successful layer update', async () => {
      configureRole(mockSupabase, 'admin');

      // update().eq().select().single() succeeds
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: VALID_UUID,
          key: 'test_layer',
          label: 'Updated Layer',
          description: null,
          display_order: 10,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      });

      const req = createTestRequest(`/api/layers/${VALID_UUID}`, {
        method: 'PATCH',
        body: { label: 'Updated Layer' },
      });

      const res = await layerPATCH(req, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(res.status).toBe(200);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 8. DELETE /api/layers/:id (verifier F-1) ----

  describe('DELETE /api/layers/:id (verifier F-1)', () => {
    it('calls enqueueTaxonomySync after successful layer deletion', async () => {
      configureRole(mockSupabase, 'admin');

      // Layer lookup (key fetch): .single()
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: { key: 'test_layer' },
        error: null,
      });

      // Content items count check: .select('id', { count, head }).eq(...)
      // Resolves via .then
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) =>
          resolve({ count: 0, data: null, error: null }),
      );

      // Delete: .delete().eq() resolves via .then
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      const req = createTestRequest(`/api/layers/${VALID_UUID}`, {
        method: 'DELETE',
      });

      const res = await layerDELETE(req, {
        params: createTestParams({ id: VALID_UUID }),
      });
      expect(res.status).toBe(204);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 9. PUT /api/layers/reorder ----

  describe('PUT /api/layers/reorder', () => {
    it('calls enqueueTaxonomySync after successful layer reorder', async () => {
      configureRole(mockSupabase, 'admin');

      // Promise.all updates — each .update().eq() resolves via .then
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      );

      const req = createTestRequest('/api/layers/reorder', {
        method: 'PUT',
        body: {
          layers: [
            { id: VALID_UUID, display_order: 10 },
            { id: VALID_UUID_2, display_order: 20 },
          ],
        },
      });

      const res = await layerReorderPUT(req);
      expect(res.status).toBe(200);
      expect(mockEnqueueTaxonomySync).toHaveBeenCalledTimes(1);
    });
  });

  // ---- Negative case: sync NOT called on failure ----

  describe('error paths do not trigger sync', () => {
    it('does not call enqueueTaxonomySync when domain creation fails with conflict', async () => {
      configureRole(mockSupabase, 'admin');

      // sb() maybeSingle for auto-order
      mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
        data: { display_order: 10 },
        error: null,
      });

      // insert().select().single() fails with unique violation
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key' },
      });

      const req = createTestRequest('/api/taxonomy/domains', {
        method: 'POST',
        body: { name: 'Duplicate Domain' },
      });

      const res = await domainsPOST(req);
      expect(res.status).toBe(409);
      expect(mockEnqueueTaxonomySync).not.toHaveBeenCalled();
    });
  });
});
