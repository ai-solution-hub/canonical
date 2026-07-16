/**
 * lib/q-a-pairs/promotion-candidate-review.ts
 *
 * ID-145 {145.30} — per-candidate promotion accept/edit/reject over the
 * `awaiting_review` bucket of q_a_extractions_promotion_candidates()
 * ({138.17}, DR-026 propose-surfacing half). BI-38 amendment (DR-062, S470):
 * the "no new promotion backend" constraint on BI-38 is LIFTED — this is the
 * new write path `gate-145-22`'s Checker escalated as missing.
 *
 * SCOPE DECISION (worth reading before touching this file): this module acts
 * ONLY on an 'awaiting_review' candidate — an extraction linked to an
 * ALREADY-PUBLISHED (non-draft) pair whose carried fields differ from it
 * (the RPC's branch-3 predicate,
 * 20260707140000_id138_promotion_candidates_published_diff.sql). That is the
 * ONE bucket the panel's own {145.22} comment called out as having "no such
 * write path" — DR-026 blocks its diff from auto-applying, so a human
 * judgement call is genuinely needed. A 'new' (unlinked) or 'self_healing'
 * (linked-but-still-draft) extraction id is rejected with `not_awaiting_
 * review` (409) — those have NO per-item judgement gap: the existing "Run
 * promotion pass" batch (promoteCorpusExtractions,
 * lib/q-a-pairs/promote-corpus.ts) already promotes them wholesale.
 * Re-deriving that function's insert/CAS/sidecar/embed lifecycle as a SECOND
 * single-extraction code path here would duplicate a live, ID-45-pipeline-
 * shared function for no product gain — flagged as a DR-intent / follow-up
 * in the {145.30} journal rather than silently expanding this Subtask.
 *
 * SELF-CLEANING DESIGN (no new "dismissed" column needed): the RPC re-selects
 * a linked-to-published-pair extraction ONLY while its carried fields
 * (question_text / answer_standard / alternate_question_phrasings) differ
 * from the pair's CURRENT values. Every action below ends with the
 * extraction's carried fields EQUAL to the pair's (new) carried fields, so
 * the candidate naturally drops out of the 'awaiting_review' set on the next
 * fetch:
 *   accept — the pair adopts the EXTRACTION's carried fields (the "apply the
 *            diff" action DR-026 blocks from auto-firing; a human now
 *            confirms it per-item). The extraction is UNCHANGED — since the
 *            pair now equals it, no reconcile write is needed.
 *   edit   — the pair adopts an ADMIN-SUPPLIED carried-field set (may differ
 *            from both the extraction's raw text and the pair's prior
 *            text); the extraction is THEN reconciled to the SAME final
 *            values so it does not immediately re-propose the diff it was
 *            just resolved from.
 *   reject — the pair is untouched; the extraction's carried fields are
 *            reconciled DOWN to the pair's CURRENT (published) values — the
 *            reviewer judged the published text correct, so the extraction
 *            record stops disagreeing with it.
 *
 * RE-EMBEDDING: accept/edit change the published pair's question_text, so
 * both re-generate + best-effort dual-write the embedding into
 * record_embeddings — mirrors embedAndPublish's posture in
 * lib/q-a-pairs/promote-corpus.ts (a re-embed failure never blocks the
 * carried-field write that already landed; logged via logBestEffortWarn,
 * never thrown). reject touches no pair text, so no re-embed is needed.
 *
 * AUTH: callers pass an authorised (RLS-scoped, admin/editor) Supabase
 * client — see the three sibling
 * app/api/governance/promotion-candidates/[extractionId]/{accept,edit,
 * reject}/route.ts routes. No service-role escalation (INV-14/15 posture,
 * mirrors promote-corpus.ts) — this is a human-review-only surface, there is
 * no automated/pipeline caller.
 */

import { generateEmbedding } from '@/lib/ai/embed';
import { safeErrorMessage } from '@/lib/error';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import type { SupabaseClientLike } from '@/lib/q-a-pairs/promote-corpus';
import type { RecordEmbeddingsOwnerKind } from '@/lib/validation/owner-kind';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QaExtractionUpdate =
  Database['public']['Tables']['q_a_extractions']['Update'];
type QaPairUpdate = Database['public']['Tables']['q_a_pairs']['Update'];

/** The exact fields q_a_extractions and q_a_pairs BOTH carry (mirrors
 *  promote-corpus.ts's CarriedRepromoteFields; pair-column-named here). */
interface CarriedFields {
  question_text: string;
  answer_standard: string;
  alternate_question_phrasings: string[];
}

const EXTRACTION_READ_COLUMNS =
  'id, extracted_question_text, extracted_answer_text, alternate_question_phrasings, promoted_to_pair_id, invalidated_at' as const;
const PAIR_READ_COLUMNS =
  'id, question_text, answer_standard, alternate_question_phrasings, publication_status' as const;

/** The subset of q_a_extractions this module reads/writes. */
interface ExtractionCandidateRow {
  id: string;
  extracted_question_text: string;
  extracted_answer_text: string | null;
  alternate_question_phrasings: string[];
  promoted_to_pair_id: string | null;
  invalidated_at: string | null;
}

/** The subset of q_a_pairs this module reads/writes. */
interface PairCandidateRow {
  id: string;
  question_text: string;
  answer_standard: string;
  alternate_question_phrasings: string[];
  publication_status: string;
}

/** Reviewer-supplied edit body (route validates via zod before calling in). */
export interface CandidateEditInput {
  question_text: string;
  answer_standard: string;
  alternate_question_phrasings?: string[];
}

type PromotionCandidateActionErrorCode =
  | 'not_found'
  | 'not_awaiting_review'
  | 'write_failed';

interface PromotionCandidateActionError {
  code: PromotionCandidateActionErrorCode;
  message: string;
}

export type PromotionCandidateActionResult =
  | { ok: true; pair: PairCandidateRow; extraction: ExtractionCandidateRow }
  | { ok: false; error: PromotionCandidateActionError };

// ---------------------------------------------------------------------------
// Shared loader — the DR-026 'awaiting_review' gate (mirrors the fetcher's
// own classification, lib/query/fetchers.ts fetchQaPromotionCandidates)
// ---------------------------------------------------------------------------

interface LoadedCandidate {
  extraction: ExtractionCandidateRow;
  pair: PairCandidateRow;
}

async function loadAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
): Promise<
  | { ok: true; data: LoadedCandidate }
  | { ok: false; error: PromotionCandidateActionError }
> {
  const extractionResult = await client
    .from('q_a_extractions')
    .select(EXTRACTION_READ_COLUMNS)
    .eq('id', extractionId)
    .maybeSingle();

  if (extractionResult?.error) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message: safeErrorMessage(
          extractionResult.error,
          'Failed to load the promotion candidate',
        ),
      },
    };
  }
  const extraction: ExtractionCandidateRow | null =
    extractionResult?.data ?? null;
  if (extraction === null) {
    return {
      ok: false,
      error: { code: 'not_found', message: 'Promotion candidate not found' },
    };
  }
  if (extraction.invalidated_at !== null) {
    return {
      ok: false,
      error: {
        code: 'not_awaiting_review',
        message: 'This extraction has been invalidated — nothing to review.',
      },
    };
  }
  if (extraction.promoted_to_pair_id === null) {
    return {
      ok: false,
      error: {
        code: 'not_awaiting_review',
        message:
          'This candidate is new (not yet linked to a pair) — promote it via "Run promotion pass".',
      },
    };
  }

  const pairResult = await client
    .from('q_a_pairs')
    .select(PAIR_READ_COLUMNS)
    .eq('id', extraction.promoted_to_pair_id)
    .maybeSingle();

  if (pairResult?.error) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message: safeErrorMessage(
          pairResult.error,
          'Failed to load the linked pair',
        ),
      },
    };
  }
  const pair: PairCandidateRow | null = pairResult?.data ?? null;
  if (pair === null) {
    return {
      ok: false,
      error: {
        code: 'not_awaiting_review',
        message:
          'The linked pair could not be found — this self-heals via "Run promotion pass".',
      },
    };
  }
  if (pair.publication_status === 'draft') {
    return {
      ok: false,
      error: {
        code: 'not_awaiting_review',
        message:
          'This candidate is self-healing (linked pair still draft) — it resolves automatically via "Run promotion pass".',
      },
    };
  }

  return { ok: true, data: { extraction, pair } };
}

// ---------------------------------------------------------------------------
// Shared write helpers
// ---------------------------------------------------------------------------

async function writeCarriedFieldsToPair(
  client: SupabaseClientLike,
  pairId: string,
  carried: CarriedFields,
): Promise<
  | { ok: true; data: PairCandidateRow }
  | { ok: false; error: PromotionCandidateActionError }
> {
  const payload: Pick<
    QaPairUpdate,
    'question_text' | 'answer_standard' | 'alternate_question_phrasings'
  > = {
    question_text: carried.question_text,
    answer_standard: carried.answer_standard,
    alternate_question_phrasings: carried.alternate_question_phrasings,
  };

  const updateResult = await client
    .from('q_a_pairs')
    .update(payload)
    .eq('id', pairId)
    .select(PAIR_READ_COLUMNS)
    .maybeSingle();

  if (updateResult?.error) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message: safeErrorMessage(
          updateResult.error,
          'Failed to update the pair',
        ),
      },
    };
  }
  const row: PairCandidateRow | null = updateResult?.data ?? null;
  if (row === null) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message:
          'Pair update affected no rows — it may have been deleted concurrently.',
      },
    };
  }
  return { ok: true, data: row };
}

async function reconcileExtractionCarriedFields(
  client: SupabaseClientLike,
  extractionId: string,
  carried: CarriedFields,
): Promise<
  | { ok: true; data: ExtractionCandidateRow }
  | { ok: false; error: PromotionCandidateActionError }
> {
  const payload: Pick<
    QaExtractionUpdate,
    | 'extracted_question_text'
    | 'extracted_answer_text'
    | 'alternate_question_phrasings'
    | 'updated_at'
  > = {
    extracted_question_text: carried.question_text,
    extracted_answer_text: carried.answer_standard,
    alternate_question_phrasings: carried.alternate_question_phrasings,
    updated_at: new Date().toISOString(),
  };

  const updateResult = await client
    .from('q_a_extractions')
    .update(payload)
    .eq('id', extractionId)
    .select(EXTRACTION_READ_COLUMNS)
    .maybeSingle();

  if (updateResult?.error) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message: safeErrorMessage(
          updateResult.error,
          'Failed to reconcile the extraction record',
        ),
      },
    };
  }
  const row: ExtractionCandidateRow | null = updateResult?.data ?? null;
  if (row === null) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message:
          'Extraction update affected no rows — it may have been deleted concurrently.',
      },
    };
  }
  return { ok: true, data: row };
}

/**
 * Best-effort re-embed + record_embeddings dual-write, mirroring
 * embedAndPublish's posture in promote-corpus.ts. NEVER throws and never
 * fails the caller's action — a failure here just leaves record_embeddings
 * one step stale until the next successful carried-field write.
 */
async function bestEffortReEmbed(
  client: SupabaseClientLike,
  extractionId: string,
  pairId: string,
  questionText: string,
): Promise<void> {
  let embedding: number[];
  try {
    embedding = await generateEmbedding(questionText);
  } catch (err) {
    logBestEffortWarn(
      'qa.promotion_candidate_review.embed_failed',
      'Failed to re-generate the embedding after a promotion-candidate carried-field write',
      { extractionId, pairId, error: err },
    );
    return;
  }

  const serialisedEmbedding = JSON.stringify(embedding);
  const upsertResult = await client
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

  if (upsertResult?.error) {
    logBestEffortWarn(
      'qa.promotion_candidate_review.record_embeddings_upsert_failed',
      'Failed to dual-write the re-embedded q_a_pair into record_embeddings',
      { extractionId, pairId, error: upsertResult.error },
    );
  }
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

/**
 * ACCEPT — applies the extraction's OWN carried fields onto the published
 * pair (the diff DR-026 blocks from auto-firing; a human now confirms it).
 * No extraction write is needed: the pair now equals the extraction, so the
 * RPC's diff predicate goes false on its own (self-cleaning, see header).
 */
export async function acceptAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
): Promise<PromotionCandidateActionResult> {
  const loaded = await loadAwaitingReviewCandidate(client, extractionId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { extraction, pair } = loaded.data;

  // answer_standard is NOT NULL on the pair — a blank/NULL re-walked answer
  // falls back to the pair's EXISTING answer (mirrors repromoteCarriedFields'
  // guard in promote-corpus.ts: never blank a NOT NULL column).
  const resolvedAnswer =
    extraction.extracted_answer_text &&
    extraction.extracted_answer_text.trim().length > 0
      ? extraction.extracted_answer_text
      : pair.answer_standard;

  const carried: CarriedFields = {
    question_text: extraction.extracted_question_text,
    answer_standard: resolvedAnswer,
    alternate_question_phrasings: Array.isArray(
      extraction.alternate_question_phrasings,
    )
      ? extraction.alternate_question_phrasings
      : [],
  };

  const writeResult = await writeCarriedFieldsToPair(client, pair.id, carried);
  if (!writeResult.ok) return { ok: false, error: writeResult.error };

  await bestEffortReEmbed(client, extractionId, pair.id, carried.question_text);

  return { ok: true, pair: writeResult.data, extraction };
}

/**
 * EDIT — applies an ADMIN-SUPPLIED carried-field set onto the published
 * pair (may differ from both the extraction's raw text and the pair's prior
 * text), THEN reconciles the extraction to the SAME final values so it does
 * not immediately re-propose the diff it was just resolved from.
 */
export async function editAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
  edit: CandidateEditInput,
): Promise<PromotionCandidateActionResult> {
  const loaded = await loadAwaitingReviewCandidate(client, extractionId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { pair } = loaded.data;

  const carried: CarriedFields = {
    question_text: edit.question_text,
    answer_standard: edit.answer_standard,
    alternate_question_phrasings: edit.alternate_question_phrasings ?? [],
  };

  const writeResult = await writeCarriedFieldsToPair(client, pair.id, carried);
  if (!writeResult.ok) return { ok: false, error: writeResult.error };

  await bestEffortReEmbed(client, extractionId, pair.id, carried.question_text);

  const reconcileResult = await reconcileExtractionCarriedFields(
    client,
    extractionId,
    carried,
  );
  if (!reconcileResult.ok) return { ok: false, error: reconcileResult.error };

  return { ok: true, pair: writeResult.data, extraction: reconcileResult.data };
}

/**
 * REJECT — the pair is UNTOUCHED (the reviewer judged the published text
 * correct); the extraction's carried fields are reconciled DOWN to the
 * pair's current values so the record stops disagreeing with it.
 */
export async function rejectAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
): Promise<PromotionCandidateActionResult> {
  const loaded = await loadAwaitingReviewCandidate(client, extractionId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { pair } = loaded.data;

  const carried: CarriedFields = {
    question_text: pair.question_text,
    answer_standard: pair.answer_standard,
    alternate_question_phrasings: Array.isArray(
      pair.alternate_question_phrasings,
    )
      ? pair.alternate_question_phrasings
      : [],
  };

  const reconcileResult = await reconcileExtractionCarriedFields(
    client,
    extractionId,
    carried,
  );
  if (!reconcileResult.ok) return { ok: false, error: reconcileResult.error };

  return { ok: true, pair, extraction: reconcileResult.data };
}
