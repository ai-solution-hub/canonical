/* eslint-disable @typescript-eslint/no-empty-object-type -- Playwright fixture API requires {} for test-scoped type parameter */
import { test as base } from '@playwright/test';
import { createServiceClient } from './supabase';
import {
  FRESHNESS_OFFSETS,
  buildCoreContentItems,
  buildCoreWorkspaces,
  CORE_BID_QUESTIONS,
  CORE_BID_RESPONSES,
  BID_STATE_TRANSITIONS,
  EMBEDDING_ITEM_INDICES,
} from './test-data';
import precomputedEmbeddings from './embeddings.json';

/**
 * Schema compatibility: migrations up to 20260310
 * If tests fail after a migration, update the seed data here.
 *
 * Phase 1 expansion (S75): full 12-item core dataset, 3 workspaces,
 * 4 bid questions, 2 bid responses, workspace-item assignments,
 * notifications, read marks. Bid advanced to drafting state.
 *
 * Phase 3 (S75): pre-computed embeddings for 5 items (search tests).
 * Phase 5 (S75): data shapes centralised in test-data.ts.
 */

/**
 * Per-worker test data seeded before tests and cleaned up after.
 * Each worker gets its own isolated dataset identified by a unique prefix.
 */
export interface WorkerData {
  /** IDs of all seeded content items (12 items). */
  contentItemIds: string[];
  /** ID of the article content item ("IT Support Policy"). */
  articleId: string;
  /** ID of the first Q&A pair ("What is your SLA?"). */
  qaPairId: string;
  /** ID of the second Q&A pair ("Project Management Approach") — different domain, has answer_advanced. */
  qaPairTechId: string;
  /** ID of the "Pricing Model Template" (note type, expired). Same record as expiredItemId. */
  noteId: string;
  /** ID of the stale content item ("Cyber Essentials Compliance"). */
  staleItemId: string;
  /** ID of the expired content item ("Pricing Model Template"). Same record as noteId. */
  expiredItemId: string;
  /** ID of the certification item ("ISO 27001 Certification"). */
  certificationId: string;
  /** ID of the case study item ("Case Study: NHS Digital"). */
  caseStudyId: string;
  /** ID of the methodology item ("Cloud Migration Methodology"). */
  methodologyId: string;
  /** ID of the Social Value Framework policy (aging). */
  socialValueId: string;
  /** ID of the Data Protection Policy (regulation). */
  dataProtectionId: string;
  /** ID of "Staff CVs and Experience" (People & Skills domain). */
  peopleSkillsId: string;
  /** ID of the Environmental Policy (aging). */
  environmentalId: string;
  /** ID of the seeded kb_section workspace. */
  workspaceId: string;
  /** ID of the seeded bid workspace (advanced to drafting). */
  bidId: string;
  /** ID of the seeded project workspace. */
  projectId: string;
  /** IDs of the 4 seeded bid questions (Technical, Experience, Social Value, Commercial). */
  questionIds: string[];
  /** IDs of the 2 seeded bid responses (approved, draft). */
  responseIds: string[];
  /** IDs of the 2 seeded notifications. */
  notificationIds: string[];
  /** Worker-unique prefix (e.g. "[E2E-W0]") for data isolation. */
  prefix: string;
  /** Indices of content items that have pre-computed embeddings. */
  embeddedItemIndices: readonly number[];
}

/**
 * Extended test with a worker-scoped `workerData` fixture.
 *
 * Each Playwright worker seeds its own isolated set of test data using a
 * unique prefix like `[E2E-W0]`. Data is cleaned up automatically when
 * the worker finishes.
 *
 * Seeded entities:
 * - 12 content items (article, 2 q_a_pairs, certification, case_study,
 *   methodology, 4 policies, note) across 7 domains
 * - 3 workspaces (kb_section, bid, project)
 * - 1 bid with 4 questions and 2 responses, advanced to drafting state
 * - 4 workspace-item assignments (items 1-4 -> kb_section)
 * - 2 notifications (freshness_alert + governance_review)
 * - 2 read marks (admin user)
 * - 5 pre-computed embeddings (items 0, 1, 2, 3, 7)
 */
export const test = base.extend<{}, { workerData: WorkerData }>({
  workerData: [
    async ({}, use, workerInfo) => {
      const supabase = createServiceClient();
      const prefix = `[E2E-W${workerInfo.workerIndex}]`;

      // --- Compute timestamps ---
      const now = Date.now();
      const timestamps = {
        thirtyDaysAgo: new Date(now - FRESHNESS_OFFSETS.THIRTY_DAYS_MS).toISOString(),
        sixtyDaysAgo: new Date(now - FRESHNESS_OFFSETS.SIXTY_DAYS_MS).toISOString(),
        ninetyDaysAgo: new Date(now - FRESHNESS_OFFSETS.NINETY_DAYS_MS).toISOString(),
        now: new Date(now).toISOString(),
        expiredDate: new Date(now - FRESHNESS_OFFSETS.THIRTY_DAYS_MS)
          .toISOString()
          .split('T')[0],
      };

      // --- Seed content items (from centralised shapes) ---
      const contentItemShapes = buildCoreContentItems(timestamps);
      const contentItems = contentItemShapes.map((shape) => ({
        ...shape,
        title: `${prefix} ${shape.title}`,
      }));

      const { data: items } = await supabase
        .from('content_items')
        .insert(contentItems)
        .select('id')
        .throwOnError();

      const itemIds = (items ?? []).map((i) => i.id);

      // --- Insert pre-computed embeddings for search tests (parallel) ---
      await Promise.all(
        precomputedEmbeddings
          .filter((e) => itemIds[e.itemIndex])
          .map((e) =>
            supabase
              .from('content_items')
              .update({ embedding: JSON.stringify(e.embedding) })
              .eq('id', itemIds[e.itemIndex])
              .throwOnError(),
          ),
      );

      // --- Seed workspaces (from centralised shapes) ---
      const bidDeadline = new Date(now + FRESHNESS_OFFSETS.FOURTEEN_DAYS_FUTURE_MS)
        .toISOString()
        .split('T')[0];
      const workspaceShapes = buildCoreWorkspaces(bidDeadline);
      const workspaceInserts = workspaceShapes.map((shape) => ({
        ...shape,
        name: `${prefix} ${shape.name}`,
      }));

      const { data: workspaces } = await supabase
        .from('workspaces')
        .insert(workspaceInserts)
        .select('id')
        .throwOnError();

      const workspaceIds = (workspaces ?? []).map((w) => w.id);
      const kbSectionId = workspaceIds[0];
      const bidId = workspaceIds[1];
      const projectId = workspaceIds[2];

      // --- Workspace-item assignments: link items 0-3 to kb_section ---
      const junctionRecords = itemIds.slice(0, 4).map((contentItemId) => ({
        content_item_id: contentItemId,
        workspace_id: kbSectionId,
      }));

      await supabase
        .from('content_item_workspaces')
        .insert(junctionRecords)
        .throwOnError();

      // --- Bid questions (from centralised shapes) ---
      const questions = CORE_BID_QUESTIONS.map((q) => ({
        ...q,
        project_id: bidId,
      }));

      const { data: qs } = await supabase
        .from('bid_questions')
        .insert(questions)
        .select('id')
        .throwOnError();

      const questionIds = (qs ?? []).map((q) => q.id);

      // --- Bid responses (from centralised shapes) ---
      const responses = CORE_BID_RESPONSES.map((r, i) => ({
        ...r,
        question_id: questionIds[i],
      }));

      const { data: resps } = await supabase
        .from('bid_responses')
        .insert(responses)
        .select('id')
        .throwOnError();

      const responseIds = (resps ?? []).map((r) => r.id);

      // --- Advance bid to drafting state ---
      for (const state of BID_STATE_TRANSITIONS) {
        const { data: current } = await supabase
          .from('workspaces')
          .select('domain_metadata')
          .eq('id', bidId)
          .single()
          .throwOnError();

        const currentMetadata =
          (current?.domain_metadata as Record<string, unknown>) ?? {};

        await supabase
          .from('workspaces')
          .update({
            domain_metadata: { ...currentMetadata, status: state },
          })
          .eq('id', bidId)
          .throwOnError();
      }

      // --- Notifications and read marks require admin user_id ---
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .limit(1)
        .single();

      const adminUserId = adminRole?.user_id;

      let notificationIds: string[] = [];
      if (adminUserId) {
        // --- Notifications: 1 unread quality flag, 1 read governance review ---
        const notifications = [
          {
            user_id: adminUserId,
            type: 'quality_flag',
            entity_type: 'content_item',
            entity_id: itemIds[3], // stale item (Cyber Essentials)
            title: `${prefix} Content needs review`,
            message: 'This content item has become stale and requires review.',
          },
          {
            user_id: adminUserId,
            type: 'governance_review_needed',
            entity_type: 'content_item',
            entity_id: itemIds[4], // expired item (Pricing Model)
            title: `${prefix} Item expired`,
            message:
              'This content item has expired and should be updated or archived.',
            read_at: new Date().toISOString(),
          },
        ];

        const { data: notifs } = await supabase
          .from('notifications')
          .insert(notifications)
          .select('id')
          .throwOnError();

        notificationIds = (notifs ?? []).map((n) => n.id);

        // --- Read marks: 2 items marked as read by admin ---
        const readMarks = [
          {
            user_id: adminUserId,
            content_item_id: itemIds[0], // article (IT Support Policy)
            source: 'detail_view',
          },
          {
            user_id: adminUserId,
            content_item_id: itemIds[1], // Q&A pair (What is your SLA?)
            source: 'browse',
          },
        ];

        await supabase.from('read_marks').insert(readMarks).throwOnError();
      }

      const data: WorkerData = {
        contentItemIds: itemIds,
        articleId: itemIds[0],
        qaPairId: itemIds[1],
        qaPairTechId: itemIds[2],
        noteId: itemIds[4], // Pricing Model Template (note type)
        staleItemId: itemIds[3],
        expiredItemId: itemIds[4],
        certificationId: itemIds[5],
        caseStudyId: itemIds[6],
        methodologyId: itemIds[7],
        socialValueId: itemIds[8],
        dataProtectionId: itemIds[9],
        peopleSkillsId: itemIds[10],
        environmentalId: itemIds[11],
        workspaceId: kbSectionId,
        bidId,
        projectId,
        questionIds,
        responseIds,
        notificationIds,
        prefix,
        embeddedItemIndices: EMBEDDING_ITEM_INDICES,
      };

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeded: ${data.contentItemIds.length} items ` +
          `(${precomputedEmbeddings.length} with embeddings), ` +
          `3 workspaces, 1 bid (drafting) with ${data.questionIds.length} questions and ` +
          `${data.responseIds.length} responses, ${data.notificationIds.length} notifications ` +
          `(prefix: ${prefix})`,
      );

      await use(data);

      // --- Teardown: clean up this worker's data ---
      console.log(
        `[Worker ${workerInfo.workerIndex}] Cleaning up ${prefix} data...`,
      );

      // Delete in dependency order to avoid FK constraint violations.

      // 1. Read marks (FK -> content_items)
      if (adminUserId) {
        await supabase
          .from('read_marks')
          .delete()
          .eq('user_id', adminUserId)
          .in('content_item_id', itemIds);
      }

      // 2. Notifications (by ID)
      if (notificationIds.length > 0) {
        await supabase.from('notifications').delete().in('id', notificationIds);
      }

      // 3. Bid responses (safety net — CASCADE from workspace should handle)
      if (responseIds.length > 0) {
        await supabase.from('bid_responses').delete().in('id', responseIds);
      }

      // 4. Content-item-workspace junctions (CASCADE from workspace should handle)
      await supabase
        .from('content_item_workspaces')
        .delete()
        .eq('workspace_id', kbSectionId);

      // 5. Content items and workspaces (by prefix)
      await supabase
        .from('content_items')
        .delete()
        .like('title', `${prefix}%`);
      await supabase
        .from('workspaces')
        .delete()
        .like('name', `${prefix}%`);
    },
    { scope: 'worker' },
  ],
});
