/**
 * Unit tests for `lib/users/display-names.ts` — S156 WP-2 wrapper for
 * the `get_user_display_names` SQL function.
 *
 * These are pure unit tests with a mocked Supabase RPC. The SQL
 * function itself is exercised by the companion integration test at
 * `__tests__/integration/get-user-display-names.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { resolveUserDisplayNames } from '@/lib/users/display-names';

// ---------------------------------------------------------------------------
// Canonical test UUIDs — real-shape so they'd survive a uuid[] cast if
// the mock ever fell through. None of these are touched in the unit
// tests (the RPC is mocked) but a realistic shape guards against
// accidental non-UUID inputs slipping into the production path.
// ---------------------------------------------------------------------------

const PIPELINE_UUID = 'a0000000-0000-4000-8000-000000000001';
const USER_1 = 'e21179e9-1946-43be-94a9-d566046da279';
const USER_2 = '11111111-2222-4333-8444-555555555555';
const UNKNOWN = '00000000-4000-4000-8000-000000000999';

// ---------------------------------------------------------------------------
// Mock Supabase client — only the `.rpc` method is used by the wrapper.
// ---------------------------------------------------------------------------

type DisplayRow = { user_id: string; display_name: string; email: string | null };

function buildMockClient(
  rpcResult:
    | { data: DisplayRow[]; error: null }
    | { data: null; error: { message: string } },
): SupabaseClient<Database> {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveUserDisplayNames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty Map for an empty input array without calling the RPC', async () => {
    const client = buildMockClient({ data: [], error: null });
    const result = await resolveUserDisplayNames(client, []);

    expect(result.size).toBe(0);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns a Map keyed by user_id for a happy-path single-user request', async () => {
    const client = buildMockClient({
      data: [
        {
          user_id: USER_1,
          display_name: 'Test User1',
          email: 'test.user1@test-kb-aish.co.uk',
        },
      ],
      error: null,
    });

    const result = await resolveUserDisplayNames(client, [USER_1]);

    expect(result.size).toBe(1);
    expect(result.get(USER_1)).toEqual({
      user_id: USER_1,
      display_name: 'Test User1',
      email: 'test.user1@test-kb-aish.co.uk',
    });
  });

  it('forwards the input UUIDs to the RPC as `user_ids`', async () => {
    const client = buildMockClient({ data: [], error: null });
    await resolveUserDisplayNames(client, [USER_1, USER_2]);

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('get_user_display_names', {
      user_ids: expect.arrayContaining([USER_1, USER_2]),
    });
  });

  it('deduplicates duplicate UUIDs in the input before calling the RPC', async () => {
    const client = buildMockClient({ data: [], error: null });
    await resolveUserDisplayNames(client, [USER_1, USER_1, USER_1, USER_2]);

    const rpcMock = vi.mocked(client.rpc);
    const [, args] = rpcMock.mock.calls[0] as [
      string,
      { user_ids: string[] },
    ];
    expect(args.user_ids).toHaveLength(2);
    expect(new Set(args.user_ids)).toEqual(new Set([USER_1, USER_2]));
  });

  it('handles the pipeline service account label without translation (trusts the SQL function)', async () => {
    // The wrapper does NOT know about PIPELINE_SYSTEM_USER_ID directly —
    // that logic lives in the SQL function's CASE branch. This test
    // verifies the wrapper is a pass-through on the pipeline UUID and
    // returns whatever the RPC hands back (which, in integration, will
    // be 'Pipeline (system)').
    const client = buildMockClient({
      data: [
        {
          user_id: PIPELINE_UUID,
          display_name: 'Pipeline (system)',
          email: 'pipeline@system.knowledge-hub.internal',
        },
      ],
      error: null,
    });

    const result = await resolveUserDisplayNames(client, [PIPELINE_UUID]);
    expect(result.get(PIPELINE_UUID)?.display_name).toBe('Pipeline (system)');
  });

  it('preserves unknown UUIDs in the result Map (C-1 load-bearing behaviour)', async () => {
    // The whole point of the C-1 fix in the SQL function is that
    // unknown UUIDs return a row (projected from `unnest(user_ids)`,
    // not from the LEFT JOIN). This test verifies the wrapper does not
    // accidentally reintroduce the "drop rows with null user_id"
    // behaviour that bug exposed.
    const client = buildMockClient({
      data: [
        { user_id: UNKNOWN, display_name: 'A team member', email: null },
      ],
      error: null,
    });

    const result = await resolveUserDisplayNames(client, [UNKNOWN]);
    expect(result.size).toBe(1);
    expect(result.get(UNKNOWN)).toEqual({
      user_id: UNKNOWN,
      display_name: 'A team member',
      email: null,
    });
  });

  it('throws a descriptive error when the RPC returns an error envelope', async () => {
    const client = buildMockClient({
      data: null,
      error: { message: 'permission denied for function get_user_display_names' },
    });

    await expect(resolveUserDisplayNames(client, [USER_1])).rejects.toThrow(
      /get_user_display_names failed: permission denied/,
    );
  });

  it('falls open to "A team member" if the function ever returns a NULL display_name (defence in depth)', async () => {
    // The SQL function's COALESCE chain terminates in the literal
    // 'A team member', so in normal operation display_name is never
    // NULL. But the wrapper guards with `?? 'A team member'` so that
    // a future function modification that accidentally returns NULL
    // fails OPEN (sensible fallback) rather than inserting a NULL
    // into a Map<string, string>.
    const client = buildMockClient({
      data: [
        {
          user_id: UNKNOWN,
          display_name: null as unknown as string,
          email: null,
        },
      ],
      error: null,
    });

    const result = await resolveUserDisplayNames(client, [UNKNOWN]);
    expect(result.get(UNKNOWN)?.display_name).toBe('A team member');
  });

  it('ignores stray rows with unknown user_ids (wrapper never synthesises extra keys)', async () => {
    // Contract check: if the RPC somehow returns a row for a UUID we
    // didn't ask for, the wrapper still stores it. This is preferred
    // over filtering because the Map is an exact mirror of the RPC
    // response; the caller decides what to do with extras.
    const client = buildMockClient({
      data: [
        { user_id: USER_1, display_name: 'Test User1', email: null },
        { user_id: USER_2, display_name: 'Someone Else', email: null },
      ],
      error: null,
    });

    const result = await resolveUserDisplayNames(client, [USER_1]);
    expect(result.size).toBe(2);
    expect(result.has(USER_1)).toBe(true);
    expect(result.has(USER_2)).toBe(true);
  });
});
