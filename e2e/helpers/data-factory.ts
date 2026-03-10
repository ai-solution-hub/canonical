import { createServiceClient } from '../fixtures/supabase';

/**
 * Create a content item for a single test, returning its ID.
 * Uses the worker prefix for automatic cleanup by the worker-scoped fixture.
 */
export async function createTestItem(
  prefix: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('content_items')
    .insert({
      title: `${prefix} Temp Item ${Date.now()}`,
      content_type: 'note',
      primary_domain: 'General',
      platform: 'manual',
      content: 'Temporary test item.',
      ...overrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a Q&A pair content item with answer_standard (and optionally answer_advanced).
 * Returns the created item ID.
 */
export async function createTestQAPair(
  prefix: string,
  domain: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const timestamp = Date.now();
  const { data } = await supabase
    .from('content_items')
    .insert({
      title: `${prefix} Q&A ${domain} ${timestamp}`,
      content_type: 'q_a_pair',
      primary_domain: domain,
      platform: 'manual',
      content: `Q: Test question about ${domain}?\nA: Test answer for ${domain}.`,
      answer_standard: `Standard answer for ${domain} test Q&A pair.`,
      ...overrides,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
}

/**
 * Create a bid workspace for a single test, returning its ID.
 * Uses the worker prefix for automatic cleanup.
 */
export async function createTestBid(
  prefix: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('workspaces')
    .insert({
      name: `${prefix} Temp Bid ${Date.now()}`,
      description: 'Temporary test bid.',
      type: 'bid',
      domain_metadata: {
        buyer: 'E2E Temp Corp',
        status: 'draft',
        deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      },
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
    .from('bid_responses')
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
 * Returns { bidId, questionIds, responseIds }.
 *
 * The bid is advanced to `ready_for_export` state with all responses approved.
 */
export async function createExportReadyBid(
  prefix: string,
): Promise<{ bidId: string; questionIds: string[]; responseIds: string[] }> {
  const supabase = createServiceClient();

  // Create bid workspace
  const bidId = await createTestBid(prefix);

  // Create 2 questions
  const { data: qs } = await supabase
    .from('bid_questions')
    .insert([
      {
        project_id: bidId,
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 1,
        question_text: `${prefix} Export test: describe your approach.`,
        word_limit: 500,
      },
      {
        project_id: bidId,
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
    .from('bid_responses')
    .insert(responseInserts)
    .select('id')
    .throwOnError();

  const responseIds = (resps ?? []).map((r) => r.id);

  // Advance bid to ready_for_export
  await advanceBidState(bidId, 'ready_for_export');

  return { bidId, questionIds, responseIds };
}

/**
 * Create one content item per domain, returning all created IDs.
 */
export async function createItemsAcrossDomains(
  prefix: string,
  domains: string[],
): Promise<string[]> {
  const supabase = createServiceClient();
  const timestamp = Date.now();

  const items = domains.map((domain, i) => ({
    title: `${prefix} Domain Item ${domain} ${timestamp}-${i}`,
    content_type: 'note' as const,
    primary_domain: domain,
    platform: 'manual' as const,
    content: `Test content item for domain: ${domain}.`,
  }));

  const { data } = await supabase
    .from('content_items')
    .insert(items)
    .select('id')
    .throwOnError();

  return (data ?? []).map((d) => d.id);
}

/**
 * Assign a content item to a workspace via the junction table.
 * Returns the junction record ID.
 */
export async function assignItemToWorkspace(
  itemId: string,
  workspaceId: string,
): Promise<string> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('content_item_workspaces')
    .insert({
      content_item_id: itemId,
      workspace_id: workspaceId,
    })
    .select('id')
    .single()
    .throwOnError();

  return data!.id;
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
 * Advance a bid workspace through sequential state transitions to reach
 * the target state. The bid state machine requires stepping through each
 * intermediate state.
 *
 * State order: draft → questions_extracted → matching → drafting →
 *   review → ready_for_export → exported → submitted
 */
export async function advanceBidState(
  bidId: string,
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

  // Get current state
  const { data: current } = await supabase
    .from('workspaces')
    .select('domain_metadata')
    .eq('id', bidId)
    .single()
    .throwOnError();

  const currentMetadata =
    (current?.domain_metadata as Record<string, unknown>) ?? {};
  const currentState = (currentMetadata.status as string) ?? 'draft';

  const currentIndex = stateOrder.indexOf(currentState);
  const targetIndex = stateOrder.indexOf(targetState);

  if (targetIndex <= currentIndex) {
    return; // Already at or past target state
  }

  // Step through each intermediate state
  for (let i = currentIndex + 1; i <= targetIndex; i++) {
    const { data: latest } = await supabase
      .from('workspaces')
      .select('domain_metadata')
      .eq('id', bidId)
      .single()
      .throwOnError();

    const latestMetadata =
      (latest?.domain_metadata as Record<string, unknown>) ?? {};

    await supabase
      .from('workspaces')
      .update({
        domain_metadata: { ...latestMetadata, status: stateOrder[i] },
      })
      .eq('id', bidId)
      .throwOnError();
  }
}
