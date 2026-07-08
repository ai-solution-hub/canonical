/**
 * ID-130.20 — standing coverage for `recompute_procurement_rollup(uuid)`.
 *
 * `procurement_workspaces.overall_outcome` (the {130.6} rollup) has had NO standing
 * automated test — it was validated direct-SQL-only because the table is
 * INTERNAL_ONLY (no api.* view; see 20260625140000_id130_winrate.sql's header) and
 * therefore unreachable through PostgREST. The {130.29} tactical fix
 * (20260708140000_id130_procurement_rollup_api_rpc.sql) added the sanctioned
 * `api.get_procurement_rollup` RPC read path — this suite is the coverage that read
 * path was added to unblock: it seeds `form_templates` rows (which fire the {130.6}
 * `form_templates_recompute_rollup` AFTER trigger — the SAME trigger the live PATCH
 * route relies on) across won / lost / withdrawn / mixed engagements, then reads
 * `overall_outcome` + `counts_toward_win_rate` back via `api.get_procurement_rollup`
 * (never a direct `procurement_workspaces` select, which 404s — that IS the {130.29}
 * bug).
 *
 * Derivation under test (AD-2, `recompute_procurement_rollup`,
 * 20260625130000_id130_rollup_fn.sql):
 *   - overall_outcome = 'won' if the latest final-award-stage form (form_type IN
 *     {itt,tender,bid,rfp} per the form_outcome_types CV) has outcome='won'.
 *   - overall_outcome = 'lost' if that form's outcome='lost', OR the engagement has
 *     any withdrawn form, OR any shortlist-stage form resolved 'not_shortlisted'.
 *   - overall_outcome = 'in_progress' otherwise.
 *   - counts_toward_win_rate = the engagement reached a counts_toward_win_rate=true
 *     form (final_award stage) with a terminal won/lost outcome.
 *   - Final-award precedence (the "mixed" case): a won final-award form resolves the
 *     engagement to 'won' even when an EARLIER shortlist-stage form on the SAME
 *     workspace resolved 'not_shortlisted' — the final-award check runs FIRST in the
 *     function's IF/ELSIF chain.
 *
 * Runs against the staging DB AFTER the Orchestrator applies BOTH the {130.6} rollup
 * migration (already applied) and the {130.29} RPC migration (pending apply). Skips
 * cleanly in network-isolated / placeholder-credential environments (same gate as
 * every other live integration test in this directory).
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from './helpers/supabase-client';

const TEST_TAG = `id130-rollup-recompute-${Date.now()}`;

// Seeded-row registry for teardown (delete order respects FKs).
const seeded = {
  formTemplateIds: [] as string[],
  workspaceIds: [] as string[],
  // form_types keys we INSERTED (only torn down if we created them — never delete a
  // pre-existing CV row the live system depends on).
  insertedFormTypeKeys: [] as string[],
};

let skip = false;

let db: Awaited<ReturnType<typeof createLiveServiceClient>>;

// One workspace per scenario (won/lost/withdrawn/mixed) so each engagement's rollup
// is independently assertable — mirrors the CARRY-2 isolation pattern
// id130-winrate-parity.integration.test.ts uses for the same reason (AD-2's
// final-award precedence would otherwise conflate two engagements sharing one
// workspace).
let wonWorkspaceId = '';
let lostWorkspaceId = '';
let withdrawnWorkspaceId = '';
let mixedWorkspaceId = '';

async function ensureFormType(key: string, label: string): Promise<void> {
  // Only seed if absent — never disturb a live CV row. Track inserts for teardown.
  const { data: existing, error: selErr } = await db
    .from('form_types')
    .select('key')
    .eq('key', key)
    .maybeSingle();
  if (selErr)
    throw new Error(`ensureFormType select(${key}): ${selErr.message}`);
  if (existing) return;

  const { error: insErr } = await db.from('form_types').insert({
    key,
    label,
    provenance: 'core',
    applicable_application_types: [],
  });
  if (insErr)
    throw new Error(`ensureFormType insert(${key}): ${insErr.message}`);
  seeded.insertedFormTypeKeys.push(key);
}

async function createWorkspace(
  applicationTypeId: string,
  label: string,
): Promise<string> {
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .insert({
      name: `[${TEST_TAG}] ${label}`,
      application_type_id: applicationTypeId,
    })
    .select('id')
    .single();
  if (wsErr || !ws) {
    throw new Error(
      `workspace insert (${label}): ${wsErr?.message ?? 'no data'}`,
    );
  }
  seeded.workspaceIds.push(ws.id);
  return ws.id;
}

/**
 * Insert a `form_templates` row. The {130.6} AFTER trigger
 * (`form_templates_recompute_rollup`) fires on this INSERT and recomputes the parent
 * workspace's `procurement_workspaces` rollup row synchronously — this is the SAME
 * write-triggered recompute path the live PATCH route
 * (app/api/procurement/[id]/route.ts) exercises when it updates a form's
 * outcome/workflow_state, so no explicit `recompute_procurement_rollup(uuid)` RPC
 * call is needed (nor possible from this api-schema-routed client: the recompute fn
 * is public-schema-only, never api-exposed — only the READ side got an RPC in
 * {130.29}).
 */
async function seedForm(args: {
  workspaceId: string;
  label: string;
  formType: string;
  outcome: string | null;
  workflowState: string;
  deadline?: string | null;
}): Promise<string> {
  const { data: ft, error: ftErr } = await db
    .from('form_templates')
    .insert({
      workspace_id: args.workspaceId,
      name: `[${TEST_TAG}] ${args.label}`,
      filename: `${TEST_TAG}-${args.label}.docx`,
      storage_path: `synthetic/${TEST_TAG}/${args.label}.docx`,
      file_size: 1,
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      form_type: args.formType,
      outcome: args.outcome,
      workflow_state: args.workflowState,
      deadline: args.deadline ?? null,
    })
    .select('id')
    .single();
  if (ftErr || !ft) {
    throw new Error(
      `seedForm(${args.label}) form_templates: ${ftErr?.message ?? 'no data'}`,
    );
  }
  seeded.formTemplateIds.push(ft.id);
  return ft.id;
}

/** Read the rollup back through the sanctioned {130.29} RPC — never a direct select. */
async function readRollup(workspaceId: string): Promise<{
  nearest_deadline: string | null;
  overall_outcome: string | null;
  counts_toward_win_rate: boolean | null;
  rollup_updated_at: string | null;
} | null> {
  const { data, error } = await db.rpc('get_procurement_rollup', {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`get_procurement_rollup: ${error.message}`);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] ?? null;
}

beforeAll(async () => {
  if (!hasRealLiveDbCredentials()) {
    skip = true;
    return;
  }
  db = await createLiveServiceClient();

  // 0. Network-isolation probe — a trivial read. If DNS to *.supabase.co fails, skip cleanly.
  const probe = await db.from('form_outcome_types').select('key').limit(1);
  if (isNetworkIsolationError(probe.error)) {
    skip = true;
    return;
  }
  if (probe.error) {
    throw new Error(`pre-flight read failed: ${probe.error.message}`);
  }

  // 1. Ensure the form_types CV rows the fixture FKs to exist (staging CV may be empty).
  await ensureFormType('itt', 'Invitation to Tender (ITT)');
  await ensureFormType('psq', 'Selection Questionnaire (SQ/PSQ)');

  // 2. Look up an application_type for the synthetic workspaces.
  const { data: appType, error: appErr } = await db
    .from('application_types')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (appErr) throw new Error(`application_types lookup: ${appErr.message}`);
  if (!appType) {
    throw new Error(
      'no application_types row available — cannot create a synthetic workspace',
    );
  }

  // 3. Four isolated workspaces, one per scenario.
  wonWorkspaceId = await createWorkspace(appType.id, 'won engagement');
  lostWorkspaceId = await createWorkspace(appType.id, 'lost engagement');
  withdrawnWorkspaceId = await createWorkspace(
    appType.id,
    'withdrawn engagement',
  );
  mixedWorkspaceId = await createWorkspace(appType.id, 'mixed engagement');

  // 4. WON — single final-award itt form, outcome='won'.
  await seedForm({
    workspaceId: wonWorkspaceId,
    label: 'won-itt',
    formType: 'itt',
    outcome: 'won',
    workflowState: 'won',
    deadline: '2026-01-15T00:00:00Z',
  });

  // 5. LOST — single final-award itt form, outcome='lost'.
  await seedForm({
    workspaceId: lostWorkspaceId,
    label: 'lost-itt',
    formType: 'itt',
    outcome: 'lost',
    workflowState: 'lost',
    deadline: '2026-01-20T00:00:00Z',
  });

  // 6. WITHDRAWN — single final-award itt form, workflow_state='withdrawn',
  //    outcome=NULL (AD-4: withdrawn is a workflow terminal, not an outcome — the
  //    live PATCH route clears outcome to NULL on this transition; no
  //    form_outcome_types row for 'withdrawn' exists at all).
  await seedForm({
    workspaceId: withdrawnWorkspaceId,
    label: 'withdrawn-itt',
    formType: 'itt',
    outcome: null,
    workflowState: 'withdrawn',
    deadline: '2026-02-01T00:00:00Z',
  });

  // 7. MIXED — a shortlist-stage psq form resolved 'not_shortlisted' (which ALONE
  //    would resolve the engagement to 'lost') PLUS a final-award itt form that
  //    won. Asserts the final-award-outcome check's ABSOLUTE precedence in the
  //    function's IF/ELSIF chain (checked before the withdrawn/not_shortlisted
  //    lost-signals).
  await seedForm({
    workspaceId: mixedWorkspaceId,
    label: 'mixed-psq-not-shortlisted',
    formType: 'psq',
    outcome: 'not_shortlisted',
    workflowState: 'lost',
    deadline: '2026-01-01T00:00:00Z',
  });
  await seedForm({
    workspaceId: mixedWorkspaceId,
    label: 'mixed-itt-won',
    formType: 'itt',
    outcome: 'won',
    workflowState: 'won',
    deadline: '2026-01-10T00:00:00Z',
  });
}, 60_000);

afterAll(async () => {
  if (skip || !db) return;
  // Deleting the forms fires the rollup trigger again (recomputes/clears the
  // workspace rollup) — children first.
  if (seeded.formTemplateIds.length) {
    await db.from('form_templates').delete().in('id', seeded.formTemplateIds);
  }
  // Deleting the workspaces cascades their procurement_workspaces rollup rows
  // (procurement_workspaces_workspace_id_fkey is ON DELETE CASCADE) — that
  // satellite is INTERNAL_ONLY (no api view) so it cannot be deleted directly
  // through PostgREST anyway.
  if (seeded.workspaceIds.length) {
    await db.from('workspaces').delete().in('id', seeded.workspaceIds);
  }
  // Only delete form_types rows WE inserted — never a pre-existing CV row.
  if (seeded.insertedFormTypeKeys.length) {
    await db.from('form_types').delete().in('key', seeded.insertedFormTypeKeys);
  }
}, 60_000);

describe('ID-130.20 recompute_procurement_rollup — standing coverage via api.get_procurement_rollup', () => {
  it('derives overall_outcome="won" + counts_toward_win_rate=true for a won final-award engagement', async () => {
    if (skip) return;

    const rollup = await readRollup(wonWorkspaceId);
    expect(rollup).not.toBeNull();
    expect(rollup!.overall_outcome).toBe('won');
    expect(rollup!.counts_toward_win_rate).toBe(true);
  });

  it('derives overall_outcome="lost" + counts_toward_win_rate=true for a lost final-award engagement', async () => {
    if (skip) return;

    const rollup = await readRollup(lostWorkspaceId);
    expect(rollup).not.toBeNull();
    expect(rollup!.overall_outcome).toBe('lost');
    expect(rollup!.counts_toward_win_rate).toBe(true);
  });

  it('derives overall_outcome="lost" + counts_toward_win_rate=false for a withdrawn engagement (no terminal final-award outcome)', async () => {
    if (skip) return;

    const rollup = await readRollup(withdrawnWorkspaceId);
    expect(rollup).not.toBeNull();
    expect(rollup!.overall_outcome).toBe('lost');
    // Withdrawn carries no won/lost outcome on any counts_toward_win_rate=true form
    // — it must NOT contribute to the win-rate denominator.
    expect(rollup!.counts_toward_win_rate).toBe(false);
  });

  it('derives overall_outcome="won" for a mixed engagement (final-award precedence over an earlier shortlist not_shortlisted signal)', async () => {
    if (skip) return;

    const rollup = await readRollup(mixedWorkspaceId);
    expect(rollup).not.toBeNull();
    // The not_shortlisted psq form ALONE would resolve to 'lost' — the won itt
    // final-award form must take precedence.
    expect(rollup!.overall_outcome).toBe('won');
    expect(rollup!.counts_toward_win_rate).toBe(true);
  });

  it('reads via the sanctioned api.get_procurement_rollup RPC, never a direct procurement_workspaces select (the {130.29} 404 this coverage exercises)', async () => {
    if (skip) return;

    // A direct base-table select is exactly what 404d before {130.29} — this table
    // has no api.* view (INTERNAL_ONLY). Confirms the read surface this suite (and
    // the live route) depends on actually resolves through PostgREST.
    const { data, error } = await db.rpc('get_procurement_rollup', {
      p_workspace_id: wonWorkspaceId,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data) ? data.length : data ? 1 : 0).toBeGreaterThan(0);
  });
});
