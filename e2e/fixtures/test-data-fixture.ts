/* eslint-disable @typescript-eslint/no-empty-object-type -- Playwright fixture API requires {} for test-scoped type parameter */
import { test as base } from '@playwright/test';
import { createServiceClient } from './supabase';

/**
 * Schema compatibility: migrations up to 20260310
 * If tests fail after a migration, update the seed data here.
 *
 * Quick Win expansion (S75): adds bid responses, additional Q&A pair,
 * and content items with varied freshness to unblock Flows 1, 5, 6, 12, 13.
 */

/**
 * Per-worker test data seeded before tests and cleaned up after.
 * Each worker gets its own isolated dataset identified by a unique prefix.
 */
export interface WorkerData {
  /** IDs of all seeded content items. */
  contentItemIds: string[];
  /** ID of the article content item ("IT Support Policy"). */
  articleId: string;
  /** ID of the first Q&A pair ("What is your SLA?"). */
  qaPairId: string;
  /** ID of the second Q&A pair ("Project Management Approach") — different domain, has answer_advanced. */
  qaPairTechId: string;
  /** ID of the note content item ("Test Note"). */
  noteId: string;
  /** ID of the stale content item ("Cyber Essentials Compliance"). */
  staleItemId: string;
  /** ID of the expired content item ("Pricing Model Template"). */
  expiredItemId: string;
  /** ID of the seeded kb_section workspace. */
  workspaceId: string;
  /** ID of the seeded bid workspace. */
  bidId: string;
  /** IDs of the 2 seeded bid questions (Technical, Experience). */
  questionIds: string[];
  /** IDs of the 2 seeded bid responses (approved, draft). */
  responseIds: string[];
  /** Worker-unique prefix (e.g. "[E2E-W0]") for data isolation. */
  prefix: string;
}

/**
 * Extended test with a worker-scoped `workerData` fixture.
 *
 * Each Playwright worker seeds its own isolated set of test data using a
 * unique prefix like `[E2E-W0]`. Data is cleaned up automatically when
 * the worker finishes.
 *
 * Seeded entities:
 * - 6 content items (article, 2 q_a_pairs, note, stale policy, expired note)
 * - 1 kb_section workspace
 * - 1 bid workspace with 2 questions and 2 responses
 */
export const test = base.extend<{}, { workerData: WorkerData }>({
  workerData: [
    async ({}, use, workerInfo) => {
      const supabase = createServiceClient();
      const prefix = `[E2E-W${workerInfo.workerIndex}]`;

      // --- Seed per-worker data ---

      // Timestamps for freshness testing — set in the past to prevent
      // freshness recalculation from overwriting values to 'fresh'.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();

      const contentItems = [
        // [0] Article — Service Delivery
        {
          title: `${prefix} IT Support Policy`,
          content_type: 'article' as const,
          primary_domain: 'Service Delivery',
          ai_summary: 'E2E test article about IT support policies and procedures.',
          platform: 'manual' as const,
          source_url: 'https://e2e-test.example.com/it-support',
          content: 'This is an E2E test content item covering IT support policies.',
        },
        // [1] Q&A pair — Service Delivery (answer_standard only)
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
        // [2] Note — General
        {
          title: `${prefix} Test Note`,
          content_type: 'note' as const,
          primary_domain: 'General',
          ai_summary: 'A simple test note for E2E testing.',
          platform: 'manual' as const,
          content: 'This is a test note created for E2E testing purposes.',
        },
        // [3] Q&A pair — Technical Capability (both answer fields)
        {
          title: `${prefix} Project Management Approach`,
          content_type: 'q_a_pair' as const,
          primary_domain: 'Technical Capability',
          ai_summary: 'Q&A pair about project management methodology and governance.',
          platform: 'manual' as const,
          content:
            'Q: Describe your project management approach.\nA: We follow PRINCE2 with agile delivery sprints.',
          answer_standard:
            'We follow PRINCE2 methodology adapted for agile delivery, with dedicated project managers for each engagement and weekly governance reporting.',
          answer_advanced:
            'Our project management framework combines PRINCE2 governance with agile delivery sprints. Each project has a dedicated PRINCE2 Practitioner as project manager, supported by a PMO that provides cross-project oversight. We use weekly RAG status reporting, monthly steering committees, and quarterly programme boards. Our methodology includes mandatory stage-gate reviews, risk registers maintained in real-time, and benefits realisation tracking throughout the project lifecycle and into BAU.',
        },
        // [4] Stale policy — Security & Compliance
        {
          title: `${prefix} Cyber Essentials Compliance`,
          content_type: 'policy' as const,
          primary_domain: 'Security & Compliance',
          ai_summary: 'Policy document covering Cyber Essentials certification requirements.',
          platform: 'manual' as const,
          content:
            'This policy outlines our approach to maintaining Cyber Essentials Plus certification, including annual reassessment procedures and remediation workflows.',
          freshness: 'stale' as const,
          freshness_checked_at: thirtyDaysAgo,
          lifecycle_type: 'regulation' as const,
        },
        // [5] Expired note — Commercial
        {
          title: `${prefix} Pricing Model Template`,
          content_type: 'note' as const,
          primary_domain: 'Commercial',
          ai_summary: 'Template for pricing model breakdowns in bid responses.',
          platform: 'manual' as const,
          content:
            'Standard pricing model template: Day rates, fixed-price deliverables, managed service charges, and optional extras.',
          freshness: 'expired' as const,
          freshness_checked_at: ninetyDaysAgo,
          lifecycle_type: 'date_bound' as const,
        },
      ];

      const { data: items } = await supabase
        .from('content_items')
        .insert(contentItems)
        .select('id')
        .throwOnError();

      const itemIds = (items ?? []).map((i) => i.id);

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

      const questionIds = (qs ?? []).map((q) => q.id);

      // --- Bid responses: 1 approved, 1 draft ---
      const responses = [
        {
          question_id: questionIds[0],
          response_text:
            'Our IT support approach combines proactive monitoring with a dedicated service desk operating 24/7. We use ITIL-aligned processes with automated ticket routing, SLA-driven escalation, and root cause analysis for recurring incidents. Our team of 45 certified engineers provides L1-L3 support across all major platforms.',
          review_status: 'approved',
          version: 1,
        },
        {
          question_id: questionIds[1],
          response_text:
            'We have delivered IT services to over 30 public sector organisations including NHS trusts, local authorities, and central government departments. Notable contracts include a 5-year managed service for a London borough and infrastructure modernisation for an NHS integrated care board.',
          review_status: 'draft',
          version: 1,
        },
      ];

      const { data: resps } = await supabase
        .from('bid_responses')
        .insert(responses)
        .select('id')
        .throwOnError();

      const responseIds = (resps ?? []).map((r) => r.id);

      const data: WorkerData = {
        contentItemIds: itemIds,
        articleId: itemIds[0],
        qaPairId: itemIds[1],
        qaPairTechId: itemIds[3],
        noteId: itemIds[2],
        staleItemId: itemIds[4],
        expiredItemId: itemIds[5],
        workspaceId: ws!.id,
        bidId: bid!.id,
        questionIds,
        responseIds,
        prefix,
      };

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeded: ${data.contentItemIds.length} items, ` +
          `1 workspace, 1 bid with ${data.questionIds.length} questions and ` +
          `${data.responseIds.length} responses (prefix: ${prefix})`,
      );

      await use(data);

      // --- Teardown: clean up this worker's data ---
      console.log(`[Worker ${workerInfo.workerIndex}] Cleaning up ${prefix} data...`);

      // Delete bid responses explicitly as a safety net (CASCADE from workspace
      // deletion should handle this, but belt-and-braces).
      if (responseIds.length > 0) {
        await supabase.from('bid_responses').delete().in('id', responseIds);
      }

      await supabase.from('content_items').delete().like('title', `${prefix}%`);
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);
    },
    { scope: 'worker' },
  ],
});
