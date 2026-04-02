/**
 * Tags API — Sprint C/D: New route tests.
 *
 * Tests the new tag management endpoints:
 *   - GET  /api/tags/duplicates   — duplicate tag groups
 *   - GET  /api/tags/by-domain    — tags grouped by domain
 *   - POST /api/tags/bulk-delete  — bulk delete tags (admin only)
 *   - POST /api/tags/bulk-merge   — bulk merge tags (admin only)
 *   - GET  /api/tags (filtered)   — filtered/paginated tag list
 */
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

// Suppress console.error noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { GET as getDuplicates } from '@/app/api/tags/duplicates/route';
import { GET as getByDomain } from '@/app/api/tags/by-domain/route';
import { POST as bulkDelete } from '@/app/api/tags/bulk-delete/route';
import { POST as bulkMerge } from '@/app/api/tags/bulk-merge/route';
import { GET as getTags } from '@/app/api/tags/route';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tags New API Routes', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // GET /api/tags/duplicates
  // =========================================================================

  describe('GET /api/tags/duplicates', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/tags/duplicates', {
        searchParams: { type: 'ai' },
      });
      const response = await getDuplicates(request);
      expect(response.status).toBe(401);
    });

    it('returns duplicate groups for authenticated user', async () => {
      configureRole(mockSupabase, 'viewer');

      const mockData = [
        {
          canonical: 'audit system',
          variants: ['Audit System', 'Audit system', 'audit system'],
          variant_count: 3,
          total_usage: 15,
        },
      ];
      mockSupabase.rpc.mockResolvedValueOnce({ data: mockData, error: null });

      const request = createTestRequest('/api/tags/duplicates', {
        searchParams: { type: 'ai' },
      });
      const response = await getDuplicates(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual(mockData);
    });

    it('returns 400 for missing type param', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags/duplicates');
      const response = await getDuplicates(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid type param', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags/duplicates', {
        searchParams: { type: 'invalid' },
      });
      const response = await getDuplicates(request);
      expect(response.status).toBe(400);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'RPC error' },
      });

      const request = createTestRequest('/api/tags/duplicates', {
        searchParams: { type: 'ai' },
      });
      const response = await getDuplicates(request);
      expect(response.status).toBe(500);
    });

    it('returns empty array when no duplicates exist', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

      const request = createTestRequest('/api/tags/duplicates', {
        searchParams: { type: 'ai' },
      });
      const response = await getDuplicates(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual([]);
    });
  });

  // =========================================================================
  // GET /api/tags/by-domain
  // =========================================================================

  describe('GET /api/tags/by-domain', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/tags/by-domain', {
        searchParams: { type: 'ai' },
      });
      const response = await getByDomain(request);
      expect(response.status).toBe(401);
    });

    it('returns tags grouped by domain', async () => {
      configureRole(mockSupabase, 'viewer');

      const flatRows = [
        { domain: 'Cyber Security', tag: 'ISO 27001', count: 15 },
        { domain: 'Cyber Security', tag: 'penetration testing', count: 11 },
        { domain: 'Compliance', tag: 'GDPR', count: 12 },
      ];
      mockSupabase.rpc.mockResolvedValueOnce({ data: flatRows, error: null });

      const request = createTestRequest('/api/tags/by-domain', {
        searchParams: { type: 'ai' },
      });
      const response = await getByDomain(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveLength(2);
      expect(body[0].domain).toBe('Cyber Security');
      expect(body[0].tags).toHaveLength(2);
      expect(body[1].domain).toBe('Compliance');
      expect(body[1].tags).toHaveLength(1);
    });

    it('returns 400 for missing type param', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags/by-domain');
      const response = await getByDomain(request);
      expect(response.status).toBe(400);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error' },
      });

      const request = createTestRequest('/api/tags/by-domain', {
        searchParams: { type: 'ai' },
      });
      const response = await getByDomain(request);
      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /api/tags/bulk-delete
  // =========================================================================

  describe('POST /api/tags/bulk-delete', () => {
    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags/bulk-delete', {
        method: 'POST',
        body: { tags: ['tag1', 'tag2'], type: 'ai' },
      });
      const response = await bulkDelete(request);
      expect(response.status).toBe(403);
    });

    it('returns 403 for editor role', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/tags/bulk-delete', {
        method: 'POST',
        body: { tags: ['tag1', 'tag2'], type: 'ai' },
      });
      const response = await bulkDelete(request);
      expect(response.status).toBe(403);
    });

    it('returns 200 with affected count on successful bulk delete', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({ data: 10, error: null });

      const request = createTestRequest('/api/tags/bulk-delete', {
        method: 'POST',
        body: { tags: ['obsolete1', 'obsolete2', 'obsolete3'], type: 'ai' },
      });
      const response = await bulkDelete(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.affected).toBe(10);

      // Verify correct RPC was called
      expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_delete_tags', {
        p_tags: ['obsolete1', 'obsolete2', 'obsolete3'],
        p_type: 'ai',
      });
    });

    it('returns 400 for empty tags array', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/bulk-delete', {
        method: 'POST',
        body: { tags: [], type: 'ai' },
      });
      const response = await bulkDelete(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 for missing type', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/bulk-delete', {
        method: 'POST',
        body: { tags: ['tag1'] },
      });
      const response = await bulkDelete(request);
      expect(response.status).toBe(400);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'bulk_delete_tags failed' },
      });

      const request = createTestRequest('/api/tags/bulk-delete', {
        method: 'POST',
        body: { tags: ['tag1'], type: 'ai' },
      });
      const response = await bulkDelete(request);
      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /api/tags/bulk-merge
  // =========================================================================

  describe('POST /api/tags/bulk-merge', () => {
    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: { sources: ['src1', 'src2'], target: 'canonical', type: 'ai' },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(403);
    });

    it('returns 403 for editor role', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: { sources: ['src1', 'src2'], target: 'canonical', type: 'ai' },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(403);
    });

    it('returns 200 with affected count on successful bulk merge', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({ data: 8, error: null });

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: {
          sources: ['Audit System', 'Audit system'],
          target: 'audit system',
          type: 'ai',
        },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.affected).toBe(8);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('bulk_merge_tags', {
        p_sources: ['Audit System', 'Audit system'],
        p_target: 'audit system',
        p_type: 'ai',
      });
    });

    it('returns 400 when target is in sources', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: {
          sources: ['audit system', 'Audit System'],
          target: 'audit system',
          type: 'ai',
        },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('must not be');
    });

    it('returns 400 for empty sources array', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: { sources: [], target: 'canonical', type: 'ai' },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 for missing target', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: { sources: ['src1'], type: 'ai' },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(400);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'bulk_merge_tags failed' },
      });

      const request = createTestRequest('/api/tags/bulk-merge', {
        method: 'POST',
        body: {
          sources: ['src1'],
          target: 'tgt',
          type: 'ai',
        },
      });
      const response = await bulkMerge(request);
      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // GET /api/tags (with filter params)
  // =========================================================================

  describe('GET /api/tags (filtered)', () => {
    it('returns filtered results with type param', async () => {
      configureRole(mockSupabase, 'viewer');

      const mockData = [
        { tag: 'ISO 27001', count: 15, source: 'ai', total_count: 174 },
        { tag: 'GDPR', count: 12, source: 'ai', total_count: 174 },
      ];
      mockSupabase.rpc.mockResolvedValueOnce({ data: mockData, error: null });

      const request = createTestRequest('/api/tags', {
        searchParams: { type: 'ai', min_count: '2', limit: '50' },
      });
      const response = await getTags(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.tags).toHaveLength(2);
      expect(body.total).toBe(174);
    });

    it('returns combined results without type param but with other filter params', async () => {
      configureRole(mockSupabase, 'viewer');

      const aiData = [
        { tag: 'ISO 27001', count: 15, source: 'ai', total_count: 100 },
      ];
      const userData = [
        { tag: 'custom-tag', count: 3, source: 'user', total_count: 5 },
      ];
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: aiData, error: null })
        .mockResolvedValueOnce({ data: userData, error: null });

      const request = createTestRequest('/api/tags', {
        searchParams: { min_count: '2' },
      });
      const response = await getTags(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.tags).toHaveLength(2);
      expect(body.total).toBe(105);
    });

    it('returns legacy format without any filter params', async () => {
      configureRole(mockSupabase, 'viewer');

      const mockData = [{ tag: 'compliance', count: 12, source: 'user' }];
      mockSupabase.rpc.mockResolvedValueOnce({ data: mockData, error: null });

      const request = createTestRequest('/api/tags');
      const response = await getTags(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      // Legacy format: flat array, not wrapped in { tags, total }
      expect(Array.isArray(body)).toBe(true);
    });

    it('calls get_tag_counts_filtered with correct params', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

      const request = createTestRequest('/api/tags', {
        searchParams: {
          type: 'ai',
          min_count: '3',
          search: 'iso',
          limit: '20',
          offset: '10',
        },
      });
      await getTags(request);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_tag_counts_filtered', {
        p_type: 'ai',
        p_min_count: 3,
        p_search: 'iso',
        p_limit: 20,
        p_offset: 10,
      });
    });

    it('returns 500 when filtered RPC fails', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error' },
      });

      const request = createTestRequest('/api/tags', {
        searchParams: { type: 'ai' },
      });
      const response = await getTags(request);
      expect(response.status).toBe(500);
    });
  });
});
