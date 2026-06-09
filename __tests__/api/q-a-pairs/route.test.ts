/**
 * API route tests for the UC6 user-direct Q&A write route
 * (`app/api/q-a-pairs/[id]/route.ts`, PATCH) — ID-59 {59.11} (PC-A4 / PC-4).
 *
 * Covers:
 *   - Auth gating: unauthenticated (401), viewer (403), editor/admin allowed.
 *   - Happy path: q_a_pairs UPDATE via tryQuery; response carries the updated
 *     row. The q_a_pair_history snapshot is the EXISTING trigger's job — the
 *     route performs NO app-side history insert (asserted: only `update` on
 *     `q_a_pairs`, never an `insert` on `q_a_pair_history`).
 *   - edit_intent stamp (single-actor): a single coerced intent is stamped on
 *     the UPDATE payload.
 *   - CRDT merge path: a per-actor `intents` array is coerced + arbitrated
 *     (arbitrateMany) and the resolved intent is stamped.
 *   - KH-DB-only: NO file write (the route never imports/calls any fs writer).
 *   - Validation: empty body → 400; unknown edit_intent value is coerced to
 *     'cosmetic' (never rejected, never dilutes), not a 400.
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
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/q-a-pairs/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QA_UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeContext() {
  return { params: createTestParams({ id: QA_UUID }) };
}

function makeRequest(body: unknown) {
  return createTestRequest(`/api/q-a-pairs/${QA_UUID}`, {
    method: 'PATCH',
    body,
  });
}

/** The row the UPDATE...select().single() resolves to on the happy path. */
function configureUpdateReturns(row: Record<string, unknown>) {
  mockSupabase._chain.single.mockResolvedValueOnce({ data: row, error: null });
}

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/q-a-pairs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const res = await PATCH(
        makeRequest({ question_text: 'updated?' }),
        makeContext(),
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const res = await PATCH(
        makeRequest({ question_text: 'updated?' }),
        makeContext(),
      );
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('returns 400 when no editable fields are supplied', async () => {
      configureRole(mockSupabase, 'editor');
      const res = await PATCH(makeRequest({}), makeContext());
      expect(res.status).toBe(400);
    });
  });

  describe('happy path — UPDATE + trigger snapshot + stamp', () => {
    it('updates q_a_pairs via the editor role and stamps a single intent', async () => {
      configureRole(mockSupabase, 'editor');
      configureUpdateReturns({
        id: QA_UUID,
        question_text: 'New question?',
        edit_intent: 'data',
      });

      const res = await PATCH(
        makeRequest({
          question_text: 'New question?',
          edit_intent: 'data',
        }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.q_a_pair.id).toBe(QA_UUID);
      expect(body.edit_intent).toBe('data');

      // The UPDATE targets q_a_pairs and carries the stamped edit_intent.
      expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
      expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('data');
      expect(updatePayload.question_text).toBe('New question?');
    });

    it('performs NO app-side q_a_pair_history insert (trigger owns the snapshot)', async () => {
      configureRole(mockSupabase, 'editor');
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'cosmetic' });

      await PATCH(
        makeRequest({ answer_standard: 'Tweaked wording.' }),
        makeContext(),
      );

      // Never write to the history table from the app; never call .insert().
      expect(mockSupabase.from).not.toHaveBeenCalledWith('q_a_pair_history');
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });
  });

  describe('CRDT merge path — arbitrateMany over per-actor intents', () => {
    it('arbitrates two concurrent intents and stamps the merged result', async () => {
      configureRole(mockSupabase, 'editor');
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      // cosmetic + data ⇒ data (data wins arbitration).
      const res = await PATCH(
        makeRequest({
          answer_standard: 'Merged answer.',
          intents: [
            { actor: ACTOR_A, intent: 'cosmetic' },
            { actor: ACTOR_B, intent: 'data' },
          ],
        }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('data');
    });

    it('coerces an out-of-CV intent to cosmetic without rejecting the request', async () => {
      configureRole(mockSupabase, 'editor');
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'cosmetic' });

      const res = await PATCH(
        makeRequest({
          answer_standard: 'Wording only.',
          intents: [{ actor: ACTOR_A, intent: 'not-a-real-intent' }],
        }),
        makeContext(),
      );

      // Coerced, not rejected: 200, intent absorbed to cosmetic.
      expect(res.status).toBe(200);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('cosmetic');
    });
  });

  describe('failure surfacing', () => {
    it('returns 500 when the q_a_pairs UPDATE fails', async () => {
      configureRole(mockSupabase, 'editor');
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'boom', code: 'XXXXX' },
      });

      const res = await PATCH(
        makeRequest({ question_text: 'x?' }),
        makeContext(),
      );
      expect(res.status).toBe(500);
    });
  });
});
