/**
 * API route tests for the curator APPROVE route
 * (`app/api/q-a-pairs/dedup-proposals/[proposalId]/approve/route.ts`, POST) —
 * ID-120 {120.7} P-5.
 *
 * Covers (testStrategy):
 *   - auth gating: unauthenticated → 401; viewer → 403; admin/editor allowed.
 *   - happy path: archive the non-survivor FIRST (q_a_pairs UPDATE carries
 *     publication_status='archived' + superseded_by=<survivor> under the
 *     published CAS), THEN flip the proposal status='approved' (INV-15 order).
 *   - failed archive (CAS-0-row): leaves the proposal pending + corpus
 *     unchanged — the proposal-status flip UPDATE never runs (409).
 *   - cross-workspace survivor: succeeds; superseded_by written by value
 *     (INV-11). The q_a_pair_history snapshot is the trigger's job — the route
 *     performs NO app-side history insert.
 *   - override (INV-13): a curator survivor_id that differs from the proposer's
 *     nomination swaps WHICH member is archived.
 *   - reject route writes nothing to q_a_pairs — covered in reject-route.test.ts.
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

// ---------------------------------------------------------------------------
// Shared mock client (configured per-test via _chains)
// ---------------------------------------------------------------------------

const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAIR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = 'test-user-id';

// A single dispatch mock the route's `createClient()` returns. Auth state +
// per-table resolutions are configured fresh per test.
let mockSupabase: MockSupabaseDispatch;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

// Import the handler AFTER the mocks are registered.
import { POST } from '@/app/api/q-a-pairs/dedup-proposals/[proposalId]/approve/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext() {
  return { params: createTestParams({ proposalId: PROPOSAL_ID }) };
}

function makeRequest(body?: unknown) {
  return createTestRequest(
    `/api/q-a-pairs/dedup-proposals/${PROPOSAL_ID}/approve`,
    { method: 'POST', body: body ?? {} },
  );
}

/** A pending proposal row the read resolves to (override fields as needed). */
function proposalRow(over: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    pair_a_id: PAIR_A,
    pair_b_id: PAIR_B,
    proposed_survivor_id: PAIR_A,
    status: 'pending',
    ...over,
  };
}

interface BuildOpts {
  role?: 'admin' | 'editor' | 'viewer';
  unauthenticated?: boolean;
  proposal?: Record<string, unknown> | null;
  /** rows the q_a_pairs archive UPDATE...select('id') resolves to. */
  archiveRows?: { id: string }[];
  archiveError?: { message: string; code: string } | null;
  /** the proposal-flip UPDATE...single() resolution. */
  flipRow?: Record<string, unknown> | null;
}

/**
 * Build the dispatch mock with auth + per-table resolutions wired for the
 * approve flow:
 *   - user_roles: role lookup (.single)
 *   - q_a_pair_dedup_proposals: read (.maybeSingle) THEN flip (.single)
 *   - q_a_pairs: archive UPDATE...select('id') (awaited chain → then)
 */
function build(opts: BuildOpts): MockSupabaseDispatch {
  const dispatch = createMockSupabaseTableDispatch({
    user_roles: { data: { role: opts.role ?? 'editor' }, error: null },
    q_a_pair_dedup_proposals: {
      data: opts.proposal === undefined ? proposalRow() : opts.proposal,
      error: null,
    },
    q_a_pairs: {
      data: opts.archiveRows ?? [{ id: PAIR_B }],
      error: opts.archiveError ?? null,
    },
  });

  // The proposal table is read (maybeSingle) then flipped (single) — give the
  // flip its own resolution on .single (the read uses .maybeSingle).
  const proposalChain = dispatch._chains.q_a_pair_dedup_proposals;
  proposalChain.maybeSingle.mockResolvedValue({
    data: opts.proposal === undefined ? proposalRow() : opts.proposal,
    error: null,
  });
  proposalChain.single.mockResolvedValue({
    data:
      opts.flipRow === undefined
        ? proposalRow({ status: 'approved', resolved_survivor_id: PAIR_A })
        : opts.flipRow,
    error: null,
  });

  // The role lookup hits user_roles.single.
  dispatch._chains.user_roles.single.mockResolvedValue({
    data: { role: opts.role ?? 'editor' },
    error: null,
  });

  // Auth user resolution.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/q-a-pairs/dedup-proposals/:id/approve', () => {
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

  describe('approve order (INV-15) — archive FIRST, then flip', () => {
    it('archives the non-survivor (CAS + superseded_by) then flips the proposal to approved (editor)', async () => {
      mockSupabase = build({ role: 'editor' });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.proposal.status).toBe('approved');
      expect(body.survivor_id).toBe(PAIR_A);
      expect(body.archived_id).toBe(PAIR_B);

      // q_a_pairs archive: publication_status='archived' + superseded_by=survivor.
      const qaChain = mockSupabase._chains.q_a_pairs;
      expect(qaChain.update).toHaveBeenCalledTimes(1);
      const archivePayload = qaChain.update.mock.calls[0][0];
      expect(archivePayload.publication_status).toBe('archived');
      expect(archivePayload.superseded_by).toBe(PAIR_A);
      // CAS on still-published.
      expect(qaChain.eq).toHaveBeenCalledWith(
        'publication_status',
        'published',
      );

      // proposal flip: status='approved' + resolved fields stamped.
      const propChain = mockSupabase._chains.q_a_pair_dedup_proposals;
      expect(propChain.update).toHaveBeenCalledTimes(1);
      const flipPayload = propChain.update.mock.calls[0][0];
      expect(flipPayload.status).toBe('approved');
      expect(flipPayload.resolved_survivor_id).toBe(PAIR_A);
      expect(flipPayload.resolved_by).toBe(USER_ID);
      expect(flipPayload.resolved_at).toBeTruthy();
    });

    it('allows the admin role too', async () => {
      mockSupabase = build({ role: 'admin' });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);
    });

    it('performs NO app-side q_a_pair_history insert (the trigger owns the snapshot)', async () => {
      mockSupabase = build({ role: 'editor' });
      await POST(makeRequest(), makeContext());
      expect(mockSupabase.from).not.toHaveBeenCalledWith('q_a_pair_history');
    });
  });

  describe('failed archive leaves the proposal pending + corpus flip skipped', () => {
    it('returns 409 and does NOT flip the proposal when the archive CAS matches 0 rows', async () => {
      mockSupabase = build({ role: 'editor', archiveRows: [] });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(409);

      // The proposal-flip UPDATE must NEVER run — proposal stays pending.
      const propChain = mockSupabase._chains.q_a_pair_dedup_proposals;
      expect(propChain.update).not.toHaveBeenCalled();
    });

    it('returns 500 and does NOT flip the proposal when the archive UPDATE errors', async () => {
      mockSupabase = build({
        role: 'editor',
        archiveRows: undefined,
        archiveError: { message: 'db boom', code: 'XXXXX' },
      });
      // Force the awaited q_a_pairs chain to resolve an error.
      mockSupabase._chains.q_a_pairs.then = vi.fn(
        (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'db boom', code: 'XXXXX' } }),
      ) as never;

      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(500);
      const propChain = mockSupabase._chains.q_a_pair_dedup_proposals;
      expect(propChain.update).not.toHaveBeenCalled();
    });
  });

  describe('cross-workspace survivor (INV-11)', () => {
    it('succeeds and writes the survivor id verbatim as superseded_by', async () => {
      // Proposer nominated PAIR_A (which here stands for a different-workspace
      // member) — the route writes it by value with no workspace constraint.
      mockSupabase = build({ role: 'editor' });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(200);
      const archivePayload =
        mockSupabase._chains.q_a_pairs.update.mock.calls[0][0];
      expect(archivePayload.superseded_by).toBe(PAIR_A);
    });
  });

  describe('override (INV-13)', () => {
    it('swaps WHICH member is archived when the curator overrides the survivor', async () => {
      // Proposer nominated PAIR_A; curator overrides survivor to PAIR_B, so
      // PAIR_A becomes the archived non-survivor.
      mockSupabase = build({
        role: 'editor',
        archiveRows: [{ id: PAIR_A }],
        flipRow: proposalRow({
          status: 'approved',
          resolved_survivor_id: PAIR_B,
        }),
      });
      const res = await POST(
        makeRequest({ survivor_id: PAIR_B }),
        makeContext(),
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.survivor_id).toBe(PAIR_B);
      expect(body.archived_id).toBe(PAIR_A);

      const archivePayload =
        mockSupabase._chains.q_a_pairs.update.mock.calls[0][0];
      // superseded_by points at the OVERRIDE survivor.
      expect(archivePayload.superseded_by).toBe(PAIR_B);
      // CAS targets the OTHER member (PAIR_A) as the non-survivor.
      expect(mockSupabase._chains.q_a_pairs.eq).toHaveBeenCalledWith(
        'id',
        PAIR_A,
      );
    });

    it('rejects an override survivor_id that is not a pair member (400)', async () => {
      const OUTSIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      mockSupabase = build({ role: 'editor' });
      const res = await POST(
        makeRequest({ survivor_id: OUTSIDER }),
        makeContext(),
      );
      expect(res.status).toBe(400);
      // No corpus write on a rejected override.
      expect(mockSupabase._chains.q_a_pairs.update).not.toHaveBeenCalled();
    });
  });

  describe('proposal state', () => {
    it('returns 404 when the proposal does not exist', async () => {
      mockSupabase = build({ role: 'editor', proposal: null });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(404);
    });

    it('returns 409 when the proposal is already resolved', async () => {
      mockSupabase = build({
        role: 'editor',
        proposal: proposalRow({ status: 'approved' }),
      });
      const res = await POST(makeRequest(), makeContext());
      expect(res.status).toBe(409);
      expect(mockSupabase._chains.q_a_pairs.update).not.toHaveBeenCalled();
    });
  });
});
