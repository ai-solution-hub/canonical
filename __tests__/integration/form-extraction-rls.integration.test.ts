/**
 * Integration test — ID-52 PRODUCT Inv-25 (workspace scoping on form instances).
 *
 * Subtask ID-52.13 (S278 — Wave-3). Sanity-checks the EXISTING RLS on
 * `form_templates` / `form_template_fields`: a viewer of workspace A must NOT
 * be able to SELECT workspace B's `form_templates` rows, while the global
 * catalogue (`form_template_requirements`) is visible regardless of workspace.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠ ESCALATION — Inv-25 vs CURRENT LIVE RLS (empirically confirmed, S278)
 * ───────────────────────────────────────────────────────────────────────────
 * During authoring, the live staging `form_templates` SELECT policy was probed
 * with a real viewer-role JWT (test.user3, `get_user_role()='viewer'`) against
 * a service-role-seeded row in a workspace the viewer is not scoped to. RESULT:
 * the viewer COULD SELECT the cross-workspace row.
 *
 * Root cause: `form_templates` was renamed from `templates`
 * (migration 20260520120828, SUB-TASK 2) and inherited the original
 * `templates_select` policy:
 *
 *     CREATE POLICY "templates_select" ON public.templates
 *       FOR SELECT TO authenticated USING (true);
 *
 * `USING (true)` is ROLE-gated (any authenticated user), NOT workspace-scoped.
 * No later migration overrides it. This CONTRADICTS Inv-25's requirement that
 * "a viewer of workspace A cannot SELECT `form_templates` rows from workspace
 * B".
 *
 * Per the {52.13} dispatch brief ("If the RLS test reveals a missing/incorrect
 * policy → STOP and escalate; do NOT author a policy migration"), this is
 * ESCALATED to the Orchestrator → Liam. No policy migration is authored here.
 *
 * This test ENCODES Inv-25's REQUIRED behaviour (cross-workspace denial) so it
 * is the durable artefact that PASSES once a workspace-scoped SELECT policy on
 * `form_templates` lands. It is gated behind the same fixture-staging ENABLED
 * gate as the sibling suite, so it SKIPS CLEAN in this environment (the
 * fixture-staging infra — OQ-53-FIXTURE-STAGING / backlog-191 — is unwired)
 * AND does not produce a false green against the current `USING (true)` policy.
 * When the policy is corrected and the infra wired, the assertions verify the
 * scoping; until then, the escalation above is the load-bearing record.
 *
 * References:
 *   - docs/specs/id-52-form-extraction/PRODUCT.md Inv-25 (+ Inv-23 catalogue
 *     has no workspace FK).
 *   - docs/specs/id-52-form-extraction/TECH.md §3.1 (Inv-25 row).
 *   - supabase/migrations/20260416102457_pre_squash_reconciliation.sql
 *     (`templates_select … USING (true)`).
 *   - supabase/migrations/20260520120828_t2_combined_pr_intel_shape_b_form_type_split.sql
 *     SUB-TASK 2 (templates → form_templates rename; policy inherited).
 *   - __tests__/integration/helpers/auth-session.ts (role-scoped sign-in).
 *   - docs/reference/test-philosophy.md (real-behaviour, not implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from './helpers/supabase-client';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Two distinct staging workspaces (mirror __tests__/fixtures/form-extraction/
// .kh-workspace-map.json). Workspace A is the one the viewer is scoped to;
// workspace B is the one the viewer must NOT see form_templates rows from.
const WORKSPACE_A = 'b0000000-0000-4000-8000-000000000001';
const WORKSPACE_B = '328ba316-4709-47b1-988a-86681975d620';

const TEMPLATE_A_ID = '52131111-0000-4000-8000-0000000000a1';
const TEMPLATE_B_ID = '52131111-0000-4000-8000-0000000000b1';

beforeAll(async () => {
  if (!ENABLED) return;
  // Seed one form_templates row in each workspace via the service-role client
  // (bypasses RLS for setup). The viewer-JWT client below then exercises the
  // SELECT policy against these seeded rows.
  const admin = await createLiveServiceClient();
  await admin.from('form_templates').upsert([
    {
      id: TEMPLATE_A_ID,
      workspace_id: WORKSPACE_A,
      name: `[52.13-RLS-A-${RUN}] template A`,
      filename: 'rls-a.pdf',
      file_size: 1,
      mime_type: 'application/pdf',
      storage_path: `id-52-13-rls-ws-a/${RUN}/rls-a.pdf`,
      status: 'analysed',
      ingest_source: 'pipeline',
    },
    {
      id: TEMPLATE_B_ID,
      workspace_id: WORKSPACE_B,
      name: `[52.13-RLS-B-${RUN}] template B`,
      filename: 'rls-b.pdf',
      file_size: 1,
      mime_type: 'application/pdf',
      storage_path: `id-52-13-rls-ws-b/${RUN}/rls-b.pdf`,
      status: 'analysed',
      ingest_source: 'pipeline',
    },
  ]);
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  const admin = await createLiveServiceClient();
  await admin
    .from('form_templates')
    .delete()
    .in('id', [TEMPLATE_A_ID, TEMPLATE_B_ID]);
}, 30_000);

/**
 * Build a viewer-role-scoped Supabase client (carries the viewer's JWT, so
 * RLS applies). Signs in as the seeded viewer test user. Returns null when
 * the publishable key / password env is absent (caller skips).
 */
async function createViewerScopedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const password = process.env.TEST_USER_3_PASSWORD;
  if (!url || !anonKey || !password) return null;
  const { createClient } = await import('@supabase/supabase-js');
  const viewer = createClient(url, anonKey);
  const { error } = await viewer.auth.signInWithPassword({
    email: 'test.user3@test-kb-aish.co.uk',
    password,
  });
  if (error) {
    throw new Error(
      `createViewerScopedClient: viewer sign-in failed: ${error.message}. ` +
        'Verify test.user3@test-kb-aish.co.uk is seeded and TEST_USER_3_PASSWORD is current.',
    );
  }
  return viewer;
}

describe.skipIf(!ENABLED)(
  'ID-52 Inv-25 — form-instance workspace scoping (RLS)',
  () => {
    it('a viewer of workspace A cannot SELECT workspace B form_templates rows', async () => {
      const viewer = await createViewerScopedClient();
      if (!viewer) {
        // No viewer creds — cannot exercise the policy. Treated as a clean
        // skip within the ENABLED suite.
        return;
      }

      // Inv-25 REQUIRED behaviour: the viewer must NOT see workspace B's row.
      const { data: bRows, error: bErr } = await viewer
        .from('form_templates')
        .select('id, workspace_id')
        .eq('id', TEMPLATE_B_ID);
      expect(bErr).toBeNull();
      expect(
        bRows?.length ?? 0,
        'Inv-25: a viewer scoped to workspace A must NOT SELECT workspace B form_templates rows',
      ).toBe(0);
    }, 60_000);

    it('the global catalogue (form_template_requirements) is visible regardless of workspace (Inv-23/Inv-25)', async () => {
      const viewer = await createViewerScopedClient();
      if (!viewer) return;

      // The catalogue carries no workspace FK (Inv-23) and is a shared
      // platform resource (Inv-25). A bare SELECT must succeed (no
      // workspace-scoping error); row count is not asserted (the catalogue
      // may be empty in this env) — the load-bearing check is that the read
      // is permitted, not workspace-gated.
      const { error } = await viewer
        .from('form_template_requirements')
        .select('id')
        .limit(1);
      expect(
        error,
        'Inv-25: the global catalogue read must not be workspace-gated',
      ).toBeNull();
    }, 60_000);
  },
);
