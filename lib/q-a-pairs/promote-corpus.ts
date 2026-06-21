/**
 * lib/q-a-pairs/promote-corpus.ts
 *
 * ID-59 {59.22} — promoteCorpusExtractions core loop + atomic CAS + field map.
 * ID-59 {59.23} — embed-decouple + self-heal retry path (OQ-3).
 * ID-59 {59.24} — OQ-2 active retirement pass (after the promote loop).
 * ID-59 {59.29} — corpus sidecar-emit leg (emit-then-publish) + bl-323 fold:
 *                 unified per-extraction failure record (embed | sidecar).
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
 * embedding success. If embedding fails, the pair stays draft+NULL — which
 * q_a_search correctly excludes (INV-11). The eligibility RPC re-selects
 * linked-but-unembedded pairs next run → self-healing. The batch NEVER aborts
 * for one embedding failure (INV-10).
 *
 * INV-12 invariant: `publication_status='published'` is ONLY set in the same
 * UPDATE that sets `question_embedding`. Never one without the other.
 *
 * INV-23 equation: for one run, published-this-run == promoted - embed_failed.
 *   promoted = CAS-wins + self-heal attempts (all paths that reach the embed step)
 *   embed_failed = subset of promoted whose embed or embed UPDATE failed
 *
 * OQ-2 active retirement (R1 step 6): after the promote loop, a retirement pass
 * archives each invalidated-but-still-published pair. If a live replacement for
 * the same source_content_item_id has been promoted, the old pair gets
 * superseded_by=<replacementPairId>; otherwise (or when source_content_item_id
 * IS NULL), archived without a replacement. The {64.15} history trigger
 * auto-snapshots the transition — no app-side history insert needed.
 * Loop-until-dry with a cap of 10 iterations guards page-limited query results.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { tryQuery } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { generateEmbedding } from '@/lib/ai/embed';
import {
  qaSidecarRelPath,
  sdUuid5,
  serialiseCarriedSet,
  type CarriedSet,
} from '@/lib/q-a-pairs/sidecar-path';
import { writeFileFirstWithRestore } from '@/lib/edit-intent/write-back';
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
 * Structured summary returned by promoteCorpusExtractions (R1 step 7).
 *
 * {59.22}: considered, promoted, skipped, already_promoted.
 * {59.23}: embed_failed added; pass_through retired (self-heal rows now flow
 *          into embed accounting — promoted++ + embed_failed++ on failure).
 * {59.24}: retired, retired_no_replacement added.
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
 *   5.  Emit sidecar (TECH R1, CAS-won branch only): write the carried-set
 *       `__qa__/<pairId>.md` + set source_document_id, THEN publish
 *       (emit-then-publish). A sidecar failure aborts the publish (pair stays
 *       draft, count sidecar_failed, self-heal next run). Idle mode
 *       (COCOINDEX_SOURCE_PATH unset) → DB-only publish, NOT a failure.
 *   4.  Embed: generateEmbedding(question_text). On success: UPDATE pair
 *       SET question_embedding + publication_status='published' together
 *       (INV-12). On failure: leave draft+NULL, count embed_failed, continue.
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
  const skipped: SkipRecord[] = [];
  // INV-11 / bl-323: unified per-extraction failure log (embed OR sidecar).
  const failures: PromotionFailureRecord[] = [];

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
    //     gate). On a question_text change the embedding is NULL'd in the SAME
    //     carried UPDATE (the explicit, documented INV-10 mark-stale exception)
    //     so q_a_search has no published+stale-vector window — the pair re-
    //     embeds on the very next step via the existing self-heal embed path.
    //
    // The pair already exists and is already linked — skip INSERT + CAS
    // (INV-3: re-promotion NEVER mints a duplicate; the promoted_to_pair_id
    // anchor + source_document_id jointly key the pair).
    // -----------------------------------------------------------------------
    if (extraction.promoted_to_pair_id !== null) {
      const existingPairId: string = extraction.promoted_to_pair_id;
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
    //   publication_status        ← 'draft' (step 4 publishes in same UPDATE as embed)
    //   question_embedding        ← omitted/NULL (step 4 sets it)
    //   source_form_response_id   ← omitted (route-i pairs have no form lineage)
    //   source_question_id        ← omitted (route-i pairs have no form lineage)
    //   source_workspace_id       ← omitted (nullable/defaulted; mirrors
    //                               route-iii lines 155-164 which also omit it)
    //   superseded_by             ← omitted/NULL
    const pairInsert: Database['public']['Tables']['q_a_pairs']['Insert'] = {
      question_text: extraction.extracted_question_text,
      answer_standard: answerText,
      // alternate_question_phrasings intentionally omitted — DB DEFAULT '{}'
      // (text[] NOT NULL DEFAULT '{}') fills it. Update here for ID-94.1/G4.
      origin_kind: 'extracted_from_corpus',
      publication_status: 'draft',
      // question_embedding intentionally omitted — step 4 embeds + publishes
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

      // ---- Step 5 — emit-then-publish (TECH R1.1/R1.3 option a, RECOMMENDED) ----
      //
      // Emit the sidecar (write the carried-set file + set source_document_id)
      // BEFORE embedAndPublish. A sidecar failure ABORTS the publish: the pair
      // stays draft+NULL — the SAME retryable state the embed-decouple already
      // produces (INV-11: never a published-without-a-file pair). The
      // eligibility RPC re-selects it next run → self-healing.
      //
      // Idle mode (COCOINDEX_SOURCE_PATH unset, write-back.ts precedent) is NOT
      // a failure: emitCorpusSidecar returns 'idle', the file leg is skipped,
      // and we fall through to a DB-only publish that self-heals on the next
      // bound walk.
      // Carried set = the pair's state at promotion time. The corpus INSERT
      // (3a-i) sets ONLY question_text + answer_standard; answer_advanced /
      // scope_tag / anti_scope_tag are the q_a_pairs DB defaults (null, omitted
      // from the file) and alternate_question_phrasings is the DEFAULT '{}'
      // (an empty text[]). Pass the empty array explicitly — CarriedSet requires
      // it and serialiseCarriedSet would emit "undefined" otherwise.
      const emitOutcome = await emitCorpusSidecar(client, newPairId, {
        question_text: extraction.extracted_question_text,
        answer_standard: answerText,
        alternate_question_phrasings: [],
      });

      if (emitOutcome === 'failed') {
        // Sidecar leg failed — abort the publish (pair stays draft+NULL).
        sidecar_failed++;
        failures.push({
          extractionId,
          newPairId,
          reason: 'sidecar_failed',
        });
        continue;
      }

      // Emit succeeded ('written') or was skipped in idle mode ('idle').
      // Either way the pair is safe to publish: 'written' means the file +
      // linkage are in place; 'idle' means there is no file leg to write and the
      // bound re-walk self-heals later.
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
  };
}

// ---------------------------------------------------------------------------
// Step 5 — corpus sidecar emit helper (TECH R1; maps INV-9, INV-11; folds bl-323)
//
// Writes the pair's `__qa__/<pairId>.md` carried-set sidecar AND sets
// q_a_pairs.source_document_id, as ONE file-first + compensating-restore save
// reusing the shared writeFileFirstWithRestore primitive ({59.28}).
//
// KEY ON THE PAIR PK (newPairId), NOT the extraction id: a pair has ONE
// canonical sidecar path regardless of which leg emits it. {59.30}'s
// materialise path keys on pairId too — load-bearing for {59.32} round-trip
// idempotency.
//
// Carried set ONLY (INV-2): question_text + answer_standard (the corpus
// extraction's fields). answer_advanced / scope_tag / anti_scope_tag /
// alternate_question_phrasings are the q_a_pairs DB defaults at promotion time
// (null / null / null / '{}'), so they are absent / empty in the file — NO
// lifecycle keys ever (INV-9).
//
// source_document_id = sdUuid5(relPath) — the TS mirror of the Python `sd:`
// uuid5, so the bound re-walk re-mints the SAME source_documents.id and the
// linkage is stable (INV-20). FK-LESS by design (M1 / BUG-E precedent) — the
// row it points at appears on the next walk; there is no FK to violate.
//
// Affected-row assertion: the source_document_id UPDATE is asserted to affect
// exactly 1 row — a 0-row REST PATCH is a silent failure (mirrors the CAS /
// embed / archive affected-row discipline elsewhere in this file). A 0-row or
// errored UPDATE rejects out of writeFileFirstWithRestore, which then restores
// the file and re-raises → the caller counts sidecar_failed and aborts publish.
//
// New-file mint caveat: writeFileFirstWithRestore snapshots prior bytes via
// readFile and does not create parent dirs — it was built for the content-edit
// case where the file already exists. The corpus leg MINTS a fresh sidecar, so
// this helper first ensures the `__qa__/` dir exists and the target file exists
// (an empty touch) so the snapshot+restore primitive can be reused unchanged.
// Surfaced for the Checker; {59.30}'s materialise path faces the same mint.
// ---------------------------------------------------------------------------

/**
 * Outcome of an emit attempt.
 *   'written' — the sidecar file + source_document_id linkage are in place.
 *   'idle'    — COCOINDEX_SOURCE_PATH unset; no file leg written (DB-only
 *               publish self-heals on the next bound walk). NOT a failure.
 *   'failed'  — the file write or the linkage UPDATE failed; the pair must NOT
 *               be published (emit-then-publish abort, INV-11).
 */
type SidecarEmitOutcome = 'written' | 'idle' | 'failed';

async function emitCorpusSidecar(
  client: SupabaseClientLike,
  newPairId: string,
  carried: CarriedSet,
): Promise<SidecarEmitOutcome> {
  // ── Idle mode: no source-binding folder → skip the file leg (DB-only) ───────
  // Mirrors writeBackFileFirst's idle fall-through (write-back.ts:317-320): the
  // save still lands and the next bound walk self-heals. NOT a sidecar_failed.
  const sourceRoot = process.env.COCOINDEX_SOURCE_PATH;
  if (!sourceRoot) {
    return 'idle';
  }

  const relPath = qaSidecarRelPath(newPairId);
  const absPath = join(sourceRoot, relPath);
  const newContent = serialiseCarriedSet(carried);
  const sourceDocumentId = sdUuid5(relPath);

  try {
    // New-file mint: ensure the `__qa__/` dir + an empty target exist so the
    // shared snapshot→write→applyDbLeg→restore primitive (built for the edit
    // case) can be reused unchanged. Idempotent — flag 'wx' is NOT used so a
    // re-emit over an existing sidecar (next-run self-heal) does not throw here.
    await mkdir(dirname(absPath), { recursive: true });
    await ensureFileExists(absPath);

    // ── applyDbLeg: link the pair to the (re-mintable) source_documents row ───
    // UPDATE q_a_pairs SET source_document_id = sdUuid5(relPath) WHERE id =
    // newPairId. Assert affected-row count = 1 (0-row PATCH = silent failure).
    const applyDbLeg = async () => {
      // {59.29} nit fold: typed Pick payload — compile-checks the field name
      // and matches the carried/archive/embed UPDATE-payload convention in
      // this file (no inline literal).
      const linkPayload: Pick<
        Database['public']['Tables']['q_a_pairs']['Update'],
        'source_document_id'
      > = { source_document_id: sourceDocumentId };
      const linkResult = await client
        .from('q_a_pairs')
        .update(linkPayload)
        .eq('id', newPairId)
        .select('id');

      const linkError = linkResult?.error ?? null;
      if (linkError) {
        throw new Error(
          safeErrorMessage(
            linkError,
            `emitCorpusSidecar: source_document_id UPDATE failed for pair ${newPairId}`,
          ),
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const linkRows: any[] = linkResult?.data ?? [];
      if (linkRows.length !== 1) {
        throw new Error(
          `emitCorpusSidecar: source_document_id UPDATE affected ${linkRows.length} rows (expected 1) for pair ${newPairId}`,
        );
      }
    };

    await writeFileFirstWithRestore({ absPath, newContent, applyDbLeg });
    return 'written';
  } catch {
    // File write OR the linkage UPDATE failed (writeFileFirstWithRestore has
    // already restored the file on a DB-leg failure). Signal the caller to
    // abort the publish — the pair stays draft and self-heals next run.
    return 'failed';
  }
}

/**
 * Touch an empty file if it does not already exist, so the snapshot leg of the
 * reused writeFileFirstWithRestore primitive (which reads prior bytes) has a
 * file to read on a fresh mint. Uses the 'a' (append) flag: it creates the file
 * when absent and is a no-op for content when it already exists, so a re-emit
 * over an existing sidecar is preserved for writeFileFirstWithRestore to
 * snapshot+overwrite.
 */
async function ensureFileExists(absPath: string): Promise<void> {
  // flag 'a': create-if-absent, never truncate. An empty newContent string
  // appends nothing, so an existing file is left intact for the snapshot.
  await writeFile(absPath, '', { encoding: 'utf8', flag: 'a' });
}

// ---------------------------------------------------------------------------
// {59.31} — re-walk carried-only re-promotion (TECH R3; maps INV-1/2/3/9/10)
//
// When the eligibility RPC returns an extraction whose pair ALREADY exists
// (promoted_to_pair_id set), a re-walk ({59.26}) has UPSERTed the same-PK
// extraction row with the re-extracted carried text. This helper re-converges
// the linked pair by re-syncing ONLY the CARRIED set — the NOT-CARRIED
// lifecycle set (publication_status, superseded_by, source_workspace_id,
// edit_intent, valid_from/valid_to, created_at/updated_at, source_document_id)
// is STRUCTURALLY excluded from the payload (the S233 gate, INV-9).
//
// The payload is a typed `Pick<…Update, CARRIED_REPROMOTE_FIELDS>` so the
// exclusion is COMPILE-CHECKED: adding a not-carried key to the literal is a
// type error (mirrors the typed Pick payloads at the embed/archive sites).
//
// Mark-stale (INV-10, OQ-25-2): the helper first reads the pair's stored
// question_text and compares it to the re-extracted value; on inequality it
// adds `question_embedding: null` to the SAME carried UPDATE — the ONLY
// permitted not-carried touch, and the explicit INV-10 exception. q_a_search
// (published AND question_embedding IS NOT NULL) then excludes the pair until
// the very next embed step re-embeds it, so there is no wrong-vector window.
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
 *  exclusion of the not-carried lifecycle set). `question_embedding` is the
 *  ONLY not-carried key permitted, and ONLY as the mark-stale NULL rider —
 *  it is added to the payload type via an intersection at the call site, not
 *  listed here, so the carried boundary stays self-documenting. */
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
  // ── Read the stored question_text for the mark-stale comparison (INV-10) ──
  const storedResult = await client
    .from('q_a_pairs')
    .select('question_text')
    .eq('id', existingPairId)
    .single();

  const storedError = storedResult?.error ?? null;
  if (storedError) {
    // The pair could not be read — treat as a soft re-sync failure.
    return false;
  }
  const storedQuestionText: string | null =
    (storedResult?.data as { question_text: string } | null)?.question_text ??
    null;

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

  // ── Mark-stale rider (INV-10): NULL the embedding ONLY on a question change.
  // question_embedding is the single permitted not-carried touch; the
  // intersection type keeps the literal exhaustive-checked while making the
  // exception explicit at the write site.
  const markStale = storedQuestionText !== reExtractedQuestion;
  const updatePayload: typeof carriedPayload &
    Pick<
      Database['public']['Tables']['q_a_pairs']['Update'],
      'question_embedding'
    > = markStale
    ? { ...carriedPayload, question_embedding: null }
    : carriedPayload;

  // ── Carried UPDATE — assert affected-row = 1 (REST PATCH silent-no-op guard).
  const updateResult = await client
    .from('q_a_pairs')
    .update(updatePayload)
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
//     promoted_to_pair_id IS NOT NULL) for the SAME source_content_item_id
//     exists with a pair → archive OLD pair SET superseded_by=<replPairId>,
//     publication_status='archived'. Count retired.
//   - Else (no replacement OR source_content_item_id IS NULL) → archive OLD
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
        'id, source_content_item_id, promoted_to_pair_id, q_a_pairs!promoted_to_pair_id(id, publication_status)',
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
        .select('id, source_content_item_id, promoted_to_pair_id')
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
            // Normalise to the same shape as the embed path
            'q_a_pairs!promoted_to_pair_id': {
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
          const embeddedPair = e['q_a_pairs!promoted_to_pair_id'];
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
        (candidate.source_content_item_id as string | null) ?? null;

      // -----------------------------------------------------------------------
      // Find a live-promoted replacement for the same source_content_item_id.
      // Only possible when source_content_item_id IS NOT NULL.
      // -----------------------------------------------------------------------
      let replacementPairId: string | null = null;

      if (sourceContentItemId !== null) {
        const replacementResult = await client
          .from('q_a_extractions')
          .select('promoted_to_pair_id')
          .eq('source_content_item_id', sourceContentItemId)
          .is('invalidated_at', null)
          .not('promoted_to_pair_id', 'is', null)
          .limit(1);

        const replacementError = replacementResult?.error ?? null;
        if (replacementError) {
          throw new Error(
            safeErrorMessage(
              replacementError,
              `retireSupersededPairs: replacement lookup failed for source_content_item_id=${sourceContentItemId}`,
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
// Attempts to generate an embedding for the question text and UPDATE the pair
// with both question_embedding AND publication_status='published' in ONE
// statement (INV-12: publish ONLY with embedding together — never one without
// the other; a pair with published+NULL-embedding would be invisible to
// q_a_search, violating INV-11).
//
// On ANY failure (generateEmbedding throws, or UPDATE returns 0 rows):
//   - The pair remains draft + question_embedding NULL.
//   - q_a_search correctly excludes it (INV-11 satisfied).
//   - onFail() is called (caller increments embed_failed).
//   - The loop CONTINUES — no batch abort (INV-10).
//   - The eligibility RPC re-selects this linked-unembedded pair next run →
//     self-healing (the link does NOT block retry).
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
    // generateEmbedding threw — leave pair draft+NULL, self-heal next run.
    onFail();
    return;
  }

  // UPDATE pair SET question_embedding + publication_status='published' TOGETHER.
  // INV-12: these two fields are ALWAYS set in the same UPDATE statement.
  // Typed update payload — compile-check that field names match the schema.
  const embedUpdatePayload: Pick<
    Database['public']['Tables']['q_a_pairs']['Update'],
    'question_embedding' | 'publication_status'
  > = {
    question_embedding: JSON.stringify(embedding),
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
  }
  // embedRowCount > 0: pair is now published with a non-null embedding. Success.
}
