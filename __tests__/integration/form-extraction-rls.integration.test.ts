/**
 * Integration test — ID-52 PRODUCT Inv-25 (RLS on form instances), RE-KEYED
 * post-{145.6} W1c (S474 gate sweep, {145.23}).
 *
 * Subtask ID-52.13 (S278 — Wave-3) originally sanity-checked the EXISTING RLS
 * on `form_templates` / `form_template_fields`: a viewer of workspace A must
 * NOT be able to SELECT workspace B's `form_templates` rows, while the global
 * catalogue (`form_template_requirements`) is visible regardless of
 * workspace.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ✅ SUPERSEDED — the {52.13} escalation is resolved by the {145.6} redesign,
 * not by a policy fix
 * ───────────────────────────────────────────────────────────────────────────
 * The original {52.13} escalation (below, kept for provenance) flagged that
 * the live `form_templates` SELECT policy was `USING (true)` (role-gated
 * only), contradicting Inv-25's workspace-scoping requirement. ID-145 {145.6}
 * W1c (20260712062000_id145_w1c_rename_reshape.sql STEP 1) did not "fix" that
 * policy — it removed the premise: `form_instances.workspace_id` is DROPPED
 * entirely (BI-1 — "the item IS the form; no second workspace-mediated home
 * for its lifecycle facts"). The old `form_templates_select` policy was
 * explicitly DROPPED and replaced with:
 *
 *     CREATE POLICY "form_instances_select" ON "public"."form_instances"
 *       FOR SELECT TO "authenticated" USING (true);
 *
 * i.e. "any authenticated member may read" — matching the house pattern
 * already used by sibling non-tenant-scoped tables (source documents,
 * citations). Inv-25's literal workspace-scoping requirement is therefore
 * ARCHITECTURALLY INAPPLICABLE post-{145.6} (no workspace concept survives on
 * form_instances to scope against) — this is a deliberate design decision
 * (BI-1), not the same missing-policy bug the original {52.13} escalation
 * flagged. Whether Inv-25 itself should be formally superseded in
 * docs/specs/id-52-form-extraction/PRODUCT.md is a spec-amendment call for
 * the Orchestrator/Curator, not decided here — this file only re-keys the
 * test to the empirically-verified live policy (`form_instances_select`,
 * migration STEP 1 above) so it stops encoding a requirement the schema can
 * no longer satisfy.
 *
 * This test now asserts the POSITIVE regression-guard shape: an authenticated
 * viewer CAN read a form_instances row regardless of which (former) workspace
 * it would have belonged to, and the global catalogue read stays ungated.
 * Both guard against a future accidental re-introduction of workspace
 * scoping (or an accidental RLS lockout) rather than testing scoping itself.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ⚠ ORIGINAL ESCALATION (S278, kept for provenance — see the SUPERSEDED note
 * above for current disposition)
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
 * Per the {52.13} dispatch brief ("If the RLS test reveals a missing/incorrect
 * policy → STOP and escalate; do NOT author a policy migration"), this was
 * ESCALATED to the Orchestrator → Liam. No policy migration was authored at
 * {52.13} — {145.6} superseded the question entirely (see above).
 *
 * References:
 *   - docs/specs/id-52-form-extraction/PRODUCT.md Inv-25 (+ Inv-23 catalogue
 *     has no workspace FK).
 *   - docs/specs/id-52-form-extraction/TECH.md §3.1 (Inv-25 row).
 *   - supabase/migrations/20260712062000_id145_w1c_rename_reshape.sql STEP 1
 *     (workspace_id DROP + form_instances_select `USING (true)` policy).
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

// Two synthetic rows — no workspace concept survives on form_instances
// post-{145.6} (workspace_id DROPPED), so these are plain fixture rows, not
// workspace-scoped fixtures. Names retained (TEMPLATE_A/B) for minimal diff
// against the {52.13} original.
const TEMPLATE_A_ID = '52131111-0000-4000-8000-0000000000a1';
const TEMPLATE_B_ID = '52131111-0000-4000-8000-0000000000b1';

beforeAll(async () => {
  if (!ENABLED) return;
  // Seed two form_instances rows via the service-role client (bypasses RLS
  // for setup). The viewer-JWT client below then exercises the SELECT policy
  // against these seeded rows.
  const admin = await createLiveServiceClient();
  await admin.from('form_instances').upsert([
    {
      id: TEMPLATE_A_ID,
      name: `[52.13-RLS-A-${RUN}] template A`,
      filename: 'rls-a.pdf',
      file_size: 1,
      mime_type: 'application/pdf',
      storage_path: `id-52-13-rls-ws-a/${RUN}/rls-a.pdf`,
      processing_status: 'analysed',
      ingest_source: 'app_upload',
    },
    {
      id: TEMPLATE_B_ID,
      name: `[52.13-RLS-B-${RUN}] template B`,
      filename: 'rls-b.pdf',
      file_size: 1,
      mime_type: 'application/pdf',
      storage_path: `id-52-13-rls-ws-b/${RUN}/rls-b.pdf`,
      processing_status: 'analysed',
      ingest_source: 'app_upload',
    },
  ]);
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  const admin = await createLiveServiceClient();
  await admin
    .from('form_instances')
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
  const { DB_OPTION } = await import('@/lib/supabase/schema');
  // ID-115 (S9): route to the exposed api schema
  const viewer = createClient(url, anonKey, { ...DB_OPTION });
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
  'ID-52 Inv-25 — form_instances RLS (post-{145.6}: unscoped authenticated read, by design)',
  () => {
    it('an authenticated viewer CAN SELECT a form_instances row regardless of which prior workspace it would have belonged to (form_instances_select USING (true))', async () => {
      const viewer = await createViewerScopedClient();
      if (!viewer) {
        // No viewer creds — cannot exercise the policy. Treated as a clean
        // skip within the ENABLED suite.
        return;
      }

      // {145.6} BI-1: form_instances has no workspace_id to scope against —
      // the form_instances_select policy grants read to any authenticated
      // member. This is a positive regression guard: it fails loudly if a
      // future migration re-locks the table down without updating this test.
      const { data: bRows, error: bErr } = await viewer
        .from('form_instances')
        .select('id')
        .eq('id', TEMPLATE_B_ID);
      expect(bErr).toBeNull();
      expect(
        bRows?.length ?? 0,
        'form_instances_select (USING (true)) must permit any authenticated read',
      ).toBe(1);
    }, 60_000);

    it('the global catalogue (form_requirement_templates) is visible regardless of workspace (Inv-23/Inv-25)', async () => {
      const viewer = await createViewerScopedClient();
      if (!viewer) return;

      // The catalogue carries no workspace FK (Inv-23) and is a shared
      // platform resource (Inv-25). A bare SELECT must succeed (no
      // workspace-scoping error); row count is not asserted (the catalogue
      // may be empty in this env) — the load-bearing check is that the read
      // is permitted, not workspace-gated.
      const { error } = await viewer
        .from('form_requirement_templates')
        .select('id')
        .limit(1);
      expect(
        error,
        'Inv-25: the global catalogue read must not be workspace-gated',
      ).toBeNull();
    }, 60_000);
  },
);
