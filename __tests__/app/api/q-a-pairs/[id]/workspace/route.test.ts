/**
 * API route tests for PATCH /api/q-a-pairs/[id]/workspace — ID-135 {135.22}
 * S449 addendum (bulk-assign rehome).
 *
 * The pre-M6 `/library` Assign-to-Workspace bulk action posted to the
 * {131.17}-deleted `/api/items/[id]/workspaces` route against the dropped
 * `content_item_workspaces` junction table. Post-M6 there is no junction
 * table — `q_a_pairs.source_workspace_id` (a nullable FK straight to
 * `workspaces`) IS the workspace-membership grain for a Q&A pair. This is a
 * REAL-route-handler test (imports the actual `PATCH` export) per the S449
 * ask: the retired hook-level test mocked `global.fetch`, which made
 * route-existence regressions invisible.
 *
 * Mock discipline: shared `createMockSupabaseClient()` + `configureAuth()` +
 * `createTestRequest()` (per `__tests__/CLAUDE.md`).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../../../../helpers/mock-supabase';
import { configureAuth } from '../../../../../helpers/mock-auth';
import { createTestRequest } from '../../../../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { PATCH } from '@/app/api/q-a-pairs/[id]/workspace/route';

const PAIR_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '66666666-6666-4666-8666-666666666666';

function workspaceRequest(body: Record<string, unknown>) {
  return createTestRequest(`/api/q-a-pairs/${PAIR_ID}/workspace`, {
    method: 'PATCH',
    body,
  });
}

function callRoute(client: MockSupabaseClient, body: Record<string, unknown>) {
  return PATCH(workspaceRequest(body), {
    params: Promise.resolve({ id: PAIR_ID }),
  });
}

describe('PATCH /api/q-a-pairs/[id]/workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated caller', async () => {
    configureAuth(mockSupabase).asUnauthenticated();

    const res = await callRoute(mockSupabase, {
      source_workspace_id: WORKSPACE_ID,
    });

    expect(res.status).toBe(401);
  });

  it('rejects a viewer-role caller (editor/admin only)', async () => {
    configureAuth(mockSupabase).asViewer();

    const res = await callRoute(mockSupabase, {
      source_workspace_id: WORKSPACE_ID,
    });

    expect(res.status).toBe(403);
  });

  it('rejects a body with a non-UUID source_workspace_id', async () => {
    configureAuth(mockSupabase).asEditor();

    const res = await callRoute(mockSupabase, {
      source_workspace_id: 'not-a-uuid',
    });

    expect(res.status).toBe(400);
  });

  it('assigns the pair to a workspace via source_workspace_id and returns the updated row', async () => {
    configureAuth(mockSupabase).asEditor();
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: PAIR_ID, source_workspace_id: WORKSPACE_ID },
      error: null,
    });

    const res = await callRoute(mockSupabase, {
      source_workspace_id: WORKSPACE_ID,
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.q_a_pair.source_workspace_id).toBe(WORKSPACE_ID);
    expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ source_workspace_id: WORKSPACE_ID }),
    );
  });

  it('unassigns the pair from its workspace when source_workspace_id is null', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: PAIR_ID, source_workspace_id: null },
      error: null,
    });

    const res = await callRoute(mockSupabase, { source_workspace_id: null });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.q_a_pair.source_workspace_id).toBeNull();
  });

  it('returns 404 when the pair does not exist', async () => {
    configureAuth(mockSupabase).asEditor();
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'no rows', code: 'PGRST116' },
    });

    const res = await callRoute(mockSupabase, {
      source_workspace_id: WORKSPACE_ID,
    });

    expect(res.status).toBe(404);
  });
});
