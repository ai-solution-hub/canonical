/**
 * API route tests for DELETE /api/q-a-pairs/[id] — ID-135 {135.22} bulk-delete
 * rehome.
 *
 * The pre-M6 `/library` bulk-delete action DELETEd `/api/items/[id]` (removed
 * by {131.17}). This adds a hard DELETE sibling to the already-live `PATCH`
 * on this route (mirroring `app/api/workspaces/[id]/route.ts`'s PATCH+DELETE
 * convention). Hard delete is DB-safe: every FK referencing `q_a_pairs.id`
 * (q_a_pair_history, q_a_pair_dedup_proposals, question_matches, citations,
 * record_lifecycle) is `ON DELETE CASCADE` or `ON DELETE SET NULL` (verified
 * against the live schema) — matching the pre-M6 hard-delete semantics the
 * old `/api/items/[id]` DELETE also used (never a soft-archive).
 *
 * This test file covers ONLY the new `DELETE` export — the existing `PATCH`
 * (sidecar/edit-intent write-back) has its own extensive behaviour and is
 * out of this Subtask's file-ownership boundary; it is left untouched and
 * untested here.
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
} from '../../../../helpers/mock-supabase';
import { configureAuth } from '../../../../helpers/mock-auth';
import { createTestRequest } from '../../../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { DELETE } from '@/app/api/q-a-pairs/[id]/route';

const PAIR_ID = '77777777-7777-4777-8777-777777777777';

function callRoute() {
  return DELETE(
    createTestRequest(`/api/q-a-pairs/${PAIR_ID}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: PAIR_ID }) },
  );
}

/**
 * Queue the resolved value for the DELETE's own `.eq().select('id')` chain
 * read (array-returning, no `.single()`) — this route's final chain call has
 * no dedicated terminal mock (unlike `.single()`), so it resolves via the
 * chain's shared `then` (the same pattern
 * `citations-route.test.ts`'s `queueCitationsRows` uses). The auth role
 * lookup terminates via `.single()` (a separate mock queue via
 * `configureRole`), so this queued `then` resolution is consumed exactly
 * once, by this route's own query — never by the auth flow.
 */
function queueDeleteResult(
  client: MockSupabaseClient,
  result: { data: unknown; error: unknown },
) {
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve(result),
  );
}

describe('DELETE /api/q-a-pairs/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated caller', async () => {
    configureAuth(mockSupabase).asUnauthenticated();

    const res = await callRoute();

    expect(res.status).toBe(401);
  });

  it('rejects an editor-role caller (admin only)', async () => {
    configureAuth(mockSupabase).asEditor();

    const res = await callRoute();

    expect(res.status).toBe(403);
  });

  it('rejects a viewer-role caller (admin only)', async () => {
    configureAuth(mockSupabase).asViewer();

    const res = await callRoute();

    expect(res.status).toBe(403);
  });

  it('hard-deletes the pair for an admin caller and returns success', async () => {
    configureAuth(mockSupabase).asAdmin();
    queueDeleteResult(mockSupabase, { data: [{ id: PAIR_ID }], error: null });

    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
    expect(mockSupabase._chain.delete).toHaveBeenCalled();
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', PAIR_ID);
  });

  it('returns 404 when the pair does not exist (0 affected rows)', async () => {
    configureAuth(mockSupabase).asAdmin();
    queueDeleteResult(mockSupabase, { data: [], error: null });

    const res = await callRoute();

    expect(res.status).toBe(404);
  });

  it('returns 500 on a genuine DB failure', async () => {
    configureAuth(mockSupabase).asAdmin();
    queueDeleteResult(mockSupabase, {
      data: null,
      error: { message: 'connection refused', code: 'PGRST500' },
    });

    const res = await callRoute();

    expect(res.status).toBe(500);
  });
});
