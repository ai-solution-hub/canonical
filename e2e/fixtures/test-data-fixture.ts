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
  INTELLIGENCE_FEED_SOURCE,
  buildIntelligenceFeedArticles,
  buildEntityMentions,
  buildEntityRelationships,
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
  /** ID of the seeded intelligence workspace. */
  intelligenceWorkspaceId: string;
  /** ID of the seeded intelligence feed source. */
  intelligenceFeedSourceId: string;
  /** IDs of the seeded feed articles (2 passed + 1 filtered). */
  feedArticleIds: string[];
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
        thirtyDaysAgo: new Date(
          now - FRESHNESS_OFFSETS.THIRTY_DAYS_MS,
        ).toISOString(),
        sixtyDaysAgo: new Date(
          now - FRESHNESS_OFFSETS.SIXTY_DAYS_MS,
        ).toISOString(),
        ninetyDaysAgo: new Date(
          now - FRESHNESS_OFFSETS.NINETY_DAYS_MS,
        ).toISOString(),
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

      // --- Seed entity_mentions for the entity filter UI and certifications card ---
      //
      // We chain `.select('id')` here for two reasons:
      //   1. It forces PostgREST to return 200 + the inserted row from the
      //      same statement, instead of 204 No Content. This guarantees the
      //      INSERT's COMMIT is fully visible on the client's connection
      //      before control returns — protecting against the FK-race
      //      symptom S152A WP3 saw under `--workers=3` where two workers'
      //      seed operations could interleave on the pgbouncer pool and
      //      one worker's entity_mentions INSERT could fire before the
      //      content_items COMMIT was visible. (S152B WP15 item #15,
      //      Symptom 1.)
      //   2. It also sidesteps the Bun-fetch-204-hang gotcha (CLAUDE.md
      //      §Supabase) when a developer runs the seeder through the
      //      Claude Code sandbox proxy.
      const entityMentionShapes = buildEntityMentions();
      const entityMentionInserts = entityMentionShapes
        .filter((m) => itemIds[m.itemIndex])
        .map((m) => ({
          content_item_id: itemIds[m.itemIndex],
          canonical_name: m.canonical_name,
          entity_name: m.entity_name,
          entity_type: m.entity_type,
          confidence: m.confidence ?? 0.9,
          context_snippet: m.context_snippet ?? null,
          metadata: m.metadata ?? {},
        }));
      if (entityMentionInserts.length > 0) {
        await supabase
          .from('entity_mentions')
          .insert(entityMentionInserts)
          .select('id')
          .throwOnError();
      }

      // --- Seed entity_relationships ('holds') so /api/certifications populates ---
      // See the entity_mentions block above for why we chain `.select('id')`.
      const entityRelationshipShapes = buildEntityRelationships();
      const entityRelationshipInserts = entityRelationshipShapes
        .filter((r) => itemIds[r.itemIndex])
        .map((r) => ({
          source_item_id: itemIds[r.itemIndex],
          source_entity: r.source_entity,
          target_entity: r.target_entity,
          relationship_type: r.relationship_type,
          confidence: r.confidence ?? 0.9,
        }));
      if (entityRelationshipInserts.length > 0) {
        await supabase
          .from('entity_relationships')
          .insert(entityRelationshipInserts)
          .select('id')
          .throwOnError();
      }

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
      // Clean up stale data from a previous crashed run to avoid
      // workspaces_type_name_unique constraint violations
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);

      const bidDeadline = new Date(
        now + FRESHNESS_OFFSETS.FOURTEEN_DAYS_FUTURE_MS,
      ).toISOString();
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
      //
      // We carry `liveMetadata` through the loop locally instead of issuing
      // a fresh SELECT per iteration to merge with existing JSONB. The
      // previous SELECT-then-UPDATE-per-state pattern raced against the
      // pgbouncer transaction-pooler under `--workers=3`: a SELECT
      // immediately after an UPDATE on a different pgbouncer connection
      // could land before the UPDATE was visible, returning 0 rows and
      // causing the next iteration to merge against an empty object —
      // dropping every JSONB key the previous iteration had set
      // (including `buyer` and `deadline` from the original
      // `buildCoreWorkspaces` shape). We now seed `liveMetadata` directly
      // from the workspace shape we know we just inserted (the second
      // `buildCoreWorkspaces` entry is the bid) and update it locally
      // each iteration. The only network calls inside the loop are the
      // UPDATEs themselves, so there's no read-after-write hazard.
      // (S152B WP15 item #15, Symptom 2.)
      const initialBidMetadata =
        (workspaceShapes[1]?.domain_metadata as
          | Record<string, unknown>
          | undefined) ?? {};
      let liveMetadata: Record<string, unknown> = { ...initialBidMetadata };
      for (const state of BID_STATE_TRANSITIONS) {
        const nextMetadata = { ...liveMetadata, status: state };
        await supabase
          .from('workspaces')
          .update({
            status: state,
            domain_metadata: nextMetadata,
          })
          .eq('id', bidId)
          .throwOnError();
        liveMetadata = nextMetadata;
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

      // --- Intelligence workspace, feed source, and articles ---
      const { data: intelWorkspace } = await supabase
        .from('workspaces')
        .insert({
          name: `${prefix} Cyber Security Intel`,
          description: 'E2E worker-scoped intelligence workspace.',
          type: 'intelligence',
          domain_metadata: {},
        })
        .select('id')
        .single()
        .throwOnError();

      const intelligenceWorkspaceId = intelWorkspace?.id ?? '';

      const { data: feedSource } = await supabase
        .from('feed_sources')
        .insert({
          ...INTELLIGENCE_FEED_SOURCE,
          name: `${prefix} ${INTELLIGENCE_FEED_SOURCE.name}`,
          workspace_id: intelligenceWorkspaceId,
        })
        .select('id')
        .single()
        .throwOnError();

      const intelligenceFeedSourceId = feedSource?.id ?? '';

      // Seed 3 feed articles (2 passed, 1 filtered)
      const articleShapes = buildIntelligenceFeedArticles(timestamps.now);
      const feedArticleInserts = articleShapes.map((shape) => ({
        ...shape,
        title: `${prefix} ${shape.title}`,
        workspace_id: intelligenceWorkspaceId,
        feed_source_id: intelligenceFeedSourceId,
      }));

      const { data: feedArticles } = await supabase
        .from('feed_articles')
        .insert(feedArticleInserts)
        .select('id')
        .throwOnError();

      const feedArticleIds = (feedArticles ?? []).map(
        (a: { id: string }) => a.id,
      );

      // Create content items for the 2 passed articles and link to workspace
      const passedArticleShapes = articleShapes.filter((a) => a.passed);
      const intelContentItems = passedArticleShapes.map((shape) => ({
        title: `${prefix} ${shape.title}`,
        content_type: 'article' as const,
        primary_domain: 'Market Intelligence',
        summary: shape.ai_summary ?? '',
        platform: 'web',
        content: shape.ai_summary ?? '',
        source_url: shape.external_url,
      }));

      const { data: intelItems } = await supabase
        .from('content_items')
        .insert(intelContentItems)
        .select('id')
        .throwOnError();

      const intelItemIds = (intelItems ?? []).map(
        (i: { id: string }) => i.id,
      );

      // Link content items to intelligence workspace
      if (intelItemIds.length > 0) {
        await supabase
          .from('content_item_workspaces')
          .insert(
            intelItemIds.map((contentItemId: string) => ({
              content_item_id: contentItemId,
              workspace_id: intelligenceWorkspaceId,
            })),
          )
          .throwOnError();

        // Update feed articles with content_item_id
        const passedFeedArticleIds = feedArticleIds.filter(
          (_: string, i: number) => articleShapes[i]?.passed,
        );
        for (let i = 0; i < passedFeedArticleIds.length && i < intelItemIds.length; i++) {
          await supabase
            .from('feed_articles')
            .update({ content_item_id: intelItemIds[i] })
            .eq('id', passedFeedArticleIds[i])
            .throwOnError();
        }
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
        intelligenceWorkspaceId,
        intelligenceFeedSourceId,
        feedArticleIds,
        prefix,
        embeddedItemIndices: EMBEDDING_ITEM_INDICES,
      };

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeded: ${data.contentItemIds.length} items ` +
          `(${precomputedEmbeddings.length} with embeddings), ` +
          `4 workspaces (incl. intelligence), 1 bid (drafting) with ${data.questionIds.length} questions and ` +
          `${data.responseIds.length} responses, ${data.notificationIds.length} notifications, ` +
          `${data.feedArticleIds.length} feed articles ` +
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

      // 5. Entity mentions and relationships (FK -> content_items)
      if (itemIds.length > 0) {
        await supabase
          .from('entity_mentions')
          .delete()
          .in('content_item_id', itemIds);
        await supabase
          .from('entity_relationships')
          .delete()
          .in('source_item_id', itemIds);
      }

      // 6. Content items and workspaces (by prefix)
      await supabase.from('content_items').delete().like('title', `${prefix}%`);
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);
    },
    { scope: 'worker' },
  ],
});
