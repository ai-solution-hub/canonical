/**
 * API route tests for the curator REJECT route
 * (`app/api/q-a-pairs/dedup-proposals/[proposalId]/reject/route.ts`, POST) —
 * ID-120 {120.7} P-5.
 *
 * Covers (testStrategy):
 *   - auth gating: unauthenticated → 401; viewer → 403; admin/editor allowed.
 *   - reject sets status='rejected' AND writes NOTHING to q_a_pairs (INV-13):
 *     no archive, no superseded_by, no q_a_pairs UPDATE at all.
 *   - a non-pending / absent proposal → 409 (reject did not apply).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseTableDispatch,
  type MockSupabaseDispatch,
} from '../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../helpers/mock-next';

const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'test-user-id';

let mockSupabase: MockSupabaseDispatch;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { POST } from '@/app/api/q-a-pairs/dedup-proposals/[proposalId]/reject/route';

function makeContext() {
  return { params: createTestParams({ proposalId: PROPOSAL_ID }) };
}

function makeRequest() {
  return createTestRequest(
    `/api/q-a-pairs/dedup-proposals/${PROPOSAL_ID}/reject`,
    { method: 'POST', body: {} },
  );
}

function rejectedRow() {
  return {
    id: PROPOSAL_ID,
    status: 'rejected',
    resolved_by: USER_ID,
    resolved_at: new Date().toISOString(),
  };
}

interface BuildOpts {
  role?: 'admin' | 'editor' | 'viewer';
  unauthenticated?: boolean;
  /** the flip UPDATE...maybeSingle resolution (null = not pending). */
  flipRow?: Record<string, unknown> | null;
}

function build(opts: BuildOpts): MockSupabaseDispatch {
  const dispatch = createMockSupabaseTableDispatch({
    user_roles: { data: { role: opts.role ?? 'editor' }, error: null },
    q_a_pair_dedup_proposals: { data: null, error: null },
  });

  dispatch._chains.user_roles.single.mockResolvedValue({
    data: { role: opts.role ?? 'editor' },
    error: null,
  });
  dispatch._chains.q_a_pair_dedup_proposals.maybeSingle.mockResolvedValue({
    data: opts.flipRow === undefined ? rejectedRow() : opts.flipRow,
    error: null,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dispatch as any).auth = {
    getUser: vi.fn().mockResolvedValue(
      opts.unauthenticated
        ? {
            data: { user: null },
            error: { name: 'AuthSessionMissingError', message: 'missing' },
          }
        : {
            data: { user: { id: USER_ID, email: 't@example.com' } },
            error: null,
          },
    ),
  };

  return dispatch;
}

describe('POST /api/q-a-pairs/dedup-proposals/:id/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      mockSupabase = build({ unauthenticated: true });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(401);
    });

    it('returns 403 for a viewer role', async () => {
      mockSupabase = build({ role: 'viewer' });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(403);
    });
  });

  describe('reject sets status=rejected and writes NOTHING to q_a_pairs (INV-13)', () => {
    it('flips the proposal to rejected and never touches q_a_pairs (editor)', async () => {
      mockSupabase = build({ role: 'editor' });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.proposal.status).toBe('rejected');

      // The proposal flip ran with status='rejected'.
      const propChain = mockSupabase._chains.q_a_pair_dedup_proposals;
      const flipPayload = propChain.update.mock.calls[0][0];
      expect(flipPayload.status).toBe('rejected');
      expect(flipPayload.resolved_by).toBe(USER_ID);

      // INV-13: q_a_pairs is NEVER touched by a reject.
      expect(mockSupabase.from).not.toHaveBeenCalledWith('q_a_pairs');
    });

    it('allows the admin role too', async () => {
      mockSupabase = build({ role: 'admin' });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      expect(mockSupabase.from).not.toHaveBeenCalledWith('q_a_pairs');
    });
  });

  describe('proposal state', () => {
    it('returns 409 when the proposal is absent or no longer pending', async () => {
      mockSupabase = build({ role: 'editor', flipRow: null });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(409);
      expect(mockSupabase.from).not.toHaveBeenCalledWith('q_a_pairs');
    });
  });
});
