/**
 * Tests for `lib/queue/auth.ts` — worker auth-context re-validation.
 *
 * Spec: docs/specs/background-queue-infra-spec.md §4.2 (auth-context
 * reconstruction, lines 542-625) — the worker re-fetches the user's role from
 * `user_roles` after claiming a job and refuses to proceed if the live role
 * is lower than the role required by the job type.
 * Plan: docs/plans/background-queue-infra-plan.md §2 W2 (auth helper).
 *
 * AC coverage: AC-7 (Worker reconstructs auth context + re-validates role).
 *
 * The error-message strings asserted in this file are VERBATIM from spec §4.2
 * lines 599-606 — they are part of the public contract because they surface
 * in `error_message` on the `processing_queue` row and propagate to Sentry +
 * the operational dashboard.
 *
 * Implementation note: the W2-A `lib/queue/auth.ts` impl file lands in a
 * parallel worktree. Tests run after the W2-A merge — `bunx tsc --noEmit` in
 * THIS worktree will fail with `Cannot find module '@/lib/queue/auth'` until
 * then; that is expected and not a regression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { reValidateAuthContext } from '@/lib/queue/auth';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

// RFC 4122 v4-compliant UUIDs (project gotcha: z.string().uuid() rejects
// `00000000-...0001`-style fixtures because they fail RFC 4122 v4).
const USER_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';

describe('reValidateAuthContext', () => {
  let mockClient: MockSupabaseClient;
  let supabase: SupabaseClient<Database>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    supabase = mockClient as unknown as SupabaseClient<Database>;
  });

  // -------------------------------------------------------------------------
  // (a) Live role meets requiredRole → ok: true
  // -------------------------------------------------------------------------
  it('returns { ok: true } when the live role meets requiredRole (admin meets admin)', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'admin',
      'admin',
    );

    expect(result).toEqual({ ok: true });
    // NOTE: invocation-shape asserts on table/column/user_id-scoping chain
    // calls removed under W2-RD-lib (S44). The user_id-scoped role lookup
    // is a multi-tenant security contract — its enforcement is verified
    // structurally at the database layer via the integration suite
    // (`__tests__/integration/queue-auth.integration.test.ts` under the
    // W-RD' sibling wave, per remediation-plan.md §3.5).
  });

  it('returns { ok: true } when the live role exceeds requiredRole (admin exceeds editor)', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'admin' },
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'admin',
      'editor',
    );

    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } when editor meets editor requirement', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'editor' },
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'editor',
      'editor',
    );

    expect(result).toEqual({ ok: true });
  });

  // -------------------------------------------------------------------------
  // (b) Live role lower than requiredRole → ok: false with verbatim reason
  // -------------------------------------------------------------------------
  it('returns ok:false with the verbatim §4.2 message when admin demoted to editor and admin is required', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'editor' },
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'admin', // enqueuedRole
      'admin', // requiredRole
    );

    // Verbatim from spec §4.2 lines 603-606 — string-match the exact
    // shape including comma-spaces and key=value pairs.
    expect(result).toEqual({
      ok: false,
      reason:
        'enqueueing user role no longer authorised: enqueued=admin, current=editor, required=admin',
    });
  });

  it('returns ok:false when editor demoted to viewer and editor is required', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'viewer' },
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'editor',
      'editor',
    );

    expect(result).toEqual({
      ok: false,
      reason:
        'enqueueing user role no longer authorised: enqueued=editor, current=viewer, required=editor',
    });
  });

  it('returns ok:false when admin demoted to viewer and admin is required', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: { role: 'viewer' },
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'admin',
      'admin',
    );

    expect(result).toEqual({
      ok: false,
      reason:
        'enqueueing user role no longer authorised: enqueued=admin, current=viewer, required=admin',
    });
  });

  // -------------------------------------------------------------------------
  // (c) Supabase error during lookup → ok: false with role_lookup_failed:<msg>
  // -------------------------------------------------------------------------
  it('returns ok:false with role_lookup_failed prefix when the role SELECT errors', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'admin',
      'admin',
    );

    expect(result).toEqual({
      ok: false,
      reason: 'role_lookup_failed: connection refused',
    });
  });

  // -------------------------------------------------------------------------
  // (d) User has no role record (data === null) → verbatim "no role record"
  // -------------------------------------------------------------------------
  it('returns ok:false when the user has no row in user_roles (data is null)', async () => {
    mockClient._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const result = await reValidateAuthContext(
      supabase,
      USER_ID,
      'admin',
      'admin',
    );

    // Verbatim from spec §4.2 line 600.
    expect(result).toEqual({
      ok: false,
      reason: 'enqueueing user has no role record',
    });
  });
});
