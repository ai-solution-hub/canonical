/**
 * S214 WP-RLS-44 — pipeline_runs admin UPDATE integration test.
 *
 * Verifies that an authenticated admin client can UPDATE/DELETE
 * `pipeline_runs` rows directly (post-migration
 * `20260430123704_pipeline_runs_rls_update_delete_policies.sql`),
 * and that an editor client is silently 0-row denied — the existing
 * latent failure mode that masked the taxonomy-sync route bug.
 *
 * Background: pre-S214, `pipeline_runs` had only INSERT (admin) + SELECT
 * (open) RLS policies. UPDATE + DELETE had no policy, so auth-scoped
 * clients silently 0-row denied (PostgREST returns 200 / 0 rows).
 * `app/api/admin/taxonomy-sync/{route,status}.ts` UPDATEs through
 * `getAuthorisedClient(['admin'])` and was silently broken — admin sync
 * runs left `pipeline_runs.status='running'` forever. The migration adds
 * admin UPDATE + admin DELETE policies (mirroring `pipeline_runs_insert`).
 * service_role writers (cron handlers, MCP tools, Python pipeline
 * helpers) continue to bypass RLS structurally.
 *
 * @vitest-environment node
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars.
import { serviceClient } from './helpers/service-client';
import {
  cacheAllTestUserSessions,
  restoreSession,
  type AuthCookieStore,
  type AuthCookieEntry,
  type CachedSessions,
} from './helpers/auth-session';

// ---------------------------------------------------------------------------
// File-scope cookie mock — same pattern as
// items-patch-publication-status.integration.test.ts.
// ---------------------------------------------------------------------------

const { authCookies, cachedSessions } = vi.hoisted(() => ({
  authCookies: new Map<
    string,
    { name: string; value: string }
  >() as AuthCookieStore,
  cachedSessions: {
    admin: new Map(),
    editor: new Map(),
    viewer: new Map(),
  } as unknown as CachedSessions,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      Array.from(authCookies.values()).map(
        ({ name, value }): AuthCookieEntry => ({ name, value }),
      ),
    get: (name: string) => authCookies.get(name),
    set: (name: string, value: string) => {
      authCookies.set(name, { name, value });
    },
  }),
}));

// Import the auth helper AFTER the mock is registered.
const { getAuthorisedClient } = await import('@/lib/auth/client');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `wp-rls-44-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const seededIds: string[] = [];

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.TEST_USER_1_PASSWORD &&
  process.env.TEST_USER_2_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedPipelineRun(label: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('pipeline_runs')
    .insert({
      pipeline_name: `${TEST_PREFIX}_${label}`,
      status: 'running',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed pipeline_runs "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  seededIds.push(data.id);
  return data.id;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  await cacheAllTestUserSessions(cachedSessions);
}, 30_000);

beforeEach(() => {
  authCookies.clear();
});

afterAll(async () => {
  if (seededIds.length === 0) return;
  await serviceClient.from('pipeline_runs').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfEnv(
  'pipeline_runs RLS UPDATE/DELETE policies (S214 WP-RLS-44)',
  () => {
    it('admin auth-scoped client can UPDATE pipeline_runs (closes taxonomy-sync silent-deny bug)', async () => {
      const runId = await seedPipelineRun('admin-update-happy');
      restoreSession(authCookies, cachedSessions, 'admin');

      const auth = await getAuthorisedClient(['admin']);
      expect(auth.success).toBe(true);
      if (!auth.success) throw new Error('admin auth failed');

      const completedAt = new Date().toISOString();
      const { data, error } = await auth.supabase
        .from('pipeline_runs')
        .update({
          status: 'completed',
          completed_at: completedAt,
          items_processed: 7,
        })
        .eq('id', runId)
        .select('id, status, completed_at, items_processed');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.status).toBe('completed');
      expect(data?.[0]?.items_processed).toBe(7);

      // DB-side verification (via service client, bypasses RLS).
      const { data: verify } = await serviceClient
        .from('pipeline_runs')
        .select('status, completed_at, items_processed')
        .eq('id', runId)
        .single();
      expect(verify?.status).toBe('completed');
      expect(verify?.items_processed).toBe(7);
      // Postgres returns timestamps as `+00:00`, supabase-js sends `Z` —
      // compare instants, not literal strings.
      expect(new Date(verify!.completed_at as string).getTime()).toBe(
        new Date(completedAt).getTime(),
      );
    });

    it('editor auth-scoped client UPDATE silently 0-row denies (admin-only policy)', async () => {
      const runId = await seedPipelineRun('editor-update-deny');
      restoreSession(authCookies, cachedSessions, 'editor');

      const auth = await getAuthorisedClient(['admin', 'editor']);
      expect(auth.success).toBe(true);
      if (!auth.success) throw new Error('editor auth failed');

      const { data, error } = await auth.supabase
        .from('pipeline_runs')
        .update({ status: 'completed' })
        .eq('id', runId)
        .select('id, status');

      // RLS UPDATE deny under PostgREST → 200 / empty result, no error.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // Status remains 'running' on disk.
      const { data: verify } = await serviceClient
        .from('pipeline_runs')
        .select('status')
        .eq('id', runId)
        .single();
      expect(verify?.status).toBe('running');
    });

    it('admin auth-scoped client can DELETE pipeline_runs', async () => {
      const runId = await seedPipelineRun('admin-delete');
      restoreSession(authCookies, cachedSessions, 'admin');

      const auth = await getAuthorisedClient(['admin']);
      expect(auth.success).toBe(true);
      if (!auth.success) throw new Error('admin auth failed');

      const { data, error } = await auth.supabase
        .from('pipeline_runs')
        .delete()
        .eq('id', runId)
        .select('id');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: verify } = await serviceClient
        .from('pipeline_runs')
        .select('id')
        .eq('id', runId)
        .maybeSingle();
      expect(verify).toBeNull();

      // Already gone — drop from seededIds so afterAll doesn't try again.
      const idx = seededIds.indexOf(runId);
      if (idx >= 0) seededIds.splice(idx, 1);
    });

    it('editor auth-scoped client DELETE silently 0-row denies', async () => {
      const runId = await seedPipelineRun('editor-delete-deny');
      restoreSession(authCookies, cachedSessions, 'editor');

      const auth = await getAuthorisedClient(['admin', 'editor']);
      expect(auth.success).toBe(true);
      if (!auth.success) throw new Error('editor auth failed');

      const { data, error } = await auth.supabase
        .from('pipeline_runs')
        .delete()
        .eq('id', runId)
        .select('id');

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: verify } = await serviceClient
        .from('pipeline_runs')
        .select('id')
        .eq('id', runId)
        .maybeSingle();
      expect(verify?.id).toBe(runId);
    });
  },
);
