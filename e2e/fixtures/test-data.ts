import { createServiceClient } from './supabase';

/**
 * Prefix used to identify E2E test data across all tables.
 * All seeded entities use this prefix so cleanup can target them precisely.
 */
export const E2E_PREFIX = '[E2E Test]';

/**
 * IDs of seeded test data, returned from seedTestData() for use in tests
 * and passed to cleanupTestData() for teardown.
 */
export interface SeededData {
  contentItemIds: string[];
  workspaceId: string | null;
  bidId: string | null;
  questionIds: string[];
}

/**
 * Seed a minimal set of test data for E2E tests.
 *
 * Creates:
 * - 3 content items (article, q_a_pair, note) with the E2E prefix
 * - 1 workspace (kb_section type) with the E2E prefix
 * - 1 bid workspace with questions (no AI required)
 *
 * All data is created via the service role client (bypasses RLS).
 */
export async function seedTestData(): Promise<SeededData> {
  const supabase = createServiceClient();
  const result: SeededData = {
    contentItemIds: [],
    workspaceId: null,
    bidId: null,
    questionIds: [],
  };

  // --- Content items ---
  const contentItems = [
    {
      title: `${E2E_PREFIX} IT Support Policy`,
      content_type: 'article' as const,
      primary_domain: 'Service Delivery',
      ai_summary: 'E2E test article about IT support policies and procedures.',
      platform: 'manual' as const,
      source_url: 'https://e2e-test.example.com/it-support',
      content: 'This is an E2E test content item covering IT support policies.',
    },
    {
      title: `${E2E_PREFIX} What is your SLA?`,
      content_type: 'q_a_pair' as const,
      primary_domain: 'Service Delivery',
      ai_summary: 'Q&A pair about service level agreements.',
      platform: 'manual' as const,
      content:
        'Q: What is your SLA?\nA: We provide tiered SLAs with 15-minute P1 response.',
      answer_standard:
        'We provide tiered SLAs with 15-minute P1 response, 1-hour P2 response, and 4-hour P3 response.',
    },
    {
      title: `${E2E_PREFIX} Test Note`,
      content_type: 'note' as const,
      primary_domain: 'General',
      ai_summary: 'A simple test note for E2E testing.',
      platform: 'manual' as const,
      content: 'This is a test note created for E2E testing purposes.',
    },
  ];

  const { data: insertedItems, error: itemError } = await supabase
    .from('content_items')
    .insert(contentItems)
    .select('id');

  if (itemError) {
    throw new Error(`Failed to seed content items: ${itemError.message}`);
  }

  result.contentItemIds = (insertedItems ?? []).map((item) => item.id);

  // --- Workspace (kb_section) ---
  const { data: workspace, error: wsError } = await supabase
    .from('workspaces')
    .insert({
      name: `${E2E_PREFIX} Test Workspace`,
      description: 'E2E test workspace for automated testing.',
      type: 'kb_section',
    })
    .select('id')
    .single();

  if (wsError) {
    console.warn(`Failed to seed workspace: ${wsError.message}`);
  } else {
    result.workspaceId = workspace.id;
  }

  // --- Bid workspace with questions ---
  const { data: bid, error: bidError } = await supabase
    .from('workspaces')
    .insert({
      name: `${E2E_PREFIX} IT Support Services`,
      description: 'E2E test bid for automated testing.',
      type: 'bid',
      domain_metadata: {
        buyer: 'E2E Test Corp',
        status: 'draft',
        deadline: new Date(Date.now() + 14 * 86400000)
          .toISOString()
          .split('T')[0],
      },
    })
    .select('id')
    .single();

  if (bidError) {
    console.warn(`Failed to seed bid: ${bidError.message}`);
  } else {
    result.bidId = bid.id;

    // Add questions to the bid
    const questions = [
      {
        project_id: bid.id,
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 1,
        question_text:
          'Describe your approach to providing IT support services.',
        word_limit: 500,
      },
      {
        project_id: bid.id,
        section_name: 'Experience',
        section_sequence: 2,
        question_sequence: 1,
        question_text:
          'What experience does your organisation have in public sector IT?',
        word_limit: 400,
      },
    ];

    const { data: insertedQuestions, error: qError } = await supabase
      .from('bid_questions')
      .insert(questions)
      .select('id');

    if (qError) {
      console.warn(`Failed to seed bid questions: ${qError.message}`);
    } else {
      result.questionIds = (insertedQuestions ?? []).map((q) => q.id);
    }
  }

  return result;
}

/**
 * Remove all E2E test data from the database.
 *
 * Targets any data with the E2E_PREFIX in its name/title.
 * Uses cascading deletes where possible (e.g. deleting a bid workspace
 * cascades to its questions and responses).
 */
export async function cleanupTestData(): Promise<void> {
  const supabase = createServiceClient();

  // Delete content items with E2E prefix
  const { error: itemError } = await supabase
    .from('content_items')
    .delete()
    .like('title', `${E2E_PREFIX}%`);

  if (itemError) {
    console.warn(`Failed to clean up content items: ${itemError.message}`);
  }

  // Delete workspaces with E2E prefix (cascades to bid_questions, bid_responses)
  const { error: wsError } = await supabase
    .from('workspaces')
    .delete()
    .like('name', `${E2E_PREFIX}%`);

  if (wsError) {
    console.warn(`Failed to clean up workspaces: ${wsError.message}`);
  }
}
