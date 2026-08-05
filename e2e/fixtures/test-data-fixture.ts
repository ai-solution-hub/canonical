/* eslint-disable @typescript-eslint/no-empty-object-type -- Playwright fixture API requires {} for test-scoped type parameter */
import { test as base } from '@playwright/test';
import type { Tables } from '@/supabase/types/database.types';
import { createServiceClient } from './supabase';
import {
  FRESHNESS_OFFSETS,
  buildCoreContentItems,
  buildCoreWorkspaces,
  buildCoreFormInstances,
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
 * notifications, read marks. Procurement advanced to drafting state.
 *
 * Phase 3 (S75): pre-computed embeddings for 5 items (search tests).
 * Phase 5 (S75): data shapes centralised in test-data.ts.
 *
 * ID-131.19 M6 retirement (S450 GO tail): `content_items`, `read_marks`,
 * and `content_item_workspaces` were all DROPPED at M6 — see the seeding
 * block below for the full q_a_pairs/source_documents re-point and what
 * lost its destination entirely (read marks; the feed-article <-> document
 * link).
 *
 * id-401 (S515) — id-396 `[D4 RATIFIED S511 (amended)]` e2e BODY RULE:
 * every seeded `source_documents` row carries a position-0 `content_chunks`
 * body. Before this fix the seeder wrote NO body for any of its 12 documents,
 * so every reader composing through `lib/source-documents/body.ts` (which
 * reads `content_chunks.content` ordered by `position` — `extracted_text` is
 * permanently NULL post id-392) saw `null`. The shapes in `test-data.ts`
 * already carried the body text in `ContentItemShape.content`; the
 * `source_documents` insert simply dropped it on the floor. Bodies are now
 * written via `seedDocumentBodies` at BOTH document-insert sites.
 *
 * DEFERRED HALF of D4 — see `seedDocumentBodies` for the full note. The rule
 * also says bodies should be "sourced from manifest corpus files, OR declared
 * body-less in the manifest". **The manifest now EXISTS** (id-406, S523):
 * `docs/reference/testing/corpus-manifest.json` — DR-118, not the spec's dead
 * `docs/testing/` path — with its guard at
 * `__tests__/validation/corpus-manifest.test.ts`. So the "declared body-less"
 * half is expressible for the first time. Bodies still come from the shapes
 * here; re-pointing them is a deliberate follow-up, not an oversight (see
 * `seedDocumentBodies`).
 *
 * D4 LANE BOUNDARY: this fixture manufactures programmatic states for e2e to
 * assert app behaviour against. Proving corpus→rows is the INGESTION lane's
 * job, not this file's — do not grow full corpus-driven seeding in here.
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
  /**
   * ID of the seeded primary bid — a `form_instances` row (ID-145 {145.6}
   * form-first re-architecture; NOT a `workspaces` row post-W1), advanced to
   * `drafting` via `workflow_state`.
   */
  procurementId: string;
  /**
   * ID of the seeded second `form_instances` row ("Cloud Migration RFP").
   * No live spec asserts on it by name — retained for card-count parity.
   */
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
  /**
   * ID of the seeded active scoring prompt (`feed_prompts` version 1) for the
   * intelligence workspace — without it the filter-rules page renders only its
   * "No filter rules configured" empty state.
   */
  intelligenceFeedPromptId: string;
  /** IDs of the seeded feed articles (2 passed + 1 filtered). */
  feedArticleIds: string[];
  /**
   * Freshness buckets this worker guarantees on the dashboard's Content Health
   * strip, applied to `record_lifecycle` (post-M6 `source_documents` has no
   * freshness columns). Dashboard counts are corpus-wide, so specs assert
   * these as lower bounds.
   */
  seededFreshnessCounts: {
    fresh: number;
    aging: number;
    stale: number;
    expired: number;
  };
  /** Worker-unique prefix (e.g. "[E2E-W0]") for data isolation. */
  prefix: string;
  /** Indices of content items that have pre-computed embeddings. */
  embeddedItemIndices: readonly number[];
}

/**
 * Write the reader-visible document body for freshly-seeded
 * `source_documents` rows — one position-0 `content_chunks` row each.
 *
 * id-396 `[D4 RATIFIED S511 (amended)]`, implemented under id-401 (S515).
 * Matches the id-392 M6 worked precedent verbatim
 * (`e2e/tests/publication-bulk-action.e2e.spec.ts`,
 * `scripts/seed-e2e-users.ts` `ensurePublicationReviewFixtureChunk`):
 * `source_documents.extracted_text` is legacy and permanently NULL on the
 * pipeline path, so every reader composes the body from
 * `content_chunks.content` ordered by `position` via
 * `lib/source-documents/body.ts`. A seeded document with no chunk row reads
 * back as a body-less document.
 *
 * No teardown step is needed: `content_chunks_source_document_id_fkey` is
 * ON DELETE CASCADE (`20260628200000_id131_extract_reparent.sql`), so the
 * existing by-id `source_documents` delete in this fixture's teardown takes
 * the chunks with it.
 *
 * THE MANIFEST HALF OF D4 — the manifest LANDED at S523 (id-406). Until then
 * this note said the manifest and its guard did not exist, and pointed at the
 * path id-396 TECH §1 specified under the old `docs/testing/` tree; both halves
 * of that are now false and that tree is gone. The register is
 * `docs/reference/testing/corpus-manifest.json` (DR-118), its guard is
 * `__tests__/validation/corpus-manifest.test.ts`, and the loader is
 * `lib/corpus/fixture-manifest.ts`.
 *
 * What that unblocks: D4 reads "sourced from manifest corpus files, OR
 * declared body-less in the manifest". The second half is now EXPRESSIBLE —
 * an entry can carry that declaration and the guard can enforce it. id-401
 * could only ship the enforceable half in S515 for want of exactly this.
 *
 * What has NOT been done, deliberately: these bodies still come from the
 * shapes in `test-data.ts`, which already carry authored body text.
 * Re-pointing them at registered corpus files is a behavioural change to the
 * e2e seed and belongs to a lane that can prove the resulting states still
 * assert what the specs expect — not to the task that built the register. The
 * D4 LANE BOUNDARY below still governs: proving corpus->rows is the INGESTION
 * lane's job.
 *
 * SUPABASE-WRAPPER EXCEPTION (documented, PR #158 review). The repo guideline
 * routes Supabase access through `sb()` / `tryQuery()` from
 * `@/lib/supabase/safe`. This file does not, and this write deliberately
 * matches it: the whole `e2e/` tree is wrapper-free (zero imports of
 * `lib/supabase/safe`), and this fixture alone holds 20 `.throwOnError()`
 * chains on a `createServiceClient()`. Converting one of them would leave the
 * file internally inconsistent without closing the class. The guideline exists
 * to stop a silently-dropped `error` channel; `.throwOnError()` is the
 * fail-loud form and satisfies that intent — a seed failure aborts the worker's
 * setup rather than yielding a half-seeded fixture. Migrating `e2e/` to the
 * wrapper wholesale is its own change.
 */
async function seedDocumentBodies(
  supabase: ReturnType<typeof createServiceClient>,
  bodies: { sourceDocumentId: string; body: string }[],
): Promise<void> {
  if (bodies.length === 0) return;
  await supabase
    .from('content_chunks')
    .insert(
      bodies.map(({ sourceDocumentId, body }) => ({
        source_document_id: sourceDocumentId,
        content: body,
        position: 0,
      })),
    )
    .throwOnError();
}

/**
 * Extended test with a worker-scoped `workerData` fixture.
 *
 * Each Playwright worker seeds its own isolated set of test data using a
 * unique prefix like `[E2E-W0]`. Data is cleaned up automatically when
 * the worker finishes.
 *
 * Seeded entities:
 * - 12 "content items" (article, 2 q_a_pairs, certification, case_study,
 *   methodology, 4 policies, note) across 7 domains — ID-131.19 M6
 *   retirement: `content_items` was DROPPED at M6, so the 2 q_a_pair-typed
 *   shapes land on `q_a_pairs` and the other 10 land on `source_documents`
 *   (see the seeding block below for the full disposition + what's lost).
 * - 1 kb_section workspace
 * - 2 procurement items (`form_instances` rows, ID-145 W1 form-first
 *   re-architecture — NOT `workspaces` rows) — the primary one with 4
 *   questions and 2 responses, advanced to `drafting` state
 * - 2 workspace-item assignments (source_documents indices 0, 3 -> kb_section;
 *   the 2 q_a_pairs indices have no workspace_id column to assign)
 * - 2 notifications (freshness_alert + governance_review)
 * - 5 pre-computed embeddings (items 0, 1, 2, 3, 7), now via `record_embeddings`
 * - 1 intelligence workspace + 1 feed source + 3 feed articles + 1 ACTIVE
 *   `feed_prompts` version (the filter-rules page gates its entire UI on a
 *   non-empty prompt list)
 * - freshness/lifecycle applied to the seeded documents' trigger-minted
 *   `record_lifecycle` rows (1 stale, 1 expired, 2 aging) — post-M6 the
 *   freshness axis no longer lives on `source_documents`
 */
export const test = base.extend<{}, { workerData: WorkerData }>({
  workerData: [
    async ({}, use, workerInfo) => {
      const supabase = createServiceClient();
      // id-128 {128.7}: shard-aware prefix so concurrent shards don't collide on
      // the shared staging DB. Each shard restarts workerIndex at 0, so without
      // the shard component shard-1-W0 and shard-2-W0 would both seed `[E2E-W0]`
      // and clobber each other's rows. The cleanup/teardown sweeps already match
      // `[E2E-%` broadly, so both shapes are reaped. Smoke/local (no --shard →
      // config.shard is null) keep the original `[E2E-W{n}]` prefix unchanged.
      const shard = workerInfo.config.shard;
      const prefix = shard
        ? `[E2E-S${shard.current}-W${workerInfo.workerIndex}]`
        : `[E2E-W${workerInfo.workerIndex}]`;

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
      //
      // ID-131.19 M6 retirement note (S450 GO tail): `content_items` was
      // DROPPED at M6. No single surviving table is shaped like the old
      // god-table, so the 12 shapes split across two destinations:
      //   - The 2 Q&A-typed shapes (indices 1, 2) -> `q_a_pairs` (the same
      //     table `/library` reads — {131.21} G-MANUAL-QA).
      //   - The other 10 generic shapes (article/policy/note/
      //     certification/case_study/methodology/other) -> `source_documents`
      //     (the corpus's other surviving generic-document table), using
      //     only the fields that exist there (filename/primary_domain/
      //     summary/source_url/content_type). Rich content_items-only
      //     fields (brief/detail/reference/freshness/lifecycle_type/
      //     expiry_date/verified_at/metadata) have no destination and are
      //     dropped — the specs that read them (browse-search/
      //     entity-filters/item-detail/wave1-item-detail-dates.spec.ts)
      //     already exercise `/browse` and `/item/[id]`, BOTH deleted at
      //     ID-131.17 (pre-existing, unrelated to M6 — see this Subtask's
      //     journal for the full finding).
      // `itemIds` is reassembled in the ORIGINAL 12-shape order so every
      // downstream index reference (WorkerData fields, entity fixtures,
      // embeddings) is unchanged.
      const QA_SHAPE_INDICES = new Set([1, 2]);
      const contentItemShapes = buildCoreContentItems(timestamps);

      const qaShapeEntries = contentItemShapes
        .map((shape, index) => ({ shape, index }))
        .filter(({ index }) => QA_SHAPE_INDICES.has(index));
      const sdShapeEntries = contentItemShapes
        .map((shape, index) => ({ shape, index }))
        .filter(({ index }) => !QA_SHAPE_INDICES.has(index));

      const itemIds: string[] = new Array(contentItemShapes.length).fill('');
      // Real ids only (no empty-string placeholders) — the source of truth
      // for embeddings/entity-linking/cleanup below.
      const qaPairIds: string[] = [];
      const sourceDocumentIds: string[] = [];

      if (qaShapeEntries.length > 0) {
        const { data: qaRows } = await supabase
          .from('q_a_pairs')
          .insert(
            qaShapeEntries.map(({ shape }) => ({
              question_text: `${prefix} ${shape.title}`,
              answer_standard: shape.answer_standard ?? shape.content,
              answer_advanced: shape.answer_advanced ?? null,
              publication_status: 'published',
            })),
          )
          .select('id')
          .throwOnError();
        (qaRows ?? []).forEach((row: { id: string }, i: number) => {
          itemIds[qaShapeEntries[i]!.index] = row.id;
          qaPairIds.push(row.id);
        });
      }

      if (sdShapeEntries.length > 0) {
        const { data: sdRows } = await supabase
          .from('source_documents')
          .insert(
            sdShapeEntries.map(({ shape, index }) => ({
              filename: `${prefix} ${shape.title}`,
              primary_domain: shape.primary_domain,
              summary: shape.summary,
              content_type: shape.content_type,
              source_url: shape.source_url ?? null,
              status: 'processed',
              // {128.14} Class 3 (S457 nightly diagnosis): source_documents
              // has 4 NOT-NULL no-default columns this insert omitted,
              // throwing on every worker's seed setup. Mirrors the
              // established e2e placeholder convention
              // (scripts/seed-e2e-users.ts seedPublicationReviewFixture,
              // publication-bulk-action.e2e.spec.ts) — fixed mime_type/
              // file_size placeholder; content_hash/storage_path scoped by
              // prefix+index so concurrent workers/rows never collide.
              mime_type: 'text/plain',
              file_size: 1,
              content_hash: `${prefix}-sd-${index}`,
              storage_path: `test-fixtures/${prefix}/sd-${index}.txt`,
            })),
          )
          .select('id')
          .throwOnError();
        (sdRows ?? []).forEach((row: { id: string }, i: number) => {
          itemIds[sdShapeEntries[i]!.index] = row.id;
          sourceDocumentIds.push(row.id);
        });

        // id-401 / id-396 D4 body rule: give each seeded document its
        // reader-visible position-0 `content_chunks` body. `shape.content`
        // is the body text these fixtures have always carried — the insert
        // above drops it (no `source_documents` column holds it post-M6),
        // which is exactly why these rows read back body-less before this
        // fix. Reuses the same `sdRows[i] -> sdShapeEntries[i]` pairing the
        // `itemIds` mapping above already depends on, so no new ordering
        // assumption is introduced.
        await seedDocumentBodies(
          supabase,
          (sdRows ?? []).map(
            (row: Pick<Tables<'source_documents'>, 'id'>, i: number) => ({
              sourceDocumentId: row.id,
              body: sdShapeEntries[i]!.shape.content,
            }),
          ),
        );
      }

      // --- Restore the freshness/lifecycle axis on `record_lifecycle` ---
      //
      // ID-131.19 M6 retirement: `source_documents` carries NO freshness,
      // freshness_checked_at, lifecycle_type or expiry_date columns — that
      // whole axis moved to the polymorphic `record_lifecycle` table, so the
      // shapes' lifecycle fields were silently dropped by the insert above
      // and every seeded document read back as `fresh`. The dashboard's
      // `get_dashboard_attention_counts` RPC computes its freshness summary
      // from `record_lifecycle` joined to `source_documents`, so with all
      // rows fresh `QuickStatsStrip` renders no Aging/Stale/Expired tiles at
      // all (dashboard.spec.ts §3 "unhealthy content indicators").
      //
      // This is an UPDATE, not an INSERT: `source_documents` carries an
      // AFTER INSERT trigger (`trg_record_lifecycle_mint_source_document`)
      // that already minted exactly one `record_lifecycle` row per document
      // with `freshness` defaulted to 'fresh'. `record_lifecycle.owner_id` is
      // a GENERATED STORED column (`COALESCE(source_document_id,
      // q_a_pair_id)`) under UNIQUE (owner_kind, owner_id), so a second
      // INSERT for the same document is a constraint violation.
      const FRESHNESS_STATES = ['fresh', 'aging', 'stale', 'expired'] as const;
      type FreshnessState = (typeof FRESHNESS_STATES)[number];

      const lifecycleShapeEntries = sdShapeEntries.filter(
        ({ shape }) =>
          shape.freshness !== undefined ||
          shape.freshness_checked_at !== undefined ||
          shape.lifecycle_type !== undefined ||
          shape.expiry_date !== undefined,
      );

      await Promise.all(
        lifecycleShapeEntries
          .filter(({ index }) => Boolean(itemIds[index]))
          .map(({ shape, index }) =>
            supabase
              .from('record_lifecycle')
              .update({
                freshness: shape.freshness ?? 'fresh',
                freshness_checked_at: shape.freshness_checked_at ?? null,
                lifecycle_type: shape.lifecycle_type ?? 'evergreen',
                expiry_date: shape.expiry_date ?? null,
              })
              .eq('owner_kind', 'source_document')
              .eq('source_document_id', itemIds[index]!)
              .throwOnError(),
          ),
      );

      // Freshness buckets this worker guarantees on the dashboard. Every
      // `source_documents` row gets a minted `record_lifecycle` row, so any
      // shape without an explicit `freshness` counts towards `fresh`.
      const seededFreshnessCounts: Record<FreshnessState, number> = {
        fresh: 0,
        aging: 0,
        stale: 0,
        expired: 0,
      };
      for (const { shape } of sdShapeEntries) {
        const state = (shape.freshness ?? 'fresh') as FreshnessState;
        if (FRESHNESS_STATES.includes(state)) {
          seededFreshnessCounts[state] += 1;
        }
      }

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
          source_document_id: itemIds[m.itemIndex],
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
          source_document_id: itemIds[r.itemIndex],
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
      //
      // ID-131.19 M6 retirement: content_items.embedding (inline vector
      // column) has no source_documents/q_a_pairs analog — vector storage
      // moved to the polymorphic `record_embeddings` table (BI-17
      // EMB-STORE). Route each embedding to the owner_kind matching where
      // its itemIndex landed above (q_a_pair vs source_document).
      await Promise.all(
        precomputedEmbeddings
          .filter((e) => itemIds[e.itemIndex])
          .map((e) =>
            supabase
              .from('record_embeddings')
              .insert({
                owner_kind: QA_SHAPE_INDICES.has(e.itemIndex)
                  ? 'q_a_pair'
                  : 'source_document',
                owner_id: itemIds[e.itemIndex],
                model: 'text-embedding-3-large',
                embedding: JSON.stringify(e.embedding),
              })
              .throwOnError(),
          ),
      );

      // --- Seed the kb_section workspace (from centralised shapes) ---
      // Clean up stale data from a previous crashed run to avoid
      // workspaces_type_name_unique constraint violations
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);

      const bidDeadline = new Date(
        now + FRESHNESS_OFFSETS.FOURTEEN_DAYS_FUTURE_MS,
      ).toISOString();

      // S246 WP2b T2 (migration 20260520120828): `workspaces.type` was DROPPED
      // and replaced by a NOT-NULL `application_type_id` FK. Resolve the
      // `application_types.key` referenced by each shape to its id once, then
      // map shapes -> insert rows. `application_types.id` is gen_random_uuid()
      // (NOT stable across Supabase branches), so we query rather than hardcode.
      const { data: appTypeRows } = await supabase
        .from('application_types')
        .select('id, key')
        .throwOnError();
      const appTypeIdByKey = new Map(
        (appTypeRows ?? []).map((r) => [r.key, r.id]),
      );
      const resolveAppTypeId = (key: string): string => {
        const id = appTypeIdByKey.get(key);
        if (!id) {
          throw new Error(
            `[test-data-fixture] No application_types row for key '${key}'. ` +
              `Available keys: ${[...appTypeIdByKey.keys()].join(', ')}`,
          );
        }
        return id;
      };

      const workspaceShapes = buildCoreWorkspaces();
      const workspaceInserts = workspaceShapes.map((shape) => {
        const { applicationTypeKey, ...rest } = shape;
        return {
          ...rest,
          name: `${prefix} ${shape.name}`,
          application_type_id: resolveAppTypeId(applicationTypeKey),
        };
      });

      const { data: workspaces } = await supabase
        .from('workspaces')
        .insert(workspaceInserts)
        .select('id')
        .throwOnError();

      const workspaceIds = (workspaces ?? []).map((w) => w.id);
      const kbSectionId = workspaceIds[0];

      // --- Seed the procurement items (from centralised shapes) ---
      //
      // ID-145 {145.6} W1 form-first re-architecture (BI-1): a procurement
      // item IS a `form_instances` row directly — the pre-W1 `workspaces` +
      // `domain_metadata` umbrella is wholesale-deleted for procurement
      // (W1e). NOT NULL columns with no usable default post-W1c: `filename`/
      // `storage_path`/`file_size`/`mime_type` (doc-identity placeholders,
      // mirroring the {145.8} POST /api/procurement docless-mint convention)
      // and `ingest_source` (DEFAULT is the now-CHECK-invalid legacy
      // 'pipeline' value — must be set explicitly to 'minted', the reserved
      // docless-creation value, TECH.md §2 M3).
      const formInstanceShapes = buildCoreFormInstances(bidDeadline);
      const formInstanceInserts = formInstanceShapes.map((shape, index) => ({
        name: `${prefix} ${shape.name}`,
        description: shape.description,
        issuing_organisation: shape.issuing_organisation,
        deadline: shape.deadline,
        reference_number: shape.reference_number,
        estimated_value: shape.estimated_value,
        filename: 'e2e-fixture-form.pdf',
        storage_path: `test-fixtures/${prefix}/form-instance-${index}.pdf`,
        file_size: 0,
        mime_type: 'application/pdf',
        ingest_source: 'minted',
      }));

      const { data: formInstances } = await supabase
        .from('form_instances')
        .insert(formInstanceInserts)
        .select('id')
        .throwOnError();

      const formInstanceIds = (formInstances ?? []).map((f) => f.id);
      const procurementId = formInstanceIds[0];
      const projectId = formInstanceIds[1];

      // --- Workspace-item assignments: link items 0-3 to kb_section ---
      //
      // ID-131.19 M6 retirement: `content_item_workspaces` (many-to-many
      // junction) was DROPPED at M6 — `source_documents` now carries a
      // direct `workspace_id` FK column instead. Of items 0-3, only indices
      // 0 and 3 are `source_documents` rows (1 and 2 are `q_a_pairs`, which
      // has no workspace_id column at all — this narrows the original
      // 4-item link to 2; no live spec asserts on the q_a_pairs items'
      // workspace membership).
      const kbSectionItemIds = [itemIds[0], itemIds[3]].filter(
        (id): id is string => Boolean(id) && sourceDocumentIds.includes(id),
      );
      if (kbSectionItemIds.length > 0) {
        await supabase
          .from('source_documents')
          .update({ workspace_id: kbSectionId })
          .in('id', kbSectionItemIds)
          .throwOnError();
      }

      // --- Procurement questions + responses (from centralised shapes) ---
      // id-130 renamed the bid-prefixed tables onto the form-domain model:
      // `bid_questions` → `form_questions` and `bid_responses` →
      // `form_responses`. {130.9} regenerated the api.* views on top of the
      // renamed tables, so this seed runs unconditionally for every worker
      // again (bl-420 retired the temporary env-gated skip that covered this
      // block while the rename was in flight). ID-145 {145.6} W1c STEP 4
      // re-scopes `form_questions`: `workspace_id` is DROPPED and
      // `form_template_id` is renamed to `form_instance_id` (NOT NULL,
      // BI-7 — every question belongs to exactly one form by construction).
      // The downstream cleanup is guarded by `responseIds.length > 0`, so
      // empty arrays remain safe if seeding is ever skipped for another
      // reason.
      const questions = CORE_BID_QUESTIONS.map((q) => ({
        ...q,
        form_instance_id: procurementId,
      }));

      const { data: qs } = await supabase
        .from('form_questions')
        .insert(questions)
        .select('id')
        .throwOnError();

      const questionIds: string[] = (qs ?? []).map((q) => q.id);

      const responses = CORE_BID_RESPONSES.map((r, i) => ({
        ...r,
        question_id: questionIds[i],
      }));

      const { data: resps } = await supabase
        .from('form_responses')
        .insert(responses)
        .select('id')
        .throwOnError();

      const responseIds: string[] = (resps ?? []).map((r) => r.id);

      // --- Advance bid to drafting state ---
      //
      // ID-145 {145.6}/{145.18}: `workflow_state` is a plain scalar column on
      // `form_instances` (the pre-W1 `domain_metadata` JSONB read-modify-write
      // dance — and the pgbouncer read-after-write race it worked around,
      // S152B WP15 item #15 Symptom 2 — no longer applies; each UPDATE here
      // carries the full, self-contained next state, so there is nothing to
      // merge and no SELECT-between-UPDATEs hazard).
      for (const state of BID_STATE_TRANSITIONS) {
        await supabase
          .from('form_instances')
          .update({ workflow_state: state })
          .eq('id', procurementId)
          .throwOnError();
      }

      // --- Intelligence workspace, feed source, and articles ---
      const { data: intelWorkspace } = await supabase
        .from('workspaces')
        .insert({
          name: `${prefix} Cyber Security Intel`,
          description: 'E2E worker-scoped intelligence workspace.',
          // S246 WP2b T2: `type` column dropped; use the application_type_id FK.
          application_type_id: resolveAppTypeId('intelligence'),
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

      // --- Active scoring prompt for the intelligence workspace ---
      //
      // `/intelligence/[workspaceId]/filter-rules` short-circuits to
      // "No filter rules configured for this workspace yet." when
      // `GET /api/intelligence/workspaces/{id}/prompts` returns an empty
      // array — the RefinementPanel, the advanced-editor disclosure and the
      // version sidebar are all behind that gate
      // (si-prompt-refinement.spec.ts). One active version is enough:
      // `is_active` is what the page resolves `activePrompt` from, and
      // `feed_prompts` is UNIQUE (workspace_id, version).
      const { data: feedPrompt } = await supabase
        .from('feed_prompts')
        .insert({
          workspace_id: intelligenceWorkspaceId,
          prompt_text:
            `${prefix} Score each article for relevance to UK cyber-security ` +
            `procurement. Pass an article only when it names a buyer, a ` +
            `framework, or a live tender opportunity.`,
          version: 1,
          is_active: true,
          change_notes: 'E2E worker-scoped seed.',
        })
        .select('id')
        .single()
        .throwOnError();

      const intelligenceFeedPromptId = feedPrompt?.id ?? '';

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

      // --- Create documents for the 2 passed articles, linked to workspace ---
      //
      // ID-131.19 M6 retirement: `content_items` was DROPPED at M6 and
      // `feed_articles.content_item_id` was DROPPED alongside it (M6
      // `ALTER TABLE feed_articles DROP COLUMN content_item_id`) — there is
      // no surviving way to link a feed article to the document it
      // produced. These land on `source_documents` (workspace_id set
      // directly — `content_item_workspaces` junction also DROPPED) purely
      // so `intelItemIds`/downstream cleanup stay meaningful; the
      // feed-article <-> document link itself has no replacement (no live
      // spec asserts on it — si-*.spec.ts / intelligence-workflow.spec.ts
      // only consume `intelligenceWorkspaceId`/`intelligenceFeedSourceId`).
      const passedArticleShapes = articleShapes.filter((a) => a.passed);
      const intelSourceDocuments = passedArticleShapes.map((shape, i) => ({
        filename: `${prefix} ${shape.title}`,
        content_type: 'article',
        primary_domain: 'Market Intelligence',
        summary: shape.ai_summary ?? '',
        source_url: shape.external_url,
        workspace_id: intelligenceWorkspaceId,
        status: 'processed',
        // {128.14} Class 3 — same NOT-NULL fix as the sdShapeEntries insert
        // above (this is a SECOND, separate source_documents insert site
        // that hit the identical missing-columns crash). `intel-` namespace
        // keeps content_hash/storage_path distinct from that batch's `sd-`
        // namespace for the same worker prefix.
        mime_type: 'text/plain',
        file_size: 1,
        content_hash: `${prefix}-intel-${i}`,
        storage_path: `test-fixtures/${prefix}/intel-${i}.txt`,
      }));

      const { data: intelItems } = await supabase
        .from('source_documents')
        .insert(intelSourceDocuments)
        .select('id')
        .throwOnError();

      const intelItemIds = (intelItems ?? []).map((i: { id: string }) => i.id);
      sourceDocumentIds.push(...intelItemIds);

      // id-401 / id-396 D4 body rule — SECOND document-insert site. Feed
      // articles carry no long-form body of their own, so the AI summary is
      // the document body here (these rows exist so `intelItemIds` and the
      // teardown stay meaningful; no live spec reads their prose). Without
      // this they were the other half of the body-less seed population.
      await seedDocumentBodies(
        supabase,
        (intelItems ?? []).map(
          (row: Pick<Tables<'source_documents'>, 'id'>, i: number) => ({
            sourceDocumentId: row.id,
            body:
              passedArticleShapes[i]!.ai_summary ??
              `${prefix} ${passedArticleShapes[i]!.title}`,
          }),
        ),
      );
      // These land on the trigger-minted default of `freshness = 'fresh'`.
      seededFreshnessCounts.fresh += intelItemIds.length;

      // --- Teardown: clean up this worker's data ---
      console.log(
        `[Worker ${workerInfo.workerIndex}] Cleaning up ${prefix} data...`,
      );

      // Delete in dependency order to avoid FK constraint violations.
      //
      // ID-131.19 M6 retirement: `read_marks` and `content_item_workspaces`
      // were both DROPPED at M6 — steps that used to clean them up here are
      // removed. `content_items`/`content_history` are also DROPPED;
      // cleanup now targets `q_a_pairs` + `source_documents` (+ their
      // `record_embeddings` rows — polymorphic, no FK cascade).
      //
      // No explicit step for `feed_prompts`, `record_lifecycle` or
      // `content_chunks`: all three have real ON DELETE CASCADE FKs
      // (`feed_prompts.workspace_id` -> `workspaces`, reaped by the prefix
      // sweep in step 5; `record_lifecycle.source_document_id` and
      // `content_chunks.source_document_id` -> `source_documents`, reaped by
      // the by-id delete in the same step — the latter per
      // `content_chunks_source_document_id_fkey`,
      // `20260628200000_id131_extract_reparent.sql`). Adding redundant
      // deletes here would only widen the teardown's blast radius.

      // 2. Procurement responses (safety net — CASCADE from the question's
      // `form_instances` parent should handle this, but delete explicitly
      // in case a response was created without a live question FK).
      if (responseIds.length > 0) {
        await supabase.from('form_responses').delete().in('id', responseIds);
      }

      // 3. Entity mentions and relationships (FK -> source_documents)
      if (sourceDocumentIds.length > 0) {
        await supabase
          .from('entity_mentions')
          .delete()
          .in('source_document_id', sourceDocumentIds);
        await supabase
          .from('entity_relationships')
          .delete()
          .in('source_document_id', sourceDocumentIds);
      }

      // 4. record_embeddings (polymorphic — no FK cascade from either owner table)
      if (qaPairIds.length > 0) {
        await supabase
          .from('record_embeddings')
          .delete()
          .eq('owner_kind', 'q_a_pair')
          .in('owner_id', qaPairIds);
      }
      if (sourceDocumentIds.length > 0) {
        await supabase
          .from('record_embeddings')
          .delete()
          .eq('owner_kind', 'source_document')
          .in('owner_id', sourceDocumentIds);
      }

      // 5. q_a_pairs + source_documents (by id) and workspaces (by prefix)
      if (qaPairIds.length > 0) {
        await supabase.from('q_a_pairs').delete().in('id', qaPairIds);
      }
      if (sourceDocumentIds.length > 0) {
        await supabase
          .from('source_documents')
          .delete()
          .in('id', sourceDocumentIds);
      }
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);

      // 6. Procurement items (`form_instances`, ID-145 W1) — deleted by id,
      // NOT by the `workspaces` prefix sweep above (procurement items no
      // longer live in `workspaces`). CASCADEs to their `form_questions`
      // (`form_questions_form_template_id_fkey`, still named after the
      // pre-rename column but unaffected by the RENAME COLUMN) and onward to
      // `form_responses`/`form_response_history`, so step 2's explicit
      // `form_responses` delete above is a pure safety net.
      if (formInstanceIds.length > 0) {
        await supabase
          .from('form_instances')
          .delete()
          .in('id', formInstanceIds);
      }
    },
    { scope: 'worker' },
  ],
});
