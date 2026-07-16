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
 *
 * DISPOSITION AUDIT ({145.34}, S474 owner ruling — elevated from backlog to
 * a v1 subtask on staff-engineer review of this module): every action above
 * ALSO writes exactly one append-only row into the new `promotion_dispositions`
 * table (migration: supabase/migrations/*_id145_145_34_promotion_dispositions.sql,
 * authored-only — rides the next coordinated deploy) — closing two gaps:
 *   Gap 1 (no audit) — reject reconciles the extraction DOWN to the pair's
 *     values, destroying what was PROPOSED. `proposed_snapshot` captures the
 *     PROPOSED carried fields per action: accept/edit record what got
 *     ADOPTED onto the pair; reject records the extraction's PRE-reconcile
 *     (raw re-walked) fields — i.e. what was proposed and rejected, not the
 *     published values it converges to.
 *   Gap 2 (reject not durable across re-walks) — a corpus re-walk can
 *     re-diverge the SAME extraction to the SAME text a human already
 *     rejected, re-firing the RPC's branch-3 diff predicate for an identical
 *     proposal. `rejectAwaitingReviewCandidate` consults the LATEST
 *     disposition for the extraction and, when it is itself a 'reject' with
 *     a `proposed_snapshot` identical to the current proposal, SUPPRESSES
 *     the re-fire: it still reconciles silently (so the candidate still
 *     drops out of `awaiting_review`) but skips writing a duplicate
 *     disposition row — no fresh human judgement required. accept/edit are
 *     never suppressed: a human choosing to accept/edit is an explicit new
 *     judgement overriding whatever happened before.
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

/**
 * {145.34} — append-only `promotion_dispositions` audit row. Hand-authored
 * (NOT `Database['public']['Tables']['promotion_dispositions']`): the
 * migration is authored-only (no types regen yet per the {145.34} dispatch
 * brief), so this table has no entry in database.types.ts. SupabaseClientLike
 * ({@link SupabaseClientLike}) types `.from()` as `any`, so this compiles
 * without one.
 */
type PromotionDispositionAction = 'accept' | 'edit' | 'reject';

interface PromotionDispositionInsert {
  extraction_id: string;
  action: PromotionDispositionAction;
  actor: string;
  proposed_snapshot: CarriedFields;
}

interface PromotionDispositionRow {
  id: string;
  extraction_id: string;
  action: PromotionDispositionAction;
  actor: string;
  created_at: string;
  proposed_snapshot: CarriedFields;
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

/**
 * {145.34} Gap 1 — inserts exactly one append-only audit row into
 * `promotion_dispositions` per accept/edit/reject action. Unlike
 * `bestEffortReEmbed`, this is NOT best-effort: a failure here propagates
 * `write_failed` to the caller, matching every other write helper in this
 * file (`writeCarriedFieldsToPair` / `reconcileExtractionCarriedFields`) —
 * the whole point of this table is a DURABLE record of what was proposed, so
 * a silently-dropped insert would defeat it.
 */
async function recordDisposition(
  client: SupabaseClientLike,
  params: {
    extractionId: string;
    action: PromotionDispositionAction;
    actor: string;
    proposedSnapshot: CarriedFields;
  },
): Promise<{ ok: true } | { ok: false; error: PromotionCandidateActionError }> {
  const insertPayload: PromotionDispositionInsert = {
    extraction_id: params.extractionId,
    action: params.action,
    actor: params.actor,
    proposed_snapshot: params.proposedSnapshot,
  };

  const insertResult = await client
    .from('promotion_dispositions')
    .insert(insertPayload);

  if (insertResult?.error) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message: safeErrorMessage(
          insertResult.error,
          'Failed to record the promotion disposition',
        ),
      },
    };
  }
  return { ok: true };
}

/**
 * {145.34} Gap 2 — the latest `promotion_dispositions` row for an
 * extraction (ORDER BY created_at DESC LIMIT 1), or `null` when none exists
 * yet. Read errors propagate `write_failed` — consistent with every other
 * Supabase read in this file (`loadAwaitingReviewCandidate`); a suppression
 * decision must never be made on an unknown/erroring read.
 */
async function loadLatestDisposition(
  client: SupabaseClientLike,
  extractionId: string,
): Promise<
  | { ok: true; data: PromotionDispositionRow | null }
  | { ok: false; error: PromotionCandidateActionError }
> {
  const result = await client
    .from('promotion_dispositions')
    .select('id, extraction_id, action, actor, created_at, proposed_snapshot')
    .eq('extraction_id', extractionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result?.error) {
    return {
      ok: false,
      error: {
        code: 'write_failed',
        message: safeErrorMessage(
          result.error,
          'Failed to load the latest promotion disposition',
        ),
      },
    };
  }
  const row: PromotionDispositionRow | null = result?.data ?? null;
  return { ok: true, data: row };
}

/** Order/length-sensitive deep-equality over the carried-fields shape —
 *  used to detect a re-fired IDENTICAL rejected proposal (Gap 2). */
function carriedFieldsEqual(a: CarriedFields, b: CarriedFields): boolean {
  if (a.question_text !== b.question_text) return false;
  if (a.answer_standard !== b.answer_standard) return false;
  if (
    a.alternate_question_phrasings.length !==
    b.alternate_question_phrasings.length
  )
    return false;
  return a.alternate_question_phrasings.every(
    (phrasing, index) => phrasing === b.alternate_question_phrasings[index],
  );
}

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

/**
 * ACCEPT — applies the extraction's OWN carried fields onto the published
 * pair (the diff DR-026 blocks from auto-firing; a human now confirms it).
 * No extraction write is needed: the pair now equals the extraction, so the
 * RPC's diff predicate goes false on its own (self-cleaning, see header).
 *
 * {145.34}: writes ONE `promotion_dispositions` row (action='accept') with
 * `proposed_snapshot` = the carried fields just adopted onto the pair.
 */
export async function acceptAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
  actor: string,
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

  const dispositionResult = await recordDisposition(client, {
    extractionId,
    action: 'accept',
    actor,
    proposedSnapshot: carried,
  });
  if (!dispositionResult.ok)
    return { ok: false, error: dispositionResult.error };

  return { ok: true, pair: writeResult.data, extraction };
}

/**
 * EDIT — applies an ADMIN-SUPPLIED carried-field set onto the published
 * pair (may differ from both the extraction's raw text and the pair's prior
 * text), THEN reconciles the extraction to the SAME final values so it does
 * not immediately re-propose the diff it was just resolved from.
 *
 * {145.34}: writes ONE `promotion_dispositions` row (action='edit') with
 * `proposed_snapshot` = the admin-supplied carried fields.
 */
export async function editAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
  edit: CandidateEditInput,
  actor: string,
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

  const dispositionResult = await recordDisposition(client, {
    extractionId,
    action: 'edit',
    actor,
    proposedSnapshot: carried,
  });
  if (!dispositionResult.ok)
    return { ok: false, error: dispositionResult.error };

  return { ok: true, pair: writeResult.data, extraction: reconcileResult.data };
}

/**
 * REJECT — the pair is UNTOUCHED (the reviewer judged the published text
 * correct); the extraction's carried fields are reconciled DOWN to the
 * pair's current values so the record stops disagreeing with it.
 *
 * {145.34}: Gap 1 — captures the extraction's PRE-reconcile carried fields
 * (what was PROPOSED, not the pair's published values it reconciles down
 * to) into ONE `promotion_dispositions` row (action='reject'). Gap 2 — first
 * consults the LATEST disposition for this extraction; if it is itself a
 * 'reject' whose `proposed_snapshot` is deep-equal to the CURRENT proposal,
 * this is a re-fired IDENTICAL rejected proposal (a corpus re-walk
 * re-diverged the same extraction to the same text already rejected) —
 * suppressed: the reconcile still runs silently (so the candidate still
 * drops out of `awaiting_review`), but no duplicate disposition row is
 * written and no fresh human judgement is required.
 */
export async function rejectAwaitingReviewCandidate(
  client: SupabaseClientLike,
  extractionId: string,
  actor: string,
): Promise<PromotionCandidateActionResult> {
  const loaded = await loadAwaitingReviewCandidate(client, extractionId);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const { extraction, pair } = loaded.data;

  // Gap 1 — the PROPOSED carried fields (pre-reconcile), captured BEFORE
  // they are overwritten below. answer_standard has no NOT NULL constraint
  // to protect here (this is an audit snapshot, not a pair write), so a
  // blank/null re-walked answer is coerced to '' (never left null) purely so
  // repeat identical re-fires compare equal in Gap 2 below.
  const proposedSnapshot: CarriedFields = {
    question_text: extraction.extracted_question_text,
    answer_standard: extraction.extracted_answer_text ?? '',
    alternate_question_phrasings: Array.isArray(
      extraction.alternate_question_phrasings,
    )
      ? extraction.alternate_question_phrasings
      : [],
  };

  // Gap 2 — suppress a re-fired IDENTICAL rejected proposal.
  const latestDisposition = await loadLatestDisposition(client, extractionId);
  if (!latestDisposition.ok)
    return { ok: false, error: latestDisposition.error };
  const isRefiredIdenticalReject =
    latestDisposition.data !== null &&
    latestDisposition.data.action === 'reject' &&
    carriedFieldsEqual(
      latestDisposition.data.proposed_snapshot,
      proposedSnapshot,
    );

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

  if (!isRefiredIdenticalReject) {
    const dispositionResult = await recordDisposition(client, {
      extractionId,
      action: 'reject',
      actor,
      proposedSnapshot,
    });
    if (!dispositionResult.ok)
      return { ok: false, error: dispositionResult.error };
  }

  return { ok: true, pair, extraction: reconcileResult.data };
}
