/**
 * API route tests for bulk flag resolution.
 *
 * Route tested:
 *   POST /api/intelligence/workspaces/:id/flags/resolve
 *
 * Security focus: cross-workspace flag_ids must be rejected (test 7).
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

// Import route handler AFTER mocks
import { POST } from '@/app/api/intelligence/workspaces/[id]/flags/resolve/route';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_WORKSPACE_ID = 'f0e1d2c3-b4a5-4968-8877-66554433aabb';
const PROMPT_VERSION_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const FLAG_1 = '11111111-1111-4111-8111-111111111111';
const FLAG_2 = '22222222-2222-4222-8222-222222222222';
const FLAG_3 = '33333333-3333-4333-8333-333333333333';
const FLAG_4 = '44444444-4444-4444-8444-444444444444';
const FLAG_5 = '55555555-5555-4555-8555-555555555555';

const MOCK_WORKSPACE = {
  id: WORKSPACE_ID,
  type: 'intelligence',
  is_archived: false,
};

function configureWorkspaceLookup(row: unknown = MOCK_WORKSPACE) {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: row,
    error: null,
  });
}

function configureFlagLookup(
  rows: Array<{
    id: string;
    resolved: boolean;
    feed_articles: { workspace_id: string } | null;
  }>,
) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null, count: rows.length }),
  );
}

function configureBulkUpdate(rows: Array<{ id: string }>) {
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null, count: rows.length }),
  );
}

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: {
      user: { id: 'test-user-id', email: 'test@example.com' },
    },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
}

function makeRequest(body: unknown): Parameters<typeof POST>[0] {
  return createTestRequest(
    `/api/intelligence/workspaces/${WORKSPACE_ID}/flags/resolve`,
    { method: 'POST', body },
  );
}

const params = () => ({ params: createTestParams({ id: WORKSPACE_ID }) });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/intelligence/workspaces/:id/flags/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // 1. 401 unauthenticated
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);
    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1],
        resolution_type: 'dismissed',
      }),
      params(),
    );
    expect(response.status).toBe(401);
  });

  // 2. 403 viewer role
  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');
    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1],
        resolution_type: 'dismissed',
      }),
      params(),
    );
    expect(response.status).toBe(403);
  });

  // 3. 403 editor without workspace access (404 — workspace lookup miss)
  it('returns 404 when editor has no access to workspace', async () => {
    configureRole(mockSupabase, 'editor');
    // Workspace lookup returns null — editor cannot see it.
    configureWorkspaceLookup(null);
    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1],
        resolution_type: 'dismissed',
      }),
      params(),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toMatch(/not found/i);
  });

  // 4. 400 missing flag_ids
  it('returns 400 when flag_ids is missing', async () => {
    configureRole(mockSupabase, 'admin');
    const response = await POST(
      makeRequest({
        resolution_type: 'dismissed',
      }),
      params(),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  // 5. 400 flag_ids exceeds cap
  it('returns 400 when flag_ids exceeds 500 cap', async () => {
    configureRole(mockSupabase, 'admin');
    const tooMany = Array.from(
      { length: 501 },
      (_, i) =>
        `${'0'.repeat(8 - String(i).length)}${i}-0000-4000-8000-000000000000`,
    );
    const response = await POST(
      makeRequest({
        flag_ids: tooMany,
        resolution_type: 'dismissed',
      }),
      params(),
    );
    expect(response.status).toBe(400);
  });

  // 6. 400 invalid resolution_type
  it('returns 400 when resolution_type is not in the enum', async () => {
    configureRole(mockSupabase, 'admin');
    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1],
        resolution_type: 'confirmed', // not accepted by DB CHECK
      }),
      params(),
    );
    expect(response.status).toBe(400);
  });

  // 7. 400 cross-workspace flag_ids — security test
  it('returns 400 when any flag_id belongs to a different workspace', async () => {
    configureRole(mockSupabase, 'admin');
    configureWorkspaceLookup();
    // One flag belongs to another workspace — MUST reject.
    configureFlagLookup([
      {
        id: FLAG_1,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_2,
        resolved: false,
        feed_articles: { workspace_id: OTHER_WORKSPACE_ID },
      },
    ]);

    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1, FLAG_2],
        resolution_type: 'dismissed',
      }),
      params(),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/different workspace/i);
    // The update must NOT have been called.
    expect(mockSupabase._chain.update).not.toHaveBeenCalled();
  });

  // 8. 200 happy path: 3 resolved, no warnings
  it('resolves 3 flags with no warnings (field omitted when empty)', async () => {
    configureRole(mockSupabase, 'admin');
    configureWorkspaceLookup();
    configureFlagLookup([
      {
        id: FLAG_1,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_2,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_3,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
    ]);
    configureBulkUpdate([{ id: FLAG_1 }, { id: FLAG_2 }, { id: FLAG_3 }]);

    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1, FLAG_2, FLAG_3],
        resolution_type: 'dismissed',
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resolved_count).toBe(3);
    expect(body.requested_count).toBe(3);
    // warnings field omitted when empty (canonical warningsEnvelope contract)
    expect(body.warnings).toBeUndefined();

    // Verify update payload sets the required columns.
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        resolved: true,
        resolution_type: 'dismissed',
        resolved_by: 'test-user-id',
      }),
    );
  });

  // 9. 200 partial: 5 requested, 3 newly resolved, 2 already resolved
  it('partially resolves flags and surfaces already-resolved ones as warnings', async () => {
    configureRole(mockSupabase, 'admin');
    configureWorkspaceLookup();
    configureFlagLookup([
      {
        id: FLAG_1,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_2,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_3,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_4,
        resolved: true, // already resolved
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_5,
        resolved: true, // already resolved
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
    ]);
    configureBulkUpdate([{ id: FLAG_1 }, { id: FLAG_2 }, { id: FLAG_3 }]);

    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1, FLAG_2, FLAG_3, FLAG_4, FLAG_5],
        resolution_type: 'dismissed',
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resolved_count).toBe(3);
    expect(body.requested_count).toBe(5);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings).toHaveLength(2);
    expect(body.warnings[0]).toMatch(/already resolved/);
    expect(body.warnings[1]).toMatch(/already resolved/);
    // Both skipped ids should appear somewhere in the warnings list.
    const joined = body.warnings.join('\n');
    expect(joined).toContain(FLAG_4);
    expect(joined).toContain(FLAG_5);
  });

  // 10. 200 with prompt_version_id attached (resolution_type = addressed)
  it('resolves with resolution_type=addressed and a prompt_version_id', async () => {
    configureRole(mockSupabase, 'admin');
    configureWorkspaceLookup();
    configureFlagLookup([
      {
        id: FLAG_1,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
      {
        id: FLAG_2,
        resolved: false,
        feed_articles: { workspace_id: WORKSPACE_ID },
      },
    ]);
    configureBulkUpdate([{ id: FLAG_1 }, { id: FLAG_2 }]);

    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1, FLAG_2],
        resolution_type: 'addressed',
        prompt_version_id: PROMPT_VERSION_ID,
        resolved_notes: 'Tightened relevance prompt v3',
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resolved_count).toBe(2);
    expect(body.requested_count).toBe(2);
    expect(body.warnings).toBeUndefined();

    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        resolved: true,
        resolution_type: 'addressed',
        prompt_version_id: PROMPT_VERSION_ID,
        resolved_notes: 'Tightened relevance prompt v3',
      }),
    );
  });

  // Extra guard: addressed without prompt_version_id → 400
  it('returns 400 when resolution_type=addressed without prompt_version_id', async () => {
    configureRole(mockSupabase, 'admin');
    const response = await POST(
      makeRequest({
        flag_ids: [FLAG_1],
        resolution_type: 'addressed',
      }),
      params(),
    );
    expect(response.status).toBe(400);
  });
});
