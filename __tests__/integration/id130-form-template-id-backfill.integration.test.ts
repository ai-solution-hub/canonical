/**
 * ID-130 {130.27} — form_template_id write-side stamp: recurrence-guard trigger
 * + win-rate/outcome inclusion regression.
 *
 * THE BUG this Subtask fixes: `form_questions` rows created via the live
 * question-creation paths were written with `workspace_id` only —
 * `form_template_id` was populated ONCE by the {130.8} backfill migration and
 * drifted NULL on every insert since. `outcome/route.ts`'s KB-integration query
 * and the win-rate RPCs (`get_content_win_rate` / `get_aggregate_win_rate_stats`)
 * INNER JOIN `form_questions.form_template_id -> form_templates.id`, so a
 * NULL-drifted row is silently DROPPED from both — no error, just missing data.
 *
 * This suite runs against the STAGING DB AFTER the Orchestrator applies
 * `supabase/migrations/20260708120000_id130_form_template_id_backfill_guard.sql`
 * (the migration this Subtask ships). It exercises the SQL-level half of the
 * fix (the BEFORE INSERT recurrence-guard trigger); the app-level half
 * (`lib/domains/procurement/resolve-form-template.ts`, called from
 * `questions/extract/route.ts` and `questions/route.ts`) is covered by the
 * mocked route-level unit tests in `__tests__/api/procurement-questions-*.test.ts`
 * and the dedicated
 * `__tests__/lib/domains/procurement/resolve-form-template.test.ts`.
 *
 * Run post-staging-apply: `bun run test:integration -- id130-form-template-id-backfill`
 * (skips cleanly without live DB credentials — see `hasRealLiveDbCredentials()`).
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from './helpers/supabase-client';

const TEST_TAG = `id130-27-ftid-${Date.now()}`;

const seeded = {
  citationIds: [] as string[],
  formResponseIds: [] as string[],
  formQuestionIds: [] as string[],
  formTemplateIds: [] as string[],
  workspaceIds: [] as string[],
  qaPairIds: [] as string[],
};

let skip = false;
let db: Awaited<ReturnType<typeof createLiveServiceClient>>;

let workspaceId = '';
/** The earliest-created form_templates row for `workspaceId` (form A). */
let formAId = '';
/** A LATER-created second form on the SAME workspace (form B) — proves the
 * trigger (and the app resolver it mirrors) picks the EARLIEST form, not just
 * any form, on a multi-form workspace (post-{130.13} "add a form"). */
let formBId = '';
let citedQaPairId = '';

async function createWorkspace(
  applicationTypeId: string,
  label: string,
): Promise<string> {
  const { data, error } = await db
    .from('workspaces')
    .insert({
      name: `[${TEST_TAG}] ${label}`,
      application_type_id: applicationTypeId,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `workspace insert (${label}): ${error?.message ?? 'no data'}`,
    );
  }
  seeded.workspaceIds.push(data.id);
  return data.id;
}

async function createForm(args: {
  workspaceId: string;
  label: string;
  outcome?: string;
  workflowState?: string;
}): Promise<string> {
  const { data, error } = await db
    .from('form_templates')
    .insert({
      workspace_id: args.workspaceId,
      name: `[${TEST_TAG}] ${args.label}`,
      filename: `${TEST_TAG}-${args.label}.pdf`,
      storage_path: `synthetic/${TEST_TAG}/${args.label}.pdf`,
      file_size: 1,
      mime_type: 'application/pdf',
      form_type: 'bid',
      ...(args.outcome ? { outcome: args.outcome } : {}),
      ...(args.workflowState ? { workflow_state: args.workflowState } : {}),
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(
      `form insert (${args.label}): ${error?.message ?? 'no data'}`,
    );
  }
  seeded.formTemplateIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  if (!hasRealLiveDbCredentials()) {
    skip = true;
    return;
  }
  db = await createLiveServiceClient();

  const probe = await db.from('form_outcome_types').select('key').limit(1);
  if (isNetworkIsolationError(probe.error)) {
    skip = true;
    return;
  }
  if (probe.error)
    throw new Error(`pre-flight read failed: ${probe.error.message}`);

  const { data: appType, error: appErr } = await db
    .from('application_types')
    .select('id')
    .eq('key', 'procurement')
    .maybeSingle();
  if (appErr) throw new Error(`application_types lookup: ${appErr.message}`);
  if (!appType)
    throw new Error('no procurement application_type row available');

  workspaceId = await createWorkspace(appType.id, 'multi-form engagement');

  // Form A created FIRST (the canonical / earliest form for the workspace).
  formAId = await createForm({
    workspaceId,
    label: 'form-a-earliest',
    outcome: 'won',
    workflowState: 'won',
  });
  // Form B created SECOND on the SAME workspace (post-{130.13} "add a form").
  formBId = await createForm({ workspaceId, label: 'form-b-later' });

  const { data: qa, error: qaErr } = await db
    .from('q_a_pairs')
    .insert({
      question_text: `[${TEST_TAG}] cited item`,
      answer_standard: `Synthetic {130.27} fixture. Disposable.`,
      publication_status: 'published',
    })
    .select('id')
    .single();
  if (qaErr || !qa)
    throw new Error(`q_a_pairs insert: ${qaErr?.message ?? 'no data'}`);
  seeded.qaPairIds.push(qa.id);
  citedQaPairId = qa.id;
}, 60_000);

afterAll(async () => {
  if (skip || !db) return;
  if (seeded.citationIds.length) {
    await db.from('citations').delete().in('id', seeded.citationIds);
  }
  if (seeded.formResponseIds.length) {
    await db.from('form_responses').delete().in('id', seeded.formResponseIds);
  }
  if (seeded.formQuestionIds.length) {
    await db.from('form_questions').delete().in('id', seeded.formQuestionIds);
  }
  if (seeded.formTemplateIds.length) {
    await db.from('form_templates').delete().in('id', seeded.formTemplateIds);
  }
  if (seeded.workspaceIds.length) {
    await db.from('workspaces').delete().in('id', seeded.workspaceIds);
  }
  if (seeded.qaPairIds.length) {
    await db.from('q_a_pairs').delete().in('id', seeded.qaPairIds);
  }
}, 60_000);

describe('ID-130.27 — form_template_id recurrence-guard trigger + win-rate/outcome inclusion', () => {
  it('the BEFORE INSERT trigger auto-resolves form_template_id to the EARLIEST form on a multi-form workspace when the caller omits it', async () => {
    if (skip) return;

    // Deliberately OMIT form_template_id — exactly what a pre-{130.27} insert
    // site (or any future one that forgets to call
    // resolveOrMintFormTemplateId()) would send.
    const { data: fq, error } = await db
      .from('form_questions')
      .insert({
        workspace_id: workspaceId,
        section_sequence: 1,
        question_sequence: 1,
        question_text: `[${TEST_TAG}] trigger-resolved question`,
      })
      .select('id, form_template_id')
      .single();

    expect(error).toBeNull();
    expect(fq).toBeTruthy();
    seeded.formQuestionIds.push(fq!.id);

    // Resolves to form A (earliest), NOT form B (later) — matches
    // outcome/route.ts's "workspace's single v1 form" resolution.
    expect(fq!.form_template_id).toBe(formAId);
    expect(fq!.form_template_id).not.toBe(formBId);
  });

  it('the trigger does NOT override an explicitly-provided form_template_id', async () => {
    if (skip) return;

    const { data: fq, error } = await db
      .from('form_questions')
      .insert({
        workspace_id: workspaceId,
        form_template_id: formBId,
        section_sequence: 2,
        question_sequence: 2,
        question_text: `[${TEST_TAG}] explicit-form-b question`,
      })
      .select('id, form_template_id')
      .single();

    expect(error).toBeNull();
    expect(fq).toBeTruthy();
    seeded.formQuestionIds.push(fq!.id);
    expect(fq!.form_template_id).toBe(formBId);
  });

  it('a trigger-resolved row is INCLUDED in outcome/route.ts\'s exact KB-integration query shape (.eq("form_template_id", targetForm.id))', async () => {
    if (skip) return;

    // Mirrors app/api/procurement/[id]/outcome/route.ts's KB-integration read
    // (line ~219: .from('form_questions').select('id, question_text').eq('form_template_id', targetForm.id))
    // against form A (the workspace's resolved "target form").
    const { data, error } = await db
      .from('form_questions')
      .select('id, question_text')
      .eq('form_template_id', formAId);

    expect(error).toBeNull();
    const texts = (data ?? []).map((r) => r.question_text);
    expect(texts).toContain(`[${TEST_TAG}] trigger-resolved question`);
    // Form B's explicitly-keyed row must NOT appear under form A's id.
    expect(texts).not.toContain(`[${TEST_TAG}] explicit-form-b question`);
  });

  it('a trigger-resolved row on the WON form counts in the win-rate numerator (get_content_win_rate) — the exact NULL-drift regression', async () => {
    if (skip) return;

    // Citing entity for the trigger-resolved question (form A, outcome=won).
    const { data: trigFq } = await db
      .from('form_questions')
      .select('id')
      .eq('form_template_id', formAId)
      .eq('question_text', `[${TEST_TAG}] trigger-resolved question`)
      .single();
    expect(trigFq).toBeTruthy();

    const { data: fr, error: frErr } = await db
      .from('form_responses')
      .insert({
        question_id: trigFq!.id,
        response_text: `[${TEST_TAG}] response citing the win-rate fixture item`,
      })
      .select('id')
      .single();
    expect(frErr).toBeNull();
    seeded.formResponseIds.push(fr!.id);

    const { data: cc, error: ccErr } = await db
      .from('citations')
      .insert({
        citing_kind: 'form_response',
        citing_form_response_id: fr!.id,
        cited_kind: 'q_a_pair',
        cited_q_a_pair_id: citedQaPairId,
        citation_type: 'reference',
      })
      .select('id')
      .single();
    expect(ccErr).toBeNull();
    seeded.citationIds.push(cc!.id);

    // Pre-{130.27}, this citation's form_question would have had
    // form_template_id=NULL (nothing stamped it) and the win-rate RPC's INNER
    // JOIN would silently drop it — total_citations would read 0, not 1.
    const { data, error } = await db.rpc('get_content_win_rate', {
      p_q_a_pair_id: citedQaPairId,
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(Number(row.total_citations)).toBe(1);
    expect(Number(row.winning_citations)).toBe(1);
    expect(Number(row.win_rate)).toBe(1);
  });
});
