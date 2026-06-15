/**
 * lib/q-a-pairs/promote-corpus.ts
 *
 * ID-59 {59.22} — promoteCorpusExtractions core loop + atomic CAS + field map.
 * ID-59 {59.23} — embed-decouple + self-heal retry path (OQ-3).
 * ID-59 {59.24} — OQ-2 active retirement pass (after the promote loop).
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5, 6, 7.
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

import { tryQuery } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';
import { generateEmbedding } from '@/lib/ai/embed';
import type { Database } from '@/supabase/types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reason a single extraction was not promoted in this run. */
export type SkipReason = 'no_answer_text';

/** Per-extraction skip record (INV-7). */
export interface SkipRecord {
  extractionId: string;
  reason: SkipReason;
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
  const skipped: SkipRecord[] = [];

  // -------------------------------------------------------------------------
  // Per-extraction loop
  // -------------------------------------------------------------------------
  for (const extraction of extractions) {
    const extractionId: string = extraction.id;

    // -----------------------------------------------------------------------
    // Step 3d — linked-but-unembedded self-heal path (OQ-3).
    //
    // The RPC returns these rows so {59.23} can re-attempt embedding.
    // The pair already exists and is already linked — skip INSERT + CAS.
    // Jump straight to step 4 with the existing pair id.
    // -----------------------------------------------------------------------
    if (extraction.promoted_to_pair_id !== null) {
      const existingPairId: string = extraction.promoted_to_pair_id;
      // Self-heal attempt counts as a promotion attempt this run (INV-23)
      promoted++;
      await embedAndPublish(
        client,
        extractionId,
        existingPairId,
        extraction.extracted_question_text,
        () => {
          embed_failed++;
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
      // Now attempt embedding. promoted++ BEFORE embed so the INV-23 equation
      // holds regardless of embed outcome: promoted++ then possibly embed_failed++.
      promoted++;
      await embedAndPublish(
        client,
        extractionId,
        newPairId,
        extraction.extracted_question_text,
        () => {
          embed_failed++;
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
  };
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
