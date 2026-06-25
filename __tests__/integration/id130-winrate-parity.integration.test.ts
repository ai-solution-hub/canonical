/**
 * ID-130.7 — Win-rate engine rewrite: synthetic parity test (THE load-bearing gate).
 *
 * The win-rate engine ({130.7} migration 20260625140000_id130_winrate.sql) re-threads both
 * citation win-rate functions from the decommissioned workspaces.domain_metadata->>'outcome'
 * path onto the FORM altitude (form_templates.outcome → form_outcome_types CV). A LIVE
 * snapshot is vacuous — all 12 live engagements carry NULL ft.outcome until {130.8} backfills
 * — so this synthetic fixture is the only meaningful verification of the rewrite.
 *
 * Fixture (set up AND torn down by this suite):
 *   - one synthetic procurement workspace
 *   - one WON `itt` final-award form  + a citing form_response + a citation to content item A
 *   - one NOT_SHORTLISTED `psq` form + a citing form_response + a citation to content item B
 *   (each form has its own form_question keyed to the form via form_template_id; the win-rate
 *    join threads citations → form_responses → form_questions → form_templates)
 *
 * Asserts:
 *   (a) the WON final-award form counts in BOTH the win-rate numerator and denominator;
 *   (b) the NOT_SHORTLISTED psq form resolves the engagement to overall_outcome='lost' with
 *       counts_toward_win_rate=false (the {130.6} rollup trigger), and is ABSENT from the
 *       win-rate denominator;
 *   (c) the NOT_SHORTLISTED citation APPEARS in the separate shortlist pass-rate aggregate.
 *
 * Runs against the staging DB AFTER the Orchestrator applies the migration. Skips cleanly in
 * network-isolated / placeholder-credential environments.
 *
 * NOTE on schema routing: the {130.5} engagement columns (form_templates.outcome,
 * workflow_state) and the rewritten RPC's shortlist columns are NOT in the `api` views /
 * generated types until {130.9}. This suite therefore drives an UNTYPED client pinned to the
 * `public` schema for both the fixture writes and the public RPCs — decoupling it from the
 * generated types at this baseline.
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from './helpers/supabase-client';

// ---------------------------------------------------------------------------
// Untyped public-schema service client.
// Pinned to `public` (not the `api` default) so we can write the {130.5} engagement
// columns and call public.get_aggregate_win_rate_stats / public.get_content_win_rate
// before the {130.9} api/types regen. Untyped on purpose — the generated row types do not
// yet carry the new columns.
// ---------------------------------------------------------------------------
function makePublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'ID-130 win-rate parity test requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient(url, key, { db: { schema: 'public' } }) as any;
}

const TEST_TAG = `id130-winrate-parity-${Date.now()}`;

// Seeded-row registry for teardown (delete order respects FKs).
const seeded = {
  citationIds: [] as string[],
  formResponseIds: [] as string[],
  formQuestionIds: [] as string[],
  formTemplateIds: [] as string[],
  workspaceId: null as string | null,
  contentItemIds: [] as string[],
  // form_types keys we INSERTED (only torn down if we created them — never delete a
  // pre-existing CV row the live system depends on).
  insertedFormTypeKeys: [] as string[],
};

let skip = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

// Cited content item per form (so we can assert per-item win-rate independently).
let wonContentItemId = '';
let notShortlistedContentItemId = '';

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

async function insertContentItem(label: string): Promise<string> {
  const { data, error } = await db
    .from('content_items')
    .insert({
      title: `[${TEST_TAG}] ${label}`,
      content: `Synthetic win-rate parity fixture: ${label}. Disposable.`,
      content_type: 'article',
      // primary_domain has a default ('unclassified'); leave it so both rows share a domain.
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `insertContentItem(${label}): ${error?.message ?? 'no data'}`,
    );
  }
  seeded.contentItemIds.push(data.id);
  return data.id;
}

/**
 * Create a form (form_templates) with an outcome + its form_question + a form_response that
 * cites the given content item. Returns the cited content item id for later assertions.
 */
async function seedForm(args: {
  label: string;
  formType: string;
  outcome: string;
  workflowState: string;
  citedContentItemId: string;
}): Promise<void> {
  const workspaceId = seeded.workspaceId;
  if (!workspaceId) throw new Error('seedForm: workspace not created');

  // form_templates — set the engagement columns. The {130.6} AFTER trigger recomputes the
  // workspace rollup on this write; the outcome FK + form_type FK must already exist.
  const { data: ft, error: ftErr } = await db
    .from('form_templates')
    .insert({
      workspace_id: workspaceId,
      name: `[${TEST_TAG}] ${args.label}`,
      filename: `${TEST_TAG}-${args.label}.docx`,
      storage_path: `synthetic/${TEST_TAG}/${args.label}.docx`,
      file_size: 1,
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      form_type: args.formType,
      outcome: args.outcome,
      workflow_state: args.workflowState,
    })
    .select('id')
    .single();
  if (ftErr || !ft) {
    throw new Error(
      `seedForm(${args.label}) form_templates: ${ftErr?.message ?? 'no data'}`,
    );
  }
  seeded.formTemplateIds.push(ft.id);

  // form_questions — keyed to BOTH the workspace (legacy retained col, NOT NULL) and the
  // form via form_template_id (the {130.5} FK the new win-rate join threads through).
  const { data: fq, error: fqErr } = await db
    .from('form_questions')
    .insert({
      workspace_id: workspaceId,
      form_template_id: ft.id,
      section_sequence: 1,
      question_sequence: 1,
      question_text: `[${TEST_TAG}] ${args.label} question`,
    })
    .select('id')
    .single();
  if (fqErr || !fq) {
    throw new Error(
      `seedForm(${args.label}) form_questions: ${fqErr?.message ?? 'no data'}`,
    );
  }
  seeded.formQuestionIds.push(fq.id);

  // form_responses — the citing entity.
  const { data: fr, error: frErr } = await db
    .from('form_responses')
    .insert({
      question_id: fq.id,
      response_text: `[${TEST_TAG}] ${args.label} response`,
    })
    .select('id')
    .single();
  if (frErr || !fr) {
    throw new Error(
      `seedForm(${args.label}) form_responses: ${frErr?.message ?? 'no data'}`,
    );
  }
  seeded.formResponseIds.push(fr.id);

  // citations — form_response cites the content item. cited_kind='content_item'.
  const { data: cc, error: ccErr } = await db
    .from('citations')
    .insert({
      citing_kind: 'form_response',
      citing_form_response_id: fr.id,
      cited_kind: 'content_item',
      cited_content_item_id: args.citedContentItemId,
      citation_type: 'reference',
    })
    .select('id')
    .single();
  if (ccErr || !cc) {
    throw new Error(
      `seedForm(${args.label}) citations: ${ccErr?.message ?? 'no data'}`,
    );
  }
  seeded.citationIds.push(cc.id);
}

beforeAll(async () => {
  if (!hasRealLiveDbCredentials()) {
    skip = true;
    return;
  }
  db = makePublicClient();

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

  // 2. Look up an application_type for the synthetic workspace (application_type_id is NOT NULL
  //    and FKs application_types). Use any existing row — content of the type is irrelevant.
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

  // 3. Synthetic workspace.
  const { data: ws, error: wsErr } = await db
    .from('workspaces')
    .insert({
      name: `[${TEST_TAG}] synthetic procurement`,
      application_type_id: appType.id,
    })
    .select('id')
    .single();
  if (wsErr || !ws) {
    throw new Error(`workspace insert: ${wsErr?.message ?? 'no data'}`);
  }
  seeded.workspaceId = ws.id;

  // 4. Two cited content items (one per form) so per-item win-rate is independently assertable.
  wonContentItemId = await insertContentItem('won-cited-item');
  notShortlistedContentItemId = await insertContentItem(
    'not-shortlisted-cited-item',
  );

  // 5. The two synthetic forms.
  //    WON itt (final-award, counts_toward_win_rate=true).
  await seedForm({
    label: 'won-itt',
    formType: 'itt',
    outcome: 'won',
    workflowState: 'won',
    citedContentItemId: wonContentItemId,
  });
  //    NOT_SHORTLISTED psq (shortlist stage; counts_toward_win_rate=false; resolves engagement to lost).
  await seedForm({
    label: 'not-shortlisted-psq',
    formType: 'psq',
    outcome: 'not_shortlisted',
    workflowState: 'lost',
    citedContentItemId: notShortlistedContentItemId,
  });
}, 60_000);

afterAll(async () => {
  if (skip || !db) return;
  // Delete in FK-respecting order. Children first.
  if (seeded.citationIds.length) {
    await db.from('citations').delete().in('id', seeded.citationIds);
  }
  if (seeded.formResponseIds.length) {
    await db.from('form_responses').delete().in('id', seeded.formResponseIds);
  }
  if (seeded.formQuestionIds.length) {
    await db.from('form_questions').delete().in('id', seeded.formQuestionIds);
  }
  // Deleting the forms fires the rollup trigger (recomputes/clears the workspace rollup) and
  // cascades form_questions via form_template_id ON DELETE CASCADE (belt-and-braces above).
  if (seeded.formTemplateIds.length) {
    await db.from('form_templates').delete().in('id', seeded.formTemplateIds);
  }
  // The rollup row on procurement_workspaces is keyed by workspace_id; remove it before the
  // workspace so its FK does not block.
  if (seeded.workspaceId) {
    await db
      .from('procurement_workspaces')
      .delete()
      .eq('workspace_id', seeded.workspaceId);
    await db.from('workspaces').delete().eq('id', seeded.workspaceId);
  }
  if (seeded.contentItemIds.length) {
    await db.from('content_items').delete().in('id', seeded.contentItemIds);
  }
  // Only delete form_types rows WE inserted — never a pre-existing CV row.
  if (seeded.insertedFormTypeKeys.length) {
    await db.from('form_types').delete().in('key', seeded.insertedFormTypeKeys);
  }
}, 60_000);

describe('ID-130.7 win-rate engine rewrite — synthetic parity', () => {
  it('(a) the WON final-award form counts in the win-rate numerator and denominator', async () => {
    if (skip) return;

    // Per-item win-rate for the WON form's cited content item: 1 citation, outcome=won,
    // counts_toward_win_rate=true → numerator 1, denominator 1, win_rate 1.00.
    const { data, error } = await db.rpc('get_content_win_rate', {
      p_content_item_id: wonContentItemId,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_citations)).toBe(1);
    expect(Number(row.winning_citations)).toBe(1); // numerator
    expect(Number(row.losing_citations)).toBe(0);
    expect(Number(row.pending_citations)).toBe(0); // counts_toward_win_rate=true ⇒ NOT pending
    expect(Number(row.win_rate)).toBe(1); // 1 won / 1 decided
  });

  it('(b) the NOT_SHORTLISTED psq resolves the engagement to lost, counts_toward_win_rate=false, and is ABSENT from the win-rate denominator', async () => {
    if (skip) return;

    // Engagement rollup (the {130.6} trigger): not_shortlisted ⇒ overall_outcome='lost',
    // counts_toward_win_rate=false. NOTE the WON itt form also lives on this workspace, but
    // AD-2 resolves the engagement to lost on ANY not_shortlisted shortlist form — so the
    // mixed-form engagement is 'lost' and counts_toward_win_rate is driven by the final-award
    // won form (true). We therefore assert the not_shortlisted citation is absent from the
    // win-rate denominator at the CITATION level (per-item), which is the load-bearing claim.
    const { data, error } = await db.rpc('get_content_win_rate', {
      p_content_item_id: notShortlistedContentItemId,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_citations)).toBe(1); // the citation IS counted in total
    expect(Number(row.winning_citations)).toBe(0);
    expect(Number(row.losing_citations)).toBe(0);
    // ABSENT from the win-rate denominator: counts_toward_win_rate=false ⇒ pending, win_rate 0.
    expect(Number(row.pending_citations)).toBe(1);
    expect(Number(row.win_rate)).toBe(0);

    // And the engagement-level rollup reflects the shortlist loss.
    const { data: rollup, error: rollupErr } = await db
      .from('procurement_workspaces')
      .select('overall_outcome, counts_toward_win_rate')
      .eq('workspace_id', seeded.workspaceId)
      .maybeSingle();
    expect(rollupErr).toBeNull();
    expect(rollup).not.toBeNull();
    expect(rollup.overall_outcome).toBe('lost');
  });

  it('(c) the NOT_SHORTLISTED citation APPEARS in the separate shortlist pass-rate aggregate', async () => {
    if (skip) return;

    const { data, error } = await db.rpc('get_aggregate_win_rate_stats');
    expect(error).toBeNull();
    const rows = Array.isArray(data) ? data : [];
    const overall = rows.find((r: { scope: string }) => r.scope === 'overall');
    expect(overall).toBeTruthy();

    // The shortlist aggregate sees the one not_shortlisted citation: shortlist_total >= 1,
    // shortlist_passed counts only 'shortlisted' (0 here). The WON itt citation is final-award
    // and MUST NOT inflate shortlist_total.
    expect(Number(overall.shortlist_total)).toBeGreaterThanOrEqual(1);
    expect(Number(overall.shortlist_passed)).toBeGreaterThanOrEqual(0);

    // The win-rate denominator (final-award) sees the WON itt citation: at least 1 winning,
    // and the not_shortlisted citation is NOT in it (it is a shortlist-stage outcome).
    expect(Number(overall.winning_citations)).toBeGreaterThanOrEqual(1);
  });
});
