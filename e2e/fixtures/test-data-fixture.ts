/* eslint-disable @typescript-eslint/no-empty-object-type -- Playwright fixture API requires {} for test-scoped type parameter */
import { test as base } from '@playwright/test';
import { createServiceClient } from './supabase';

/**
 * Per-worker test data seeded before tests and cleaned up after.
 * Each worker gets its own isolated dataset identified by a unique prefix.
 */
export interface WorkerData {
  /** IDs of the 3 seeded content items (article, q_a_pair, note). */
  contentItemIds: string[];
  /** ID of the seeded kb_section workspace. */
  workspaceId: string;
  /** ID of the seeded bid workspace. */
  bidId: string;
  /** IDs of the 2 seeded bid questions. */
  questionIds: string[];
  /** Worker-unique prefix (e.g. "[E2E-W0]") for data isolation. */
  prefix: string;
}

/**
 * Extended test with a worker-scoped `workerData` fixture.
 *
 * Each Playwright worker seeds its own isolated set of test data
 * (3 content items, 1 workspace, 1 bid with 2 questions) using a
 * unique prefix like `[E2E-W0]`. Data is cleaned up automatically
 * when the worker finishes.
 */
export const test = base.extend<{}, { workerData: WorkerData }>({
  workerData: [
    async ({}, use, workerInfo) => {
      const supabase = createServiceClient();
      const prefix = `[E2E-W${workerInfo.workerIndex}]`;

      // --- Seed per-worker data ---
      const contentItems = [
        {
          title: `${prefix} IT Support Policy`,
          content_type: 'article' as const,
          primary_domain: 'Service Delivery',
          ai_summary: 'E2E test article about IT support policies and procedures.',
          platform: 'manual' as const,
          source_url: 'https://e2e-test.example.com/it-support',
          content: 'This is an E2E test content item covering IT support policies.',
        },
        {
          title: `${prefix} What is your SLA?`,
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
          title: `${prefix} Test Note`,
          content_type: 'note' as const,
          primary_domain: 'General',
          ai_summary: 'A simple test note for E2E testing.',
          platform: 'manual' as const,
          content: 'This is a test note created for E2E testing purposes.',
        },
      ];

      const { data: items } = await supabase
        .from('content_items')
        .insert(contentItems)
        .select('id')
        .throwOnError();

      const { data: ws } = await supabase
        .from('workspaces')
        .insert({
          name: `${prefix} Test Workspace`,
          description: 'E2E worker-scoped workspace.',
          type: 'kb_section',
        })
        .select('id')
        .single()
        .throwOnError();

      const { data: bid } = await supabase
        .from('workspaces')
        .insert({
          name: `${prefix} IT Support Services`,
          description: 'E2E worker-scoped bid.',
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
        .single()
        .throwOnError();

      const questions = [
        {
          project_id: bid!.id,
          section_name: 'Technical',
          section_sequence: 1,
          question_sequence: 1,
          question_text: 'Describe your approach to providing IT support services.',
          word_limit: 500,
        },
        {
          project_id: bid!.id,
          section_name: 'Experience',
          section_sequence: 2,
          question_sequence: 1,
          question_text:
            'What experience does your organisation have in public sector IT?',
          word_limit: 400,
        },
      ];

      const { data: qs } = await supabase
        .from('bid_questions')
        .insert(questions)
        .select('id')
        .throwOnError();

      const data: WorkerData = {
        contentItemIds: (items ?? []).map((i) => i.id),
        workspaceId: ws!.id,
        bidId: bid!.id,
        questionIds: (qs ?? []).map((q) => q.id),
        prefix,
      };

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeded: ${data.contentItemIds.length} items, ` +
          `1 workspace, 1 bid with ${data.questionIds.length} questions (prefix: ${prefix})`,
      );

      await use(data);

      // --- Teardown: clean up this worker's data ---
      console.log(`[Worker ${workerInfo.workerIndex}] Cleaning up ${prefix} data...`);
      await supabase.from('content_items').delete().like('title', `${prefix}%`);
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);
    },
    { scope: 'worker' },
  ],
});
