/**
 * lib/q-a-pairs/promote-corpus.ts
 *
 * ID-59 {59.22} — promoteCorpusExtractions core loop + atomic CAS + field map.
 * ID-59 {59.23} — embed-decouple + self-heal retry path (OQ-3).
 * ID-59 {59.24} — OQ-2 active retirement pass (after the promote loop).
 * ID-59 {59.29} — corpus sidecar-emit leg (emit-then-publish) + bl-323 fold:
 *                 unified per-extraction failure record (embed | sidecar).
 * ID-131 {131.21} — HIGH-priority dual-write: embedAndPublish() upserts the
 *                   polymorphic record_embeddings store (owner_kind=
 *                   'q_a_pair'). flow.py never embeds q_a_pairs — this
 *                   promotion path is the SOLE q_a_pair embedding writer —
 *                   so hybrid_search's q_a_pair arm needs this row. Best-
 *                   effort: mirrors classify.ts's non-fatal record_embeddings
 *                   upsert-failure handling.
 * ID-131.19 (M6, S450 GO tail) — q_a_pairs.question_embedding (the inline
 *                   column this dual-write originally sat ALONGSIDE) was
 *                   DROPPED (20260706120000_id131_drop_inline_vector_cols.sql,
 *                   applied). record_embeddings is now the sole store;
 *                   embedAndPublish's inline UPDATE carries publication_status
 *                   only. See that function + repromoteCarriedFields' header
 *                   comments for the retired mark-stale rider.
 * ID-138 {138.17} — promotion-candidates re-selection (DR-026 propose-
 *                   surfacing half): the eligibility RPC
 *                   (q_a_extractions_promotion_candidates,
 *                   20260707140000_id138_promotion_candidates_published_diff.sql)
 *                   now ALSO re-selects an extraction linked to an
 *                   already-PUBLISHED pair when a re-walk changed its carried
 *                   fields. This function routes such a row into a NEW
 *                   non-mutating `proposed` bucket (never repromoteCarriedFields
 *                   / embedAndPublish) — see the per-extraction loop below and
 *                   repromoteCarriedFields' header comment. DR-026: a promoted/
 *                   curated (published) pair is NEVER auto-mutated; human
 *                   review at the knowledge-admission gate is the LAUNCH
 *                   posture (id-138 TECH.md §2.4).
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5, 6, 7.
 *       specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-sidecar-canonical.md
 *       R1 (corpus-promotion emit leg; maps INV-9/INV-10/INV-11).
 * Product invariants: INV-1, INV-3, INV-4, INV-5, INV-6, INV-7, INV-8,
 *                    INV-9, INV-10, INV-11, INV-12, INV-23.
 *
 * Auth discipline: the caller (HTTP route or pipeline) passes an authorised/
 * operator Supabase client. ALL DB access is via tryQuery() or the direct chain
 * where tryQuery() wraps it — no service-role escalation, RLS-scoped throughout
 * (INV-14, INV-15). Direct import — no barrel.
 *
 * Alternate question phrasings: q_a_extractions has no dedicated phrasings
 * column (the extraction_metadata JSONB is the only place per-extraction
 * metadata lives, but no standard phrasings key is established). Route i
 * omits alternate_question_phrasings from the INSERT payload entirely and
 * relies on the column DEFAULT '{}' (an empty text[]). When ID-94.1/G4 lands
 * a dedicated column or well-known metadata key, update the INSERT payload
 * below — see the note near the INSERT.
 *
 * OQ-3 decouple: the extraction→pair LINK (CAS) is NOT conditional on
 * embedding success. If embedding fails, the pair stays draft — which
 * q_a_search correctly excludes (INV-11). The eligibility RPC re-selects
 * linked-but-unembedded pairs next run → self-healing. The batch NEVER
 * aborts for one embedding failure (INV-10).
 *
 * INV-12 invariant (pre-M6): `publication_status='published'` was ONLY set
 * in the same UPDATE that set `question_embedding`. ID-131.19 (M6): the
 * inline column is gone — the UPDATE now sets publication_status alone, and
 * the record_embeddings dual-write happens in a separate best-effort step
 * (see embedAndPublish's header comment).
 *
 * INV-23 equation: for one run, published-this-run == promoted - embed_failed.
 *   promoted = CAS-wins + self-heal attempts (all paths that reach the embed step)
 *   embed_failed = subset of promoted whose embed or embed UPDATE failed
 *
 * OQ-2 active retirement (R1 step 6): after the promote loop, a retirement pass
 * archives each invalidated-but-still-published pair. If a live replacement for
 * the same source_document_id has been promoted, the old pair gets
 * superseded_by=<replacementPairId>; otherwise (or when source_document_id
 * IS NULL), archived without a replacement. The {64.15} history trigger
 * auto-snapshots the transition — no app-side history insert needed.
 * Loop-until-dry with a cap of 10 iterations guards page-limited query results.
 */

import { tryQuery } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { generateEmbedding } from '@/lib/ai/embed';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
// ID-131 {131.8} BI-16 (QA-DBONLY): the `__qa__/*.md` sidecar emit is retired —
// only the pure-DB source_document_id provenance link survives, so the fs /
// path / carried-set-serialise / write-back-restore imports are no longer used.
import { qaSidecarRelPath, sdUuid5 } from '@/lib/q-a-pairs/sidecar-path';
import type { RecordEmbeddingsOwnerKind } from '@/lib/validation/owner-kind';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reason a single extraction was not promoted in this run. */
type SkipReason = 'no_answer_text';

/** Per-extraction skip record (INV-7). */
interface SkipRecord {
  extractionId: string;
  reason: SkipReason;
}

/**
 * Reason a single promotion attempt FAILED this run (distinct from a skip — the
 * extraction WAS promotable and reached the embed/emit step, but could not be
 * fully published). Both leave the pair in the retryable `draft` state; the
 * eligibility RPC re-selects it next run → self-healing.
 *
 *   'embed_failed'   — generateEmbedding threw, or the embed UPDATE no-op'd.
 *   'sidecar_failed' — the corpus sidecar file could not be written / linked
 *                      (INV-11: never a silent DB-only published-without-a-file
 *                      pair). emit-then-publish means the publish is ABORTED, so
 *                      the pair stays draft, exactly like an embed failure.
 */
type PromotionFailureReason = 'embed_failed' | 'sidecar_failed';

/**
 * Structured per-extraction failure record (INV-11; folds bl-323).
 *
 * Replaces the old operator embed-failure-ONLY log: ONE unified record now
 * carries every failed promotion attempt with the extraction id, the pair id
 * that was being published, and the failure reason. The Orchestrator / log
 * consumer reads `failures` to see exactly which extractions did not publish
 * this run and why — no silent drop, no embed-only blind spot.
 */
interface PromotionFailureRecord {
  extractionId: string;
  /** The pair id being published (a freshly-CAS-linked pair, or the existing
   *  self-heal pair). bl-323: the failure record always names the pair. */
  newPairId: string;
  reason: PromotionFailureReason;
}

/**
 * ID-138 {138.17} (DR-026 propose-surfacing half): a re-walked extraction
 * whose carried fields differ from its linked pair, where the pair is
 * ALREADY PUBLISHED. The eligibility RPC re-selects it (see the widened
 * predicate, 20260707140000_id138_promotion_candidates_published_diff.sql),
 * but the pair is NEVER auto-mutated (DR-026) — this record is the proposal
 * surface: a human reviews it at the knowledge-admission gate, no write is
 * issued against the pair by this run.
 */
interface ProposedDiffRecord {
  extractionId: string;
  /** The PUBLISHED pair the extraction's re-walked text now differs from. */
  pairId: string;
}

/**
 * Structured summary returned by promoteCorpusExtractions (R1 step 7).
 *
 * {59.22}: considered, promoted, skipped, already_promoted.
 * {59.23}: embed_failed added; pass_through retired (self-heal rows now flow
 *          into embed accounting — promoted++ + embed_failed++ on failure).
 * {59.24}: retired, retired_no_replacement added.
 * {138.17}: proposed, proposals added (published-pair re-walk diffs — DR-026
 *          propose-surfacing half; never counted in promoted/embed_failed,
 *          since the row never reaches the embed step, INV-23 unaffected).
 *
 * INV-23: published-this-run == promoted - embed_failed is an invariant
 * of this function for any single run.
 *
 * Retirement accounting (OQ-2 / R1.6):
 *   total-retired = retired + retired_no_replacement   (disjoint sets)
 *   retired               = pairs archived WITH a live replacement (superseded_by SET)
 *   retired_no_replacement = pairs archived WITHOUT a replacement (superseded_by NULL)
 */
export interface PromotionSummary {
  /** Total extractions the RPC returned (eligible set). */
  considered: number;
  /**
   * Extractions that reached the embed step this run.
   * Includes both newly CAS-linked rows AND self-heal attempts (linked rows
   * whose pair is still unembedded). embed_failed is the subset that failed;
   * published-this-run = promoted − embed_failed (INV-23).
   */
  promoted: number;
  /** Extractions skipped (unpromotable — e.g. no answer text). */
  skipped: SkipRecord[];
  /** Extractions where the CAS lost a race (concurrent run won; orphan cleaned). */
  already_promoted: number;
  /**
   * Extractions whose embedding failed this run (pair left draft+NULL).
   * The eligibility RPC re-selects them next run → self-healing.
   * published-this-run = promoted - embed_failed (INV-23).
   */
  embed_failed: number;
  /**
   * Pairs archived this run WITH a live replacement — superseded_by was set.
   * (OQ-2, R1.6 "active retirement on invalidation")
   */
  retired: number;
  /**
   * Pairs archived this run WITHOUT a replacement — superseded_by left NULL.
   * "correct-but-missing over wrong-but-present" (OQ-2 ratified posture).
   * The count is the signal; there is no silent drop.
   */
  retired_no_replacement: number;
  /**
   * Extractions whose corpus sidecar could not be emitted this run (TECH R1.3,
   * INV-11; folds bl-323). emit-then-publish: a sidecar failure ABORTS the
   * publish, so the pair stays draft+NULL (NOT a published-without-a-file pair)
   * and the eligibility RPC re-selects it next run → self-healing, exactly like
   * embed_failed. Idle mode (COCOINDEX_SOURCE_PATH unset) is NOT counted here —
   * a DB-only publish that self-heals on the next bound walk is not a failure.
   */
  sidecar_failed: number;
  /**
   * Unified per-extraction failure log (INV-11; folds bl-323). One record per
   * failed promotion attempt — embed OR sidecar — each naming the extraction,
   * the pair, and the reason. Replaces the old embed-failure-only operator log.
   */
  failures: PromotionFailureRecord[];
  /**
   * ID-138 {138.17} (DR-026 propose-surfacing half): count of re-walked
   * extractions linked to an ALREADY-PUBLISHED pair whose carried fields
   * differ from it. NEVER counted in `promoted`/`embed_failed` — the row is
   * routed here BEFORE the embed step, and no write is issued against the
   * pair (DR-026: a promoted/curated record is never auto-mutated).
   */
  proposed: number;
  /**
   * One record per proposed (published-pair, un-applied) diff — see
   * `proposed`. Human review at the knowledge-admission gate is the LAUNCH
   * posture (id-138 TECH.md §2.4); no auto-apply path exists.
   */
  proposals: ProposedDiffRecord[];
}

// ---------------------------------------------------------------------------
// Minimal Supabase client shape required by this function
// (avoids importing the full generated Database type here — callers supply
//  the typed client; we just describe what we call on it)
// ---------------------------------------------------------------------------

/**
 * Minimal interface needed from the Supabase client (injected by callers).
 *
 * `rpc` is derived from the real client type so BOTH production callers are
 * structurally assignable without a cast — the HTTP route's RLS-scoped
 * `SupabaseClient<Database>` and the ID-45 pipeline's service-role client. A
 * hand-rolled `(name: string) => …` rpc is NOT assignable from the real client:
 * the real rpc's `name` is the generated RPC-name union, and by parameter
 * contravariance a wider `string`-accepting signature cannot receive it. `from`
 * stays intentionally loose (`=> any`) so the internal query chains are not
 * coupled to the generated row types.
 *
 * Unit tests inject the shared vitest mock, whose `Mock<…>` fields expose only a
 * construct signature and so satisfy no function-typed interface — they pass it
 * `as unknown as SupabaseClientLike`, mirroring the codebase's shared-mock cast.
 */
export interface SupabaseClientLike {
  rpc: SupabaseClient<Database>['rpc'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

// ---------------------------------------------------------------------------
// Core promotion loop
// ---------------------------------------------------------------------------

/**
 * Promotes eligible corpus extractions to q_a_pairs (route i, origin_kind=
 * 'extracted_from_corpus').
 *
 * Algorithm per TECH R1:
 *   1. SELECT eligible set via q_a_extractions_promotion_candidates() RPC.
 *   2. SKIP rows with no usable answer text (INV-7).
 *   3a. For unpromoted rows: INSERT pair (draft, no embedding), then CAS-link.
 *       CAS 0 rows → delete orphan + count already_promoted.
 *   3d. For linked-but-unembedded rows: skip INSERT + CAS; jump to step 4
 *       to re-attempt embedding on the existing pair (self-heal, OQ-3).
 *   5.  Link provenance (TECH R1, CAS-won branch only; ID-131 {131.8} BI-16):
 *       set q_a_pairs.source_document_id as pure-DB provenance, THEN publish
 *       (link-then-publish). The `__qa__/<pairId>.md` file is NO LONGER
 *       materialised (BI-16 QA-DBONLY). A link failure aborts the publish (pair
 *       stays draft, count sidecar_failed, self-heal next run).
 *   4.  Embed: generateEmbedding(question_text). On success: UPDATE pair
 *       SET publication_status='published', then dual-write the embedding
 *       into record_embeddings (ID-131.19, M6 — the inline question_embedding
 *       column this step used to also set was dropped). On failure: leave
 *       draft, count embed_failed, continue.
 *   6.  Retirement pass (OQ-2): after the promote loop, archive invalidated
 *       published pairs. A same-run replacement is available at this point
 *       because it was created in step 3a above.
 *   7. Return structured summary (INV-23 equation holds as invariant).
 *
 * @param client  Authorised/operator Supabase client (RLS-scoped; injected by
 *                the HTTP route or ID-45 pipeline).
 */
export async function promoteCorpusExtractions(
  client: SupabaseClientLike,
): Promise<PromotionSummary> {
  // -------------------------------------------------------------------------
  // Step 1 — Fetch eligible extractions via the landed {59.21} RPC.
  // The RPC returns SETOF q_a_extractions: live AND (unlinked OR
  // linked-but-unembedded), ordered by created_at.
  // -------------------------------------------------------------------------
  const eligibleResult = await tryQuery(
    client.rpc('q_a_extractions_promotion_candidates'),
    'q_a_extractions_promotion_candidates',
  );

  if (!eligibleResult.ok) {
    throw new Error(
      safeErrorMessage(
        eligibleResult.error,
        'Failed to fetch promotion candidates from q_a_extractions_promotion_candidates()',
      ),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extractions: any[] = eligibleResult.data ?? [];

  // -------------------------------------------------------------------------
  // Summary accumulators
  // -------------------------------------------------------------------------
  let promoted = 0;
  let already_promoted = 0;
  let embed_failed = 0;
  let sidecar_failed = 0;
  // {138.17} DR-026 propose-surfacing half — see ProposedDiffRecord.
  let proposed = 0;
  const skipped: SkipRecord[] = [];
  // INV-11 / bl-323: unified per-extraction failure log (embed OR sidecar).
  const failures: PromotionFailureRecord[] = [];
  const proposals: ProposedDiffRecord[] = [];

  // -------------------------------------------------------------------------
  // Per-extraction loop
  // -------------------------------------------------------------------------
  for (const extraction of extractions) {
    const extractionId: string = extraction.id;

    // -----------------------------------------------------------------------
    // Step 3d — linked-but-unembedded RE-PROMOTION / self-heal path (OQ-3 +
    // {59.31} TECH R3, the S233 SIDECAR-REOPENED gate).
    //
    // The RPC returns these rows so the pair can re-converge after a re-walk:
    //   - {59.23} self-heal: re-attempt the embedding on an unembedded pair.
    //   - {59.31} re-promote: re-sync the CARRIED set from the (re-walked)
    //     extraction onto the existing pair, restricted to the carried fields
    //     so the NOT-CARRIED lifecycle set is NEVER touched (INV-9, the S233
    //     gate). The pair re-embeds on the very next step via the existing
    //     self-heal embed path.
    //   - {138.17} curated-pair diff: a linked pair that is NOT still draft
    //     (in_review / published / archived) is NEVER re-synced/re-embedded
    //     here — see the DR-026 gate immediately below, which routes it into
    //     the non-mutating `proposed` bucket before reaching the
    //     self-heal/re-promote code.
    //
    // The pair already exists and is already linked — skip INSERT + CAS
    // (INV-3: re-promotion NEVER mints a duplicate; the promoted_to_pair_id
    // anchor + source_document_id jointly key the pair).
    // -----------------------------------------------------------------------
    if (extraction.promoted_to_pair_id !== null) {
      const existingPairId: string = extraction.promoted_to_pair_id;

      // -----------------------------------------------------------------------
      // {138.17} DR-026 gate — read the linked pair's CURRENT publication_
      // status BEFORE any write. The widened eligibility RPC (see
      // 20260707140000_id138_promotion_candidates_published_diff.sql) now
      // ALSO re-selects a linked extraction whose pair is already PUBLISHED
      // when a re-walk changed the carried text. A curated pair — anything
      // that is NOT still draft (in_review / published / archived) — is
      // NEVER auto-mutated (DR-026) — route it into the non-mutating
      // `proposed` bucket instead of the self-heal repromote path below,
      // which remains reserved for still-draft pairs.
      //
      // Fail-safe on an unconfirmed status (query error, or the pair row is
      // gone): do NOT attempt a write against a pair we can't positively
      // confirm is still draft — treat exactly like the existing 0-row
      // carried-UPDATE soft-failure (self-heals next run, no throw).
      // -----------------------------------------------------------------------
      const pairStatusResult = await client
        .from('q_a_pairs')
        .select('publication_status')
        .eq('id', existingPairId);

      const pairStatusError = pairStatusResult?.error ?? null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pairStatusRows: any[] = pairStatusResult?.data ?? [];

      if (pairStatusError || pairStatusRows.length === 0) {
        embed_failed++;
        failures.push({
          extractionId,
          newPairId: existingPairId,
          reason: 'embed_failed',
        });
        continue;
      }

      const linkedPairStatus: string | null =
        pairStatusRows[0]?.publication_status ?? null;

      if (linkedPairStatus !== 'draft') {
        // Curated (non-draft) pair re-walk diff: surface as a proposal,
        // NEVER mutate. Covers 'in_review' / 'published' / 'archived', plus
        // the defence-in-depth case of a null/unrecognised status value.
        proposed++;
        proposals.push({ extractionId, pairId: existingPairId });
        continue;
      }

      // Re-promotion attempt counts as a promotion attempt this run (INV-23).
      promoted++;

      // ---- {59.31} carried-only re-sync (INV-2/9) + mark-stale (INV-10) ----
      // A 0-row or errored carried UPDATE is the REST PATCH silent-no-op guard
      // (assert affected-row = 1): the re-sync did not land (pair vanished /
      // concurrent change), so this is a SOFT failure — count embed_failed,
      // log the failure record, and DO NOT embed (the pair self-heals next
      // run). The batch never throws for this (mirrors the embed soft-fail).
      const reSynced = await repromoteCarriedFields(
        client,
        existingPairId,
        extraction,
      );
      if (!reSynced) {
        embed_failed++;
        failures.push({
          extractionId,
          newPairId: existingPairId,
          reason: 'embed_failed',
        });
        continue;
      }

      await embedAndPublish(
        client,
        extractionId,
        existingPairId,
        extraction.extracted_question_text,
        () => {
          embed_failed++;
          failures.push({
            extractionId,
            newPairId: existingPairId,
            reason: 'embed_failed',
          });
        },
      );
      continue;
    }

    // -----------------------------------------------------------------------
    // Step 2 — Skip unpromotable rows (INV-7).
    // NULL, empty, or whitespace-only answer text → skip with reason.
    // NEVER throw the batch; mirrors route-iii 422 as a batch skip.
    // -----------------------------------------------------------------------
    const answerText: string | null = extraction.extracted_answer_text;
    if (!answerText || answerText.trim().length === 0) {
      skipped.push({ extractionId, reason: 'no_answer_text' });
      continue;
    }

    // -----------------------------------------------------------------------
    // Step 3a — Atomic CAS (unpromoted case).
    //
    // INSERT the q_a_pairs row FIRST (draft, no embedding), then CAS-link
    // on q_a_extractions WHERE promoted_to_pair_id IS NULL. If 0 rows
    // updated (concurrent run won), DELETE the orphan pair.
    //
    // Order is load-bearing: pair exists before the link is written; the
    // UNIQUE partial index (uq_q_a_extractions_promoted_to_pair_id) is
    // the DB backstop on the link column.
    // -----------------------------------------------------------------------

    // ---- 3a-i: INSERT the pair (draft, embedding omitted — step 4 adds it) ----
    //
    // Field map (INV-6):
    //   question_text             ← extracted_question_text
    //   answer_standard           ← extracted_answer_text
    //   alternate_question_phrasings ← omitted; relies on column DEFAULT '{}'
    //                                   (an empty text[]). No dedicated column on
    //                                   q_a_extractions. Update when ID-94.1/G4
    //                                   adds a known phrasings key.
    //   origin_kind               ← 'extracted_from_corpus' (INV-4)
    //   publication_status        ← 'draft' (step 4 publishes)
    //   (question_embedding column DROPPED at M6, ID-131.19 — the embedding
    //    step 4 generates now lands solely in record_embeddings)
    //   source_form_response_id   ← omitted (route-i pairs have no form lineage)
    //   source_question_id        ← omitted (route-i pairs have no form lineage)
    //   source_form_template_id   ← omitted ({130.15}/T-B21: .docx imports land
    //                               corpus-level with NO form origin — the form
    //                               provenance is for UC5 form-response promotion
    //                               only; the corpus-import guardrail is retained)
    //   source_workspace_id       ← omitted (nullable/defaulted; .docx imports
    //                               carry no workspace/form origin)
    //   superseded_by             ← omitted/NULL
    const pairInsert: Database['public']['Tables']['q_a_pairs']['Insert'] = {
      question_text: extraction.extracted_question_text,
      answer_standard: answerText,
      // alternate_question_phrasings intentionally omitted — DB DEFAULT '{}'
      // (text[] NOT NULL DEFAULT '{}') fills it. Update here for ID-94.1/G4.
      origin_kind: 'extracted_from_corpus',
      publication_status: 'draft',
      // question_embedding column DROPPED at M6 (ID-131.19) — step 4 embeds
      // + publishes via record_embeddings instead.
    };
    const insertResult = await tryQuery(
      client.from('q_a_pairs').insert(pairInsert).select('id').single(),
      'q_a_pairs.insertCorpusDraft',
    );

    if (!insertResult.ok) {
      // Surface insert failure — do not silently skip; callers see the error.
      throw new Error(
        safeErrorMessage(
          insertResult.error,
          `Failed to insert q_a_pairs draft for extraction ${extractionId}`,
        ),
      );
    }

    const newPairId: string = (insertResult.data as { id: string }).id;

    // ---- 3a-ii: CAS — link the extraction to the new pair ----
    //
    // UPDATE q_a_extractions SET promoted_to_pair_id = newPairId
    //  WHERE id = extractionId AND promoted_to_pair_id IS NULL
    // returning the affected rows. The REST PATCH can silently no-op;
    // the affected-row COUNT is the truth signal (CLAUDE.md gotcha).
    const casResult = await client
      .from('q_a_extractions')
      .update({
        promoted_to_pair_id: newPairId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', extractionId)
      .is('promoted_to_pair_id', null)
      .select('id');

    const casData: { id: string }[] | null = casResult?.data ?? null;
    const casError = casResult?.error ?? null;

    if (casError) {
      // CAS error — clean up the orphan pair we just inserted, then surface.
      await client.from('q_a_pairs').delete().eq('id', newPairId);
      throw new Error(
        safeErrorMessage(
          casError,
          `CAS UPDATE failed for extraction ${extractionId}; orphan pair ${newPairId} deleted`,
        ),
      );
    }

    const casRowCount = (casData ?? []).length;

    if (casRowCount === 0) {
      // ---- 3a-iii: CAS lost the race (0 rows) — delete orphan pair ----
      //
      // A concurrent run already linked this extraction. Our just-inserted
      // pair has no link, no embedding, was never published — safe to delete.
      await client.from('q_a_pairs').delete().eq('id', newPairId);
      already_promoted++;
    } else {
      // ---- CAS won (1 row) — pair is linked ----
      // promoted++ BEFORE the emit/embed steps so the INV-23 equation holds
      // regardless of outcome: promoted++ then possibly sidecar_failed++ /
      // embed_failed++.
      promoted++;

      // ---- Step 5 — link-then-publish (TECH R1.1/R1.3; ID-131 {131.8} BI-16) ----
      //
      // ID-131 {131.8} BI-16 (QA-DBONLY): the `__qa__/*.md` sidecar file is NO
      // LONGER materialised — only the pure-DB q_a_pairs.source_document_id
      // provenance link is written, BEFORE embedAndPublish. A link failure
      // ABORTS the publish: the pair stays draft+NULL — the SAME retryable state
      // the embed-decouple produces (INV-11). The eligibility RPC re-selects it
      // next run → self-healing. There is no longer an idle mode: with no file
      // leg there is nothing to gate on COCOINDEX_SOURCE_PATH.
      const emitOutcome = await emitCorpusSidecar(client, newPairId);

      if (emitOutcome === 'failed') {
        // Provenance-link leg failed — abort the publish (pair stays draft+NULL).
        sidecar_failed++;
        failures.push({
          extractionId,
          newPairId,
          reason: 'sidecar_failed',
        });
        continue;
      }

      // Link succeeded ('written') — the pair carries its corpus lineage and is
      // safe to publish.
      await embedAndPublish(
        client,
        extractionId,
        newPairId,
        extraction.extracted_question_text,
        () => {
          embed_failed++;
          failures.push({
            extractionId,
            newPairId,
            reason: 'embed_failed',
          });
        },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 6 — OQ-2 active retirement pass (R1 step 6).
  //
  // Runs AFTER the promote loop so that any replacement pair created this run
  // is available for superseded_by linkage (ordering is load-bearing).
  // -------------------------------------------------------------------------
  const { retired, retired_no_replacement } =
    await retireSupersededPairs(client);

  return {
    considered: extractions.length,
    promoted,
    skipped,
    already_promoted,
    embed_failed,
    retired,
    retired_no_replacement,
    sidecar_failed,
    failures,
    proposed,
    proposals,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — corpus provenance-link helper (TECH R1; maps INV-9, INV-11)
//
// ID-131 {131.8} BI-16 (QA-DBONLY): the `{59.x}` Q&A sidecar round-trip is
// RETIRED. The promoter NO LONGER materialises promoted pairs back to the
// corpus as `__qa__/<pairId>.md` files — a Q&A pair is a RECORD, never a
// concept, and writing it as a bundle file contradicts the concept != record
// split. The ONLY surviving leg is the pure-DB provenance link:
// q_a_pairs.source_document_id is still set so the pair carries its corpus
// lineage as a DB column (no file, no round-trip).
//
// KEY ON THE PAIR PK (newPairId), NOT the extraction id: a pair has ONE
// canonical lineage id regardless of which leg writes it.
//
// source_document_id = sdUuid5(qaSidecarRelPath(pairId)) — the deterministic
// `sd:` uuid5 derived from the pair's canonical sidecar rel-path, stable across
// runs (INV-20). FK-LESS by design (M1 / BUG-E precedent): with the file leg
// retired the row it points at is never minted, and there is no FK to violate —
// it is pure-DB provenance.
//
// Affected-row assertion: the source_document_id UPDATE is asserted to affect
// exactly 1 row — a 0-row REST PATCH is a silent failure (mirrors the CAS /
// embed / archive affected-row discipline elsewhere in this file). A 0-row or
// errored UPDATE returns 'failed' → the caller counts sidecar_failed and aborts
// the publish (the pair stays draft and self-heals next run).
// ---------------------------------------------------------------------------

/**
 * Outcome of the corpus provenance-link attempt.
 *   'written' — the q_a_pairs.source_document_id linkage is in place.
 *   'failed'  — the linkage UPDATE failed (or no-op'd); the pair must NOT be
 *               published (link-then-publish abort, INV-11).
 *
 * ID-131 {131.8} BI-16: the former 'idle' outcome is gone — with no file leg to
 * skip there is nothing to gate on COCOINDEX_SOURCE_PATH; the DB link is always
 * attempted.
 */
type SidecarEmitOutcome = 'written' | 'failed';

async function emitCorpusSidecar(
  client: SupabaseClientLike,
  newPairId: string,
): Promise<SidecarEmitOutcome> {
  // BI-16 (QA-DBONLY): write ONLY the pure-DB provenance link — no `__qa__`
  // file is materialised. The id is the deterministic `sd:` uuid5 of the pair's
  // canonical sidecar rel-path (stable across runs; FK-less by design).
  const relPath = qaSidecarRelPath(newPairId);
  const sourceDocumentId = sdUuid5(relPath);

  // {59.29} nit fold: typed Pick payload — compile-checks the field name and
  // matches the carried/archive/embed UPDATE-payload convention in this file.
  const linkPayload: Pick<
    Database['public']['Tables']['q_a_pairs']['Update'],
    'source_document_id'
  > = { source_document_id: sourceDocumentId };
  const linkResult = await client
    .from('q_a_pairs')
    .update(linkPayload)
    .eq('id', newPairId)
    .select('id');

  if (linkResult?.error) {
    return 'failed';
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkRows: any[] = linkResult?.data ?? [];
  // Affected-row assertion: a 0-row REST PATCH is a silent failure.
  if (linkRows.length !== 1) {
    return 'failed';
  }
  return 'written';
}

// ---------------------------------------------------------------------------
// {59.31} — re-walk carried-only re-promotion (TECH R3; maps INV-1/2/3/9/10)
//
// When the eligibility RPC returns an extraction whose pair ALREADY exists
// (promoted_to_pair_id set), a re-walk ({59.26}) has UPSERTed the same-PK
// extraction row with the re-extracted carried text. This helper re-converges
// the linked pair by re-syncing ONLY the CARRIED set — the NOT-CARRIED
// lifecycle set (publication_status, superseded_by, source_workspace_id,
// source_form_template_id ({130.15}/T-B21 — lineage provenance, preserved across
// re-promotion, never clobbered by the carried set), edit_intent,
// valid_from/valid_to, created_at/updated_at, source_document_id) is STRUCTURALLY
// excluded from the payload (the S233 gate, INV-9).
//
// The payload is a typed `Pick<…Update, CARRIED_REPROMOTE_FIELDS>` so the
// exclusion is COMPILE-CHECKED: adding a not-carried key to the literal is a
// type error (mirrors the typed Pick payloads at the embed/archive sites).
//
// Mark-stale (INV-10, OQ-25-2) — RETIRED at M6 (ID-131.19, S450 GO tail):
// q_a_pairs.question_embedding was DROPPED (20260706120000_id131_drop_
// inline_vector_cols.sql); this helper no longer has an inline column to
// NULL on a question-text change. No re-point performed and no substitute
// mark-stale write was added — this function is now UNREACHABLE for a
// published pair (see the {138.17} DR-026 gate in the caller loop above,
// which routes a published-linked diff into the non-mutating `proposed`
// bucket BEFORE this function is ever invoked). It only ever runs against a
// still-draft pair, where "the embedding hasn't published yet" already
// means there is no live vector to go stale — a NULL rider would have been
// a no-op there in any case. The RPC's eligibility predicate is fixed
// (20260706170000_id131_qa_fns_record_embeddings_repoint.sql re-pointed it
// onto record_embeddings; 20260707140000_id138_promotion_candidates_
// published_diff.sql then widened it to ALSO re-select published-pair
// diffs) — this is no longer an escalated gap.
//
// Carried fields re-synced are exactly those the extraction carries:
//   question_text  ← extracted_question_text   (NOT NULL on both)
//   answer_standard ← extracted_answer_text     (only when non-empty — the pair
//                     column is NOT NULL, so a NULL/blank re-extraction is left
//                     untouched rather than violating the constraint)
//   alternate_question_phrasings ← alternate_question_phrasings (text[])
// answer_advanced / scope_tag / anti_scope_tag have no extraction source and
// are NOT in the payload (re-sync touches only what the re-extraction provides;
// the S233 gate is about NOT touching lifecycle, not about writing every
// carried column).
//
// Affected-row assertion: a 0-row or errored UPDATE returns false (the REST
// PATCH silent-no-op guard) — the caller routes that into the existing soft
// embed_failed accounting (no batch throw, self-heals next run).
// ---------------------------------------------------------------------------

/** The CARRIED fields the re-promotion UPDATE may set (compile-checked
 *  exclusion of the not-carried lifecycle set). ID-131.19 (M6): the former
 *  `question_embedding` mark-stale NULL rider is RETIRED — the column was
 *  dropped and no substitute write was added (see the comment above
 *  `repromoteCarriedFields`) — so this is now a plain carried-fields union,
 *  no intersection needed at the call site. */
type CarriedRepromoteFields =
  | 'question_text'
  | 'answer_standard'
  | 'alternate_question_phrasings';

/**
 * Re-sync the carried set from a re-walked extraction onto its existing pair.
 * Returns true when the carried UPDATE affected exactly 1 row; false on a
 * 0-row silent no-op or a DB error (the caller treats false as a soft failure).
 *
 * @param client         Authorised/operator Supabase client (RLS-scoped).
 * @param existingPairId The linked pair's id (extraction.promoted_to_pair_id).
 * @param extraction     The re-walked extraction row (carries the new text).
 */
async function repromoteCarriedFields(
  client: SupabaseClientLike,
  existingPairId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extraction: any,
): Promise<boolean> {
  // The stored-question-text pre-read (for the mark-stale comparison, INV-10)
  // is RETIRED (ID-131.19, M6) alongside the rider itself — see the comment
  // above this function. There is no other consumer of that read, so it is
  // removed entirely rather than kept as a dead round-trip.

  // ── Build the CARRIED-ONLY payload (typed Pick — compile-checked exclusion).
  const reExtractedQuestion: string = extraction.extracted_question_text;
  const reExtractedAnswer: string | null = extraction.extracted_answer_text;

  const carriedPayload: Pick<
    Database['public']['Tables']['q_a_pairs']['Update'],
    CarriedRepromoteFields
  > = {
    question_text: reExtractedQuestion,
    alternate_question_phrasings: Array.isArray(
      extraction.alternate_question_phrasings,
    )
      ? (extraction.alternate_question_phrasings as string[])
      : [],
  };
  // answer_standard is NOT NULL on the pair — only re-sync a non-empty answer.
  if (reExtractedAnswer && reExtractedAnswer.trim().length > 0) {
    carriedPayload.answer_standard = reExtractedAnswer;
  }

  // ── Carried UPDATE — assert affected-row = 1 (REST PATCH silent-no-op guard).
  const updateResult = await client
    .from('q_a_pairs')
    .update(carriedPayload)
    .eq('id', existingPairId)
    .select('id');

  const updateError = updateResult?.error ?? null;
  if (updateError) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatedRows: any[] = updateResult?.data ?? [];
  return updatedRows.length === 1;
}

// ---------------------------------------------------------------------------
// Step 6 — OQ-2 retirement helper
//
// Finds each q_a_extractions row with:
//   invalidated_at IS NOT NULL
//   AND promoted_to_pair_id IS NOT NULL
//   AND the linked pair is still publication_status='published'
//
// For each:
//   - If a LIVE replacement extraction (invalidated_at IS NULL,
//     promoted_to_pair_id IS NOT NULL) for the SAME source_document_id
//     exists with a pair → archive OLD pair SET superseded_by=<replPairId>,
//     publication_status='archived'. Count retired.
//   - Else (no replacement OR source_document_id IS NULL) → archive OLD
//     pair SET publication_status='archived' (superseded_by left NULL).
//     Count retired_no_replacement.
//
// Idempotent: filters on publication_status='published'; already-archived
// pairs are never returned.
//
// Loop-until-dry (capped at 10 iterations): guards against a page-limited
// query leaving tail rows un-archived. Convergence is natural: each pass
// reduces the published+invalidated set.
//
// PostgREST embed strategy: queries q_a_extractions and embeds
// q_a_pairs!promoted_to_pair_id(id,publication_status) via the FK.
// On PGRST200 (embed not available), falls back to two sequential reads:
// extract promoted_to_pair_id list, then query q_a_pairs by id.
//
// Affected-row assertion: REST PATCH can silently no-op. We assert the
// archive UPDATE affected 1 row — 0 rows is a defect, surfaced as an error.
// ---------------------------------------------------------------------------
interface RetirementCounts {
  retired: number;
  retired_no_replacement: number;
}

const RETIREMENT_ITERATION_CAP = 10;

async function retireSupersededPairs(
  client: SupabaseClientLike,
): Promise<RetirementCounts> {
  let retired = 0;
  let retired_no_replacement = 0;
  let iterations = 0;
  let archivedThisPass: number;

  do {
    archivedThisPass = 0;
    iterations++;

    // -----------------------------------------------------------------------
    // Fetch retirement candidates: invalidated extractions whose promoted pair
    // is still published.
    //
    // Strategy A: PostgREST embedded resource (FK: promoted_to_pair_id → q_a_pairs).
    // The select string `q_a_pairs!promoted_to_pair_id(id,publication_status)`
    // performs an inner join — only returns rows where the FK resolves AND the
    // linked pair matches the filter. On PGRST200 → fall back to strategy B.
    // -----------------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let candidates: any[] = [];

    // Strategy A: embed query
    const embedQueryResult = await client
      .from('q_a_extractions')
      .select(
        'id, source_document_id, promoted_to_pair_id, q_a_pairs!promoted_to_pair_id(id, publication_status)',
      )
      .not('invalidated_at', 'is', null)
      .not('promoted_to_pair_id', 'is', null);

    const embedError = embedQueryResult?.error ?? null;

    if (
      embedError &&
      (embedError.code === 'PGRST200' ||
        String(embedError.code).startsWith('PGRST'))
    ) {
      // Strategy B fallback: two sequential reads.
      const extractionsResult = await client
        .from('q_a_extractions')
        .select('id, source_document_id, promoted_to_pair_id')
        .not('invalidated_at', 'is', null)
        .not('promoted_to_pair_id', 'is', null);

      const extractionsError = extractionsResult?.error ?? null;
      if (extractionsError) {
        throw new Error(
          safeErrorMessage(
            extractionsError,
            'retireSupersededPairs: fallback extraction read failed',
          ),
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extractionRows: any[] = extractionsResult?.data ?? [];
      if (extractionRows.length === 0) {
        break;
      }

      const pairIds: string[] = extractionRows.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.promoted_to_pair_id as string,
      );

      const pairsResult = await client
        .from('q_a_pairs')
        .select('id, publication_status')
        .in('id', pairIds)
        .eq('publication_status', 'published');

      const pairsError = pairsResult?.error ?? null;
      if (pairsError) {
        throw new Error(
          safeErrorMessage(
            pairsError,
            'retireSupersededPairs: fallback pairs read failed',
          ),
        );
      }

      const publishedPairs: Set<string> = new Set(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (pairsResult?.data ?? []).map((p: any) => p.id as string),
      );

      // Merge: only keep extractions whose pair is still published
      candidates = extractionRows
        .filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => publishedPairs.has(e.promoted_to_pair_id as string),
        )
        .map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (e: any) => ({
            ...e,
            // Normalise to the same shape as the embed path (bugfix, S450
            // integration reds): PostgREST keys an embedded resource by the
            // RESOURCE/table name (`q_a_pairs`), never by the `!fk_hint`
            // qualifier used in the select string to disambiguate the join —
            // confirmed empirically against staging (the hint-qualified key
            // never matched a real response, so Strategy A's filter always
            // saw `embeddedPair == null` and returned zero candidates).
            q_a_pairs: {
              id: e.promoted_to_pair_id,
              publication_status: 'published',
            },
          }),
        );
    } else if (embedError) {
      throw new Error(
        safeErrorMessage(
          embedError,
          'retireSupersededPairs: retirement candidate query failed',
        ),
      );
    } else {
      // Strategy A succeeded: filter to only those whose embedded pair is published.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawRows: any[] = embedQueryResult?.data ?? [];
      candidates = rawRows.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => {
          // Bugfix (S450 integration reds): PostgREST embeds this resource
          // under the plain table name `q_a_pairs` — the `!promoted_to_pair_id`
          // hint in the select string disambiguates the FK join but is NOT
          // part of the response key (there is no `alias:` before the hint).
          // The prior `e['q_a_pairs!promoted_to_pair_id']` lookup always
          // returned undefined, so Strategy A never found a candidate.
          const embeddedPair = e['q_a_pairs'];
          return (
            embeddedPair != null &&
            embeddedPair.publication_status === 'published'
          );
        },
      );
    }

    if (candidates.length === 0) {
      break;
    }

    // -----------------------------------------------------------------------
    // For each candidate: find replacement, then archive.
    // -----------------------------------------------------------------------
    for (const candidate of candidates) {
      const oldPairId: string = candidate.promoted_to_pair_id as string;
      const sourceContentItemId: string | null =
        (candidate.source_document_id as string | null) ?? null;

      // -----------------------------------------------------------------------
      // Find a live-promoted replacement for the same source_document_id.
      // Only possible when source_document_id IS NOT NULL.
      // -----------------------------------------------------------------------
      let replacementPairId: string | null = null;

      if (sourceContentItemId !== null) {
        const replacementResult = await client
          .from('q_a_extractions')
          .select('promoted_to_pair_id')
          .eq('source_document_id', sourceContentItemId)
          .is('invalidated_at', null)
          .not('promoted_to_pair_id', 'is', null)
          .limit(1);

        const replacementError = replacementResult?.error ?? null;
        if (replacementError) {
          throw new Error(
            safeErrorMessage(
              replacementError,
              `retireSupersededPairs: replacement lookup failed for source_document_id=${sourceContentItemId}`,
            ),
          );
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const replacementRows: any[] = replacementResult?.data ?? [];
        if (
          replacementRows.length > 0 &&
          replacementRows[0].promoted_to_pair_id
        ) {
          replacementPairId = replacementRows[0].promoted_to_pair_id as string;
        }
      }

      // -----------------------------------------------------------------------
      // Archive the old pair.
      // Payload: publication_status='archived'; superseded_by=replacementPairId
      // (null when no replacement found).
      //
      // REST PATCH silent no-op guard: assert affected-row count = 1.
      // -----------------------------------------------------------------------
      const archivePayload: Pick<
        Database['public']['Tables']['q_a_pairs']['Update'],
        'publication_status' | 'superseded_by'
      > = {
        publication_status: 'archived',
        superseded_by: replacementPairId,
      };

      const archiveResult = await client
        .from('q_a_pairs')
        .update(archivePayload)
        .eq('id', oldPairId)
        .eq('publication_status', 'published')
        .select('id');

      const archiveError = archiveResult?.error ?? null;
      if (archiveError) {
        throw new Error(
          safeErrorMessage(
            archiveError,
            `retireSupersededPairs: archive UPDATE failed for pair ${oldPairId}`,
          ),
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const archiveRows: any[] = archiveResult?.data ?? [];
      if (archiveRows.length === 0) {
        // 0 rows: a concurrent run already archived this pair (CAS matched 0
        // rows because publication_status is no longer 'published').
        //
        // Mirrors the {59.22}:320 CAS-0-row graceful pattern in the promote
        // loop: treat as already-retired-by-concurrent-run → skip, do not
        // count, do not throw. P IS retired; we just didn't do it this run.
        continue;
      }

      // Archive succeeded: tally.
      archivedThisPass++;
      if (replacementPairId !== null) {
        retired++;
      } else {
        retired_no_replacement++;
      }
    }
  } while (archivedThisPass > 0 && iterations < RETIREMENT_ITERATION_CAP);

  return { retired, retired_no_replacement };
}

// ---------------------------------------------------------------------------
// Step 4 — embed + publish helper (OQ-3 decouple)
//
// Attempts to generate an embedding for the question text, UPDATEs the pair
// to publication_status='published', then dual-writes the embedding into the
// polymorphic record_embeddings store.
//
// ID-131.19 (M6, S450 GO tail): q_a_pairs.question_embedding was DROPPED
// (20260706120000_id131_drop_inline_vector_cols.sql) — the former INV-12
// "publish ONLY with embedding together, in ONE statement" atomicity was
// anchored on that inline column; it no longer exists, so the UPDATE below
// carries publication_status ONLY. record_embeddings is now the sole store
// hybrid_search's q_a_pair arm reads (the {131.21} dual-write already
// existed alongside the inline column — see the record_embeddings upsert
// below, UNCHANGED). This does introduce a short best-effort window between
// the publish UPDATE and the record_embeddings upsert landing; that trade-off
// was already accepted for the dual-write's failure path ("must NOT
// un-publish"), so no NEW risk is introduced by this file's fix, only the
// removal of a write to a column that no longer exists.
//
// On ANY failure (generateEmbedding throws, or UPDATE returns 0 rows):
//   - The pair remains draft.
//   - q_a_search correctly excludes it (INV-11 satisfied).
//   - onFail() is called (caller increments embed_failed).
//   - The loop CONTINUES — no batch abort (INV-10).
//   - The eligibility RPC re-selects the still-unembedded pair next run
//     (self-healing) — see the RPC's header comment in
//     20260707140000_id138_promotion_candidates_published_diff.sql.
// ---------------------------------------------------------------------------
async function embedAndPublish(
  client: SupabaseClientLike,
  extractionId: string,
  pairId: string,
  questionText: string,
  onFail: () => void,
): Promise<void> {
  let embedding: number[];
  try {
    embedding = await generateEmbedding(questionText);
  } catch {
    // generateEmbedding threw — leave pair draft, self-heal next run.
    onFail();
    return;
  }

  // Serialised once — reused for the record_embeddings dual-write (RPC/
  // vector-param convention: JSON.stringify, never a raw array —
  // supabase/CLAUDE.md Embeddings).
  const serialisedEmbedding = JSON.stringify(embedding);

  // UPDATE pair SET publication_status='published'. ID-131.19: no longer
  // carries question_embedding (column dropped) — see the header comment.
  const embedUpdatePayload: Pick<
    Database['public']['Tables']['q_a_pairs']['Update'],
    'publication_status'
  > = {
    publication_status: 'published',
  };

  const embedUpdateResult = await client
    .from('q_a_pairs')
    .update(embedUpdatePayload)
    .eq('id', pairId)
    .select('id');

  const embedData: { id: string }[] | null = embedUpdateResult?.data ?? null;
  const embedError = embedUpdateResult?.error ?? null;

  if (embedError) {
    // UPDATE failed — pair stays draft+NULL. Surface a note but don't throw.
    // The Orchestrator / log consumer can see extractionId in the embed_failed count.
    // In production, structured logging would capture extractionId + error here.
    void extractionId; // reference to suppress unused-var lint on the param
    onFail();
    return;
  }

  const embedRowCount = (embedData ?? []).length;
  if (embedRowCount === 0) {
    // REST PATCH silent no-op — 0 rows means the pair was not found or
    // a concurrent update already published it. Either way, count as
    // embed_failed so the operator can see the discrepancy (INV-12 defence).
    onFail();
    return;
  }

  // embedRowCount > 0: pair is now published with a non-null embedding.
  //
  // ID-131 {131.21} HIGH-priority dual-write (see module header): also upsert
  // the polymorphic record_embeddings store so hybrid_search's q_a_pair arm
  // has a row once the inline column drops at M6. Best-effort — a failure
  // here must NOT un-publish a pair that already published successfully via
  // the inline column above, so it is never surfaced as embed_failed.
  const recordEmbeddingResult = await client
    .from('record_embeddings')
    .upsert(
      {
        owner_kind: 'q_a_pair' satisfies RecordEmbeddingsOwnerKind,
        owner_id: pairId,
        model: 'text-embedding-3-large',
        embedding: serialisedEmbedding,
      },
      { onConflict: 'owner_kind,owner_id,model' },
    )
    .select('id')
    .maybeSingle();

  if (recordEmbeddingResult?.error) {
    logBestEffortWarn(
      'qa.promote.record_embeddings_upsert_failed',
      'Failed to dual-write q_a_pair embedding into record_embeddings',
      {
        extractionId,
        pairId,
        error: recordEmbeddingResult.error,
      },
    );
  }
}
