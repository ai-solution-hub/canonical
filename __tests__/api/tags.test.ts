/**
 * Tags API route tests.
 *
 * Tests the tag management endpoints:
 *   - GET    /api/tags          — list all tag counts
 *   - DELETE /api/tags          — delete a tag from all items
 *   - POST   /api/tags/rename   — rename a tag across all items
 *   - POST   /api/tags/merge    — merge source tag into target tag
 *
 * Covers auth enforcement, body validation, RPC handling,
 * and business logic edge cases.
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

import { GET as getTags, DELETE as deleteTags } from '@/app/api/tags/route';
import { POST as renameTags } from '@/app/api/tags/rename/route';
import { POST as mergeTags } from '@/app/api/tags/merge/route';

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
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null, count: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tags API', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // GET /api/tags
  // =========================================================================

  describe('GET /api/tags', () => {
    it('returns 403 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const response = await getTags();
      expect(response.status).toBe(403);
    });

    it('returns tag counts for authenticated user', async () => {
      // getAuthorisedClient() defaults to allowing all roles
      configureRole(mockSupabase, 'viewer');

      const mockTagData = [
        { tag: 'compliance', type: 'user', count: 12 },
        { tag: 'methodology', type: 'ai', count: 8 },
      ];
      mockSupabase.rpc.mockResolvedValueOnce({
        data: mockTagData,
        error: null,
      });

      const response = await getTags();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual(mockTagData);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error' },
      });

      const response = await getTags();
      expect(response.status).toBe(500);
    });

    it('returns empty array when no tags exist', async () => {
      configureRole(mockSupabase, 'viewer');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const response = await getTags();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual([]);
    });
  });

  // =========================================================================
  // DELETE /api/tags
  // =========================================================================

  describe('DELETE /api/tags', () => {
    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags', {
        method: 'DELETE',
        body: { tag: 'old-tag', type: 'user' },
      });

      const response = await deleteTags(request);
      expect(response.status).toBe(403);
    });

    it('returns 403 for editor role (admin only)', async () => {
      configureRole(mockSupabase, 'editor');

      const request = createTestRequest('/api/tags', {
        method: 'DELETE',
        body: { tag: 'old-tag', type: 'user' },
      });

      const response = await deleteTags(request);
      expect(response.status).toBe(403);
    });

    it('returns 200 with affected count on successful delete', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: 5,
        error: null,
      });

      const request = createTestRequest('/api/tags', {
        method: 'DELETE',
        body: { tag: 'obsolete-tag', type: 'user' },
      });

      const response = await deleteTags(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.affected).toBe(5);
    });

    it('returns 400 for missing tag name', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags', {
        method: 'DELETE',
        body: { type: 'user' },
      });

      const response = await deleteTags(request);
      expect(response.status).toBe(400);
    });
  });

  // =========================================================================
  // POST /api/tags/rename
  // =========================================================================

  describe('POST /api/tags/rename', () => {
    it('returns 403 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest('/api/tags/rename', {
        method: 'POST',
        body: { old: 'foo', new: 'bar', type: 'user' },
      });

      const response = await renameTags(request);
      expect(response.status).toBe(403);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');

      const request = createTestRequest('/api/tags/rename', {
        method: 'POST',
        body: { old: 'foo', new: 'bar', type: 'user' },
      });

      const response = await renameTags(request);
      expect(response.status).toBe(403);
    });

    it('returns 200 on successful rename', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: 7,
        error: null,
      });

      const request = createTestRequest('/api/tags/rename', {
        method: 'POST',
        body: { old: 'complianse', new: 'compliance', type: 'user' },
      });

      const response = await renameTags(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.affected).toBe(7);
    });

    it('returns 400 when old and new names are the same', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/rename', {
        method: 'POST',
        body: { old: 'same-tag', new: 'same-tag', type: 'user' },
      });

      const response = await renameTags(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('different');
    });

    it('returns 400 for empty old tag name', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/rename', {
        method: 'POST',
        body: { old: '', new: 'new-tag', type: 'user' },
      });

      const response = await renameTags(request);
      expect(response.status).toBe(400);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'RPC error' },
      });

      const request = createTestRequest('/api/tags/rename', {
        method: 'POST',
        body: { old: 'old-tag', new: 'new-tag', type: 'user' },
      });

      const response = await renameTags(request);
      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // POST /api/tags/merge
  // =========================================================================

  describe('POST /api/tags/merge', () => {
    it('returns 200 on successful merge', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: 3,
        error: null,
      });

      const request = createTestRequest('/api/tags/merge', {
        method: 'POST',
        body: { source: 'typo-tag', target: 'correct-tag', type: 'user' },
      });

      const response = await mergeTags(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.affected).toBe(3);
    });

    it('returns 400 when source and target are the same', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/merge', {
        method: 'POST',
        body: { source: 'same', target: 'same', type: 'user' },
      });

      const response = await mergeTags(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('different');
    });

    it('returns 400 for missing source tag', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/merge', {
        method: 'POST',
        body: { target: 'correct-tag', type: 'user' },
      });

      const response = await mergeTags(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 for missing target tag', async () => {
      configureRole(mockSupabase, 'admin');

      const request = createTestRequest('/api/tags/merge', {
        method: 'POST',
        body: { source: 'source-tag', type: 'user' },
      });

      const response = await mergeTags(request);
      expect(response.status).toBe(400);
    });

    it('returns 500 when RPC fails', async () => {
      configureRole(mockSupabase, 'admin');

      mockSupabase.rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'merge_tags failed' },
      });

      const request = createTestRequest('/api/tags/merge', {
        method: 'POST',
        body: { source: 'src', target: 'tgt', type: 'ai' },
      });

      const response = await mergeTags(request);
      expect(response.status).toBe(500);
    });
  });
});
