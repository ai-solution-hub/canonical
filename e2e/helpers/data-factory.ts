import { createServiceClient } from '../fixtures/supabase';

// ID-131.19 M6 retirement note (S450 GO tail): `createTestItem` (generic
// content_items seed, zero real callers — only a planning-doc mention in
// mcp-invocation.spec.ts, never an actual call) and `createItemsAcrossDomains`
// / `assignItemToWorkspace` (zero callers anywhere) are REMOVED — content_items
// and content_item_workspaces were both DROPPED at M6, and none of the three
// had a surviving consumer to modernize for.

/**
 * Create a Q&A pair with answer_standard (and optionally answer_advanced).
 * Returns the created row's id.
 *
 * ID-131.19 M6 retirement: content_items (content_type='q_a_pair') was
 * DROPPED at M6; this now writes the dedicated `q_a_pairs` table, which
 * `/library` already reads from ({131.21} G-MANUAL-QA — hooks/use-library-data.ts).
 * `domain` has no q_a_pairs column (that facet lives on `record_lifecycle`,
 * currently zero-row) — folded into the default question_text for
 * readability only, same as before. `overrides.title` (the pre-M6 call
 * convention) remaps onto `question_text`; any other override key (e.g.
 * `answer_standard`/`answer_advanced`) passes straight through since those
 * are already q_a_pairs column names.
 */
export async function createTestQAPair(
  prefix: string,
  domain: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const timestamp = Date.now();
  const { title, ...qaOverrides } = overrides as { title?: string } & Record<
    string,
    unknown
  >;
  const { data } = await supabase
    .from('q_a_pairs')
    .insert({
      question_text: title ?? `${prefix} Q&A ${domain} ${timestamp}`,
      answer_standard: `Standard answer for ${domain} test Q&A pair.`,
      publication_status: 'published',
      ...qaOverrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a bid (a `form_instances` row) for a single test, returning its ID.
 * Uses the worker prefix for automatic cleanup.
 *
 * ID-145 {145.6}/{145.18} form-first re-architecture (BI-1): a procurement
 * item IS a `form_instances` row directly — the pre-W1 `workspaces` +
 * `domain_metadata` umbrella is wholesale-deleted for procurement (W1e).
 * `overrides` passes straight through onto the insert body, so callers may
 * override any `form_instances` column (e.g. `name`).
 */
export async function createTestBid(
  prefix: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('form_instances')
    .insert({
      name: `${prefix} Temp Procurement ${Date.now()}`,
      description: 'Temporary test bid.',
      issuing_organisation: 'E2E Temp Corp',
      deadline: new Date(Date.now() + 14 * 86400000).toISOString(),
      reference_number: null,
      estimated_value: null,
      // NOT NULL columns with no usable post-W1c default (`ingest_source`'s
      // DEFAULT is the now-CHECK-invalid legacy 'pipeline' value) — mirrors
      // the {145.8} POST /api/procurement docless-mint convention.
      filename: 'e2e-temp-bid.pdf',
      storage_path: `test-fixtures/${prefix}/temp-bid-${Date.now()}.pdf`,
      file_size: 0,
      mime_type: 'application/pdf',
      ingest_source: 'minted',
      ...overrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a kb_section workspace for a single test, returning its ID.
 * Uses the worker prefix for automatic cleanup.
 */
export async function createTestWorkspace(
  prefix: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('workspaces')
    .insert({
      name: `${prefix} Temp Workspace ${Date.now()}`,
      description: 'Temporary test workspace.',
      type: 'kb_section',
      ...overrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a bid response for a given question, returning the response ID.
 */
export async function createTestResponse(
  prefix: string,
  questionId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  // prefix is accepted for API consistency but not used in response text
  void prefix;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('form_responses')
    .insert({
      question_id: questionId,
      response_text: 'Test bid response created by E2E data factory.',
      review_status: 'draft',
      version: 1,
      ...overrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a fully export-ready bid: workspace + questions + approved responses.
 * Returns { procurementId, questionIds, responseIds }.
 *
 * The bid is advanced to `ready_for_export` state with all responses approved.
 */
export async function createExportReadyBid(prefix: string): Promise<{
  procurementId: string;
  questionIds: string[];
  responseIds: string[];
}> {
  const supabase = createServiceClient();

  // Create bid (`form_instances` row)
  const procurementId = await createTestBid(prefix);

  // Create 2 questions
  const { data: qs } = await supabase
    .from('form_questions')
    .insert([
      {
        form_instance_id: procurementId,
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 1,
        question_text: `${prefix} Export test: describe your approach.`,
        word_limit: 500,
      },
      {
        form_instance_id: procurementId,
        section_name: 'Experience',
        section_sequence: 2,
        question_sequence: 1,
        question_text: `${prefix} Export test: what is your experience?`,
        word_limit: 400,
      },
    ])
    .select('id')
    .throwOnError();

  const questionIds = (qs ?? []).map((q) => q.id);

  // Create approved responses for all questions
  const responseInserts = questionIds.map((qId) => ({
    question_id: qId,
    response_text: `Approved response for export testing. Question ${qId}.`,
    review_status: 'approved',
    version: 1,
  }));

  const { data: resps } = await supabase
    .from('form_responses')
    .insert(responseInserts)
    .select('id')
    .throwOnError();

  const responseIds = (resps ?? []).map((r) => r.id);

  // Advance bid to ready_for_export
  await advanceBidState(procurementId, 'ready_for_export');

  return { procurementId, questionIds, responseIds };
}

/**
 * Create a notification with all required NOT NULL fields.
 * Returns the notification ID.
 */
export async function createTestNotification(
  userId: string,
  type: string,
  entityType: string,
  entityId: string,
  title: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      entity_type: entityType,
      entity_id: entityId,
      title,
      ...overrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a bid (`form_instances` row) and advance it to the target state in
 * one call. Returns the bid's `form_instances` id.
 */
export async function createBidWithState(
  prefix: string,
  targetState: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const procurementId = await createTestBid(prefix, overrides);
  await advanceBidState(procurementId, targetState);
  return procurementId;
}

/**
 * Create a bid (`form_instances` row) with N questions. Returns both the bid
 * ID and question IDs.
 */
export async function createBidWithQuestions(
  prefix: string,
  questionCount: number,
  overrides: Record<string, unknown> = {},
): Promise<{ procurementId: string; questionIds: string[] }> {
  const supabase = createServiceClient();
  const procurementId = await createTestBid(prefix, overrides);

  const questions = Array.from({ length: questionCount }, (_, i) => ({
    form_instance_id: procurementId,
    section_name: `Section ${i + 1}`,
    section_sequence: i + 1,
    question_sequence: 1,
    question_text: `${prefix} Question ${i + 1}: Describe your approach.`,
    word_limit: 500,
  }));

  const { data: qs } = await supabase
    .from('form_questions')
    .insert(questions)
    .select('id')
    .throwOnError();

  return { procurementId, questionIds: (qs ?? []).map((q) => q.id) };
}

/**
 * Advance a bid (`form_instances` row) through sequential state transitions
 * to reach the target state. The bid state machine requires stepping
 * through each intermediate state.
 *
 * State order: draft → questions_extracted → matching → drafting →
 *   review → ready_for_export → exported → submitted
 *
 * ID-145 {145.6}/{145.18}: `workflow_state` is a plain scalar column on
 * `form_instances` (the pre-W1 `workspaces.status`/`domain_metadata` JSONB
 * read-modify-write dance — and the pgbouncer read-after-write race it
 * worked around, S152B WP15 item #15 Symptom 2 — no longer applies; each
 * UPDATE here carries the full, self-contained next state).
 */
export async function advanceBidState(
  procurementId: string,
  targetState: string,
): Promise<void> {
  const stateOrder = [
    'draft',
    'questions_extracted',
    'matching',
    'drafting',
    'review',
    'ready_for_export',
    'exported',
    'submitted',
  ];

  const supabase = createServiceClient();

  const { data: current } = await supabase
    .from('form_instances')
    .select('workflow_state')
    .eq('id', procurementId)
    .single()
    .throwOnError();

  const currentState = (current?.workflow_state as string) ?? 'draft';

  const currentIndex = stateOrder.indexOf(currentState);
  const targetIndex = stateOrder.indexOf(targetState);

  if (targetIndex <= currentIndex) {
    return; // Already at or past target state
  }

  // Step through each intermediate state
  for (let i = currentIndex + 1; i <= targetIndex; i++) {
    await supabase
      .from('form_instances')
      .update({ workflow_state: stateOrder[i] })
      .eq('id', procurementId)
      .throwOnError();
  }
}
