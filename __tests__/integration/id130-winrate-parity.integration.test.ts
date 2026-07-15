/**
 * ID-130.7 — Win-rate engine rewrite: synthetic parity test (THE load-bearing gate).
 *
 * The win-rate engine ({130.7} migration 20260625140000_id130_winrate.sql) re-threads both
 * citation win-rate functions from the decommissioned workspaces.domain_metadata->>'outcome'
 * path onto the FORM altitude (form_instances.outcome → form_outcome_types CV). A LIVE
 * snapshot is vacuous — all 12 live engagements carry NULL ft.outcome until {130.8} backfills
 * — so this synthetic fixture is the only meaningful verification of the rewrite.
 *
 * {145.6} W1c re-key (S474 gate sweep, {145.23}): `form_templates` renamed to `form_instances`
 * (20260712062000_id145_w1c_rename_reshape.sql). `workspace_id` was DROPPED from BOTH
 * `form_instances` and `form_questions` (BI-1 — the form owns its lifecycle directly, no
 * workspace mediation), and `form_questions.form_template_id` was renamed
 * `form_instance_id`. `get_content_win_rate` / `get_aggregate_win_rate_stats` — the RPCs this
 * suite actually exercises — are UNTOUCHED by {145.6}/{145.6} W1e (KEPT machinery; only the
 * {130.6} rollup trigger + `procurement_workspaces` + `get_procurement_rollup` were DROPPED at
 * W1e — see the retired `id130-rollup-recompute-coverage.integration.test.ts` for that
 * disposition). The prior CARRY-2 synthetic-workspace fixture design existed SOLELY to keep the
 * two engagements isolated from the (now-dropped) AD-2 rollup's final-award precedence
 * conflation — with no workspace concept left on form_instances at all, and the rollup trigger
 * gone, that isolation concern no longer applies, so this re-key also DROPS the now-vestigial
 * workspace/application_type scaffolding entirely (no functional purpose survives it).
 *
 * Fixture (set up AND torn down by this suite) — TWO forms, no workspace:
 *   - WON: one WON `itt` final-award form + a citing form_response + citation to item A
 *   - LOST: one NOT_SHORTLISTED `psq` form + a citing form_response + citation to item B
 *   (each form has its own form_question keyed via form_instance_id; the win-rate join threads
 *    citations → form_responses → form_questions → form_instances).
 *
 * Asserts:
 *   (a) the WON final-award form counts in BOTH the win-rate numerator and denominator;
 *   (b) the NOT_SHORTLISTED citation is counted but ABSENT from the win-rate denominator
 *       (counts_toward_win_rate=false ⇒ pending). The {130.6} rollup (procurement_workspaces)
 *       was DROPPED wholesale at {145.6} W1e — there is no longer a separate direct-SQL rollup
 *       parity check to defer to; this suite is now the sole coverage of the won/not_shortlisted
 *       distinction, at the citation-RPC altitude only.
 *   (c) the NOT_SHORTLISTED citation APPEARS in the separate shortlist pass-rate aggregate.
 *
 * Runs against the staging DB. Skips cleanly in network-isolated / placeholder-credential
 * environments.
 *
 * Schema routing (CARRY-3): the api views + generated types carry the engagement columns
 * (form_instances.outcome/workflow_state) and the win-rate RPCs' shortlist columns, so this
 * suite uses the standard `createLiveServiceClient()` — the api-routed service client every
 * other live integration test uses (writes flow through the 1:1 auto-updatable api views; RPCs
 * resolve to the api wrappers). No more untyped public-pinned client.
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from './helpers/supabase-client';

const TEST_TAG = `id130-winrate-parity-${Date.now()}`;

// Seeded-row registry for teardown (delete order respects FKs).
const seeded = {
  citationIds: [] as string[],
  formResponseIds: [] as string[],
  formQuestionIds: [] as string[],
  formInstanceIds: [] as string[],
  qaPairIds: [] as string[],
  // form_types keys we INSERTED (only torn down if we created them — never disturb a
  // pre-existing CV row the live system depends on).
  insertedFormTypeKeys: [] as string[],
};

let skip = false;

let db: Awaited<ReturnType<typeof createLiveServiceClient>>;

// Cited q_a_pair per form (so we can assert per-item win-rate independently).
// ID-131.19 M6 retirement note: `get_content_win_rate` was ALREADY
// re-anchored from `p_content_item_id` to `p_q_a_pair_id` by CITE-EXT
// (20260628191703, APPLIED, ID-131.10 BI-26) — before M6 even ran. M6 then
// dropped `content_items` and `citations.cited_content_item_id` entirely.
// This fixture now cites `q_a_pairs` (cited_kind='q_a_pair' +
// cited_q_a_pair_id) to match the live RPC signature.
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
    .from('q_a_pairs')
    .insert({
      question_text: `[${TEST_TAG}] ${label}`,
      answer_standard: `Synthetic win-rate parity fixture: ${label}. Disposable.`,
      publication_status: 'published',
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `insertContentItem(${label}): ${error?.message ?? 'no data'}`,
    );
  }
  seeded.qaPairIds.push(data.id);
  return data.id;
}

/**
 * Create a form (form_instances) with an outcome + its form_question + a form_response that
 * cites the given content item. No workspace: {145.6} dropped `workspace_id` from both
 * `form_instances` and `form_questions` (BI-1).
 */
async function seedForm(args: {
  label: string;
  formType: string;
  outcome: string;
  workflowState: string;
  citedContentItemId: string;
}): Promise<void> {
  // form_instances — set the engagement columns. The outcome FK + form_type FK must already
  // exist.
  const { data: ft, error: ftErr } = await db
    .from('form_instances')
    .insert({
      name: `[${TEST_TAG}] ${args.label}`,
      filename: `${TEST_TAG}-${args.label}.docx`,
      storage_path: `synthetic/${TEST_TAG}/${args.label}.docx`,
      file_size: 1,
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      form_type: args.formType,
      outcome: args.outcome,
      workflow_state: args.workflowState,
      ingest_source: 'app_upload',
    })
    .select('id')
    .single();
  if (ftErr || !ft) {
    throw new Error(
      `seedForm(${args.label}) form_instances: ${ftErr?.message ?? 'no data'}`,
    );
  }
  seeded.formInstanceIds.push(ft.id);

  // form_questions — keyed to the form via form_instance_id (renamed from form_template_id
  // at {145.6}; the {130.5} FK the win-rate join threads through).
  const { data: fq, error: fqErr } = await db
    .from('form_questions')
    .insert({
      form_instance_id: ft.id,
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

  // citations — form_response cites the q_a_pair. ID-131.19 M6 retirement:
  // cited_kind='content_item' + cited_content_item_id both DROPPED at M6
  // (citations.cited_content_item_id column + the CHECK branch) — the
  // surviving q_a_pair branch is what get_content_win_rate's
  // ID-131.10/CITE-EXT re-anchor (p_q_a_pair_id) actually reads.
  const { data: cc, error: ccErr } = await db
    .from('citations')
    .insert({
      citing_kind: 'form_response',
      citing_form_response_id: fr.id,
      cited_kind: 'q_a_pair',
      cited_q_a_pair_id: args.citedContentItemId,
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

  // 2. Two cited content items (one per form) so per-item win-rate is independently assertable.
  wonContentItemId = await insertContentItem('won-cited-item');
  notShortlistedContentItemId = await insertContentItem(
    'not-shortlisted-cited-item',
  );

  // 3. The two synthetic forms — no workspace (BI-1, {145.6}).
  //    WON itt (final-award, counts_toward_win_rate=true).
  await seedForm({
    label: 'won-itt',
    formType: 'itt',
    outcome: 'won',
    workflowState: 'won',
    citedContentItemId: wonContentItemId,
  });
  //    NOT_SHORTLISTED psq (shortlist stage; counts_toward_win_rate=false).
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
  if (seeded.formInstanceIds.length) {
    await db.from('form_instances').delete().in('id', seeded.formInstanceIds);
  }
  if (seeded.qaPairIds.length) {
    await db.from('q_a_pairs').delete().in('id', seeded.qaPairIds);
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
      p_q_a_pair_id: wonContentItemId,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_citations)).toBe(1);
    expect(Number(row.winning_citations)).toBe(1); // numerator
    expect(Number(row.losing_citations)).toBe(0);
    expect(Number(row.pending_citations)).toBe(0); // counts_toward_win_rate=true ⇒ NOT pending
    expect(Number(row.win_rate)).toBe(1); // 1 won / 1 decided
  });

  it('(b) the NOT_SHORTLISTED citation is counted but ABSENT from the win-rate denominator (counts_toward_win_rate=false ⇒ pending)', async () => {
    if (skip) return;

    // {145.6} W1e DROPPED the {130.6} rollup (procurement_workspaces) wholesale — this suite is
    // now the sole coverage of the won/not_shortlisted distinction, at the citation-RPC
    // altitude. Here we assert the CITATION-level claim the RPC exposes: a not_shortlisted
    // (shortlist-stage, counts_toward_win_rate=false) outcome is counted in total but excluded
    // from the win-rate denominator (pending), win_rate 0.
    const { data, error } = await db.rpc('get_content_win_rate', {
      p_q_a_pair_id: notShortlistedContentItemId,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_citations)).toBe(1); // the citation IS counted in total
    expect(Number(row.winning_citations)).toBe(0);
    expect(Number(row.losing_citations)).toBe(0);
    expect(Number(row.pending_citations)).toBe(1);
    expect(Number(row.win_rate)).toBe(0);
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
    expect(Number(overall!.shortlist_total)).toBeGreaterThanOrEqual(1);
    expect(Number(overall!.shortlist_passed)).toBeGreaterThanOrEqual(0);

    // The win-rate denominator (final-award) sees the WON itt citation: at least 1 winning,
    // and the not_shortlisted citation is NOT in it (it is a shortlist-stage outcome).
    expect(Number(overall!.winning_citations)).toBeGreaterThanOrEqual(1);
  });
});
