/**
 * Real-DB integration tests for `public.get_user_display_names(uuid[])`
 * — the S156 WP-2 SQL function.
 *
 * These tests exercise the live function against the real Supabase
 * database. They verify the three load-bearing correctness properties:
 *
 * 1. The pipeline service account UUID resolves to the literal label
 *    `'Pipeline (system)'`, regardless of its `user_roles.display_name`
 *    or `auth.users.raw_user_meta_data` contents.
 * 2. A known human user (TEST_USER_1) resolves to a real display name
 *    via the `user_roles.display_name` → `raw_user_meta_data.display_name`
 *    → `email local-part` → `'A team member'` COALESCE chain.
 * 3. An unknown UUID returns a row with `display_name = 'A team member'`
 *    — NOT a dropped row. This is the C-1 fix from the spec
 *    verification report: the function projects `req.id` from the
 *    driving `unnest(user_ids)` table, not `u.id` from the LEFT JOIN.
 *
 * Prereqs:
 *   - `.env` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
 *   - `bun run seed:e2e-users` has been run (so TEST_USER_1 exists)
 *   - The WP-2 migration `20260408223728_create_get_user_display_names.sql`
 *     has been applied to the target DB
 *
 * Run: `bun run test:integration __tests__/integration/get-user-display-names`
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars
import { serviceClient } from './helpers/service-client';
import { getTestUserId } from './helpers/auth-session';

// ---------------------------------------------------------------------------
// Known UUIDs (see __tests__/integration/helpers/service-client.ts for
// the env-loading pattern; these values are also used in the golden
// path real-DB test).
// ---------------------------------------------------------------------------

const PIPELINE_UUID = 'a0000000-0000-4000-8000-000000000001';
// Resolved at beforeAll from email via auth admin API (S186 WP-C — no
// more hardcoded OLD-project UUIDs).
let TEST_USER_1: string = '';
/** UUID in the test range that is GUARANTEED to not exist in auth.users. */
const UNKNOWN_UUID = '00000000-4000-4000-8000-000000000999';

beforeAll(async () => {
  TEST_USER_1 = await getTestUserId('admin');
});

describe('get_user_display_names — live SQL function', () => {
  it('returns one row per input UUID, preserving unknowns (C-1 fix)', async () => {
    const { data, error } = await serviceClient.rpc('get_user_display_names', {
      user_ids: [PIPELINE_UUID, TEST_USER_1, UNKNOWN_UUID],
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Array.isArray(data)).toBe(true);
    // THIS is the load-bearing assertion from the spec verification
    // report C-1: if the function were projecting `u.id`, the unknown
    // UUID row would have `user_id = NULL` and the client-side wrapper
    // would drop it. Three rows in, three rows out — regardless of DB
    // state.
    expect(data!.length).toBe(3);
  });

  it('labels the pipeline service account "Pipeline (system)"', async () => {
    const { data, error } = await serviceClient.rpc('get_user_display_names', {
      user_ids: [PIPELINE_UUID],
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].user_id).toBe(PIPELINE_UUID);
    expect(data![0].display_name).toBe('Pipeline (system)');
    // S34 OPS-60: email column dropped from RETURNS (B-strict refactor).
    // No `.email` assertion — the SQL function no longer projects email.
  });

  it('resolves TEST_USER_1 via the user_roles → user_profiles.full_name COALESCE chain', async () => {
    const { data, error } = await serviceClient.rpc('get_user_display_names', {
      user_ids: [TEST_USER_1],
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].user_id).toBe(TEST_USER_1);
    // Do NOT assert the exact display name (it can be edited in the
    // admin UI), but DO assert the fallback sentinel is never returned
    // for a known user — that would mean the COALESCE chain fell all
    // the way through, which is a regression.
    expect(data![0].display_name).not.toBe('A team member');
    expect(data![0].display_name.length).toBeGreaterThan(0);
    // S34 OPS-60: email column dropped from RETURNS (B-strict refactor).
    // The COALESCE chain is now ur.display_name → up.full_name →
    // 'A team member' — the previous email-prefix fallback was removed.
  });

  it('returns "A team member" for an unknown UUID', async () => {
    const { data, error } = await serviceClient.rpc('get_user_display_names', {
      user_ids: [UNKNOWN_UUID],
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].user_id).toBe(UNKNOWN_UUID);
    expect(data![0].display_name).toBe('A team member');
    // S34 OPS-60: email column dropped from RETURNS (B-strict refactor).
  });

  it('returns an empty array for an empty input array', async () => {
    const { data, error } = await serviceClient.rpc('get_user_display_names', {
      user_ids: [],
    });

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('handles duplicate UUIDs in the input (SQL function sees all duplicates)', async () => {
    // The TypeScript wrapper dedupes before calling the function, but
    // the function itself does not — it returns one row per element in
    // `unnest(user_ids)`, so a caller passing duplicates gets duplicate
    // rows. This is intentional: we move the dedup responsibility to
    // the wrapper, where it's cheap and testable in isolation.
    const { data, error } = await serviceClient.rpc('get_user_display_names', {
      user_ids: [PIPELINE_UUID, PIPELINE_UUID, TEST_USER_1],
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(3);
    const pipelineRows = data!.filter((r) => r.user_id === PIPELINE_UUID);
    expect(pipelineRows.length).toBe(2);
    expect(
      pipelineRows.every((r) => r.display_name === 'Pipeline (system)'),
    ).toBe(true);
  });
});
