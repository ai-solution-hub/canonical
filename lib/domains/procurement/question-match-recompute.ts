/**
 * ID-145 {145.17} — R7 retrieval wiring (BI-34/35). Shared recompute helper
 * used by the question create/update routes (extract/route.ts, route.ts,
 * [qId]/route.ts) to call the built-but-unwired `question_match_recompute`
 * RPC (TECH.md §4 "Retrieval wiring (R7) — WIRE the id-57 substrate, do not
 * rebuild"; PRODUCT.md BI-34/35).
 *
 * BEST-EFFORT: every failure (organisation-profile lookup, embedding
 * generation, or the RPC call itself) is caught and logged, never thrown —
 * a corpus-matching hiccup must never block question create/update. Mirrors
 * the extract route's existing best-effort tender-metadata pattern
 * (questions/extract/route.ts).
 *
 * OQ-7 DEFAULT (owner may revise, TECH §9 decision 2): `p_scope_tag` derives
 * from the item's `form_type` (= `question_kind`, a `form_types.key` FK)
 * plus the primary organisation profile's `sectors`
 * (lib/organisation-profile.ts) as the v1 tenant-config source — matches the
 * S462 note's "form_type + sector" derivation. `p_anti_scope_tag` defaults
 * to `[]`: TECH names no anti-scope-tag derivation source for v1, and the
 * live `question_match_recompute` body (20260709234230_id57_clamp_
 * question_match_embedding_score.sql) never actually references the
 * `p_anti_scope_tag` parameter in its WHERE clause (the anti-scope exclusion
 * it implements — `qap.anti_scope_tag && p_scope_tag` — reads the corpus
 * row's own anti_scope_tag against the CALLER's scope_tag, not against a
 * caller-supplied anti-scope-tag array) — flagged as an out-of-scope
 * substrate observation in the {145.17} journal, not fixed here (WIRE, do
 * not rebuild).
 *
 * Embedding persistence ({145.29}, S470 owner ratification — supersedes the
 * {145.17}-era TECH §9 decision 3 DEFAULT of compute-on-recompute-only):
 * PERSIST, not compute-on-recompute. The embedding computed below for the
 * RPC call is ALSO best-effort upserted into the polymorphic
 * `record_embeddings` store (owner_kind='form_question', owner_id=
 * formQuestionId; DR-036 — record_embeddings is the single embeddings
 * home, extended by 20260712066000_id145_form_question_embedding_owner_kind.sql
 * to admit 'form_question'). The write failing must never block question
 * create/update — mirrors the classify.ts / promote-corpus.ts record_
 * embeddings upsert-failure handling (logBestEffortWarn, non-throwing).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { generateEmbedding } from '@/lib/ai/embed';
import { getOrganisationProfile } from '@/lib/organisation-profile';
import { tryQuery } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

/** Matches the `model` literal every other record_embeddings writer uses
 * (classify.ts, promote-corpus.ts, the {130.15}/{131.11} migrate scripts) —
 * not `getEmbeddingModel()`, to stay byte-identical with that convention. */
const EMBEDDING_MODEL = 'text-embedding-3-large';

/** Matches the RPC's own `p_limit integer DEFAULT 20`. */
const RECOMPUTE_LIMIT = 20;

/** Bounded concurrency for batch recompute — mirrors the established
 * batches-of-5 Promise.allSettled pattern in questions/match/route.ts. */
const RECOMPUTE_BATCH_SIZE = 5;

export interface RecomputeQuestionMatchesInput {
  formQuestionId: string;
  questionText: string;
  /**
   * `form_instances.form_type` — the `question_kind` FK value
   * (`form_types.key`). A missing/null value skips recompute rather than
   * writing a garbage-scoped edge (`question_matches.question_kind` is
   * NOT NULL + FK to `form_types.key`).
   */
  formType: string | null | undefined;
}

/**
 * Recompute `question_matches` for a single form question via the
 * `question_match_recompute` RPC. Never throws.
 */
export async function recomputeQuestionMatches(
  supabase: SupabaseClient<Database>,
  { formQuestionId, questionText, formType }: RecomputeQuestionMatchesInput,
): Promise<void> {
  if (!formType) {
    logger.warn(
      { formQuestionId },
      '[question-match-recompute] skipped — form has no form_type (question_kind FK requires one)',
    );
    return;
  }

  try {
    const [organisation, embedding] = await Promise.all([
      getOrganisationProfile(supabase),
      generateEmbedding(questionText),
    ]);

    // BI-35/OQ-7 default: form_type + the organisation's declared sectors.
    const scopeTag = Array.from(
      new Set([formType, ...(organisation?.sectors ?? [])]),
    );

    // CLAUDE.md vector gotcha: RPC/record_embeddings vector params take
    // JSON.stringify(embedding), never a raw array. Stringified once and
    // reused for both writes below — {145.29}: the value fed to the RPC
    // IS the value persisted, never a second independently-generated one.
    const serialisedEmbedding = JSON.stringify(embedding);

    const [result, embeddingUpsertResult] = await Promise.all([
      tryQuery(
        supabase.rpc('question_match_recompute', {
          p_form_question_id: formQuestionId,
          p_query: questionText,
          p_query_embedding: serialisedEmbedding,
          p_question_kind: formType,
          p_scope_tag: scopeTag,
          p_anti_scope_tag: [],
          p_limit: RECOMPUTE_LIMIT,
        }),
        'procurement.question_match_recompute',
      ),
      // {145.29} (S470): best-effort persist — a failure here must NEVER
      // block question create/update, so it runs alongside the RPC call
      // rather than gating it, and its failure is reported via
      // logBestEffortWarn (never thrown/rethrown).
      tryQuery(
        supabase
          .from('record_embeddings')
          .upsert(
            {
              owner_kind: 'form_question',
              owner_id: formQuestionId,
              model: EMBEDDING_MODEL,
              embedding: serialisedEmbedding,
            },
            { onConflict: 'owner_kind,owner_id,model' },
          )
          .select('id')
          .maybeSingle(),
        'procurement.question_match_recompute.record_embeddings_upsert',
      ),
    ]);

    if (!result.ok) {
      logger.warn(
        { err: result.error, formQuestionId },
        '[question-match-recompute] recompute RPC failed (non-critical)',
      );
    }

    if (!embeddingUpsertResult.ok) {
      logBestEffortWarn(
        'procurement.question_match_recompute.embedding_persist',
        'Failed to persist form_question embedding into record_embeddings',
        { formQuestionId, error: embeddingUpsertResult.error },
      );
    }
  } catch (err) {
    logger.warn(
      { err, formQuestionId },
      '[question-match-recompute] recompute failed (non-critical)',
    );
  }
}

/**
 * Best-effort batch wrapper for multiple newly-created/updated questions
 * (e.g. the extract route's post-insert loop). Bounded concurrency so
 * extracting many questions at once does not fire unbounded parallel
 * embedding/RPC calls. `recomputeQuestionMatches` never throws, so batch
 * members cannot fail each other.
 */
export async function recomputeQuestionMatchesBatch(
  supabase: SupabaseClient<Database>,
  questions: Array<{ id: string; questionText: string }>,
  formType: string | null | undefined,
): Promise<void> {
  for (let i = 0; i < questions.length; i += RECOMPUTE_BATCH_SIZE) {
    const batch = questions.slice(i, i + RECOMPUTE_BATCH_SIZE);
    await Promise.all(
      batch.map((q) =>
        recomputeQuestionMatches(supabase, {
          formQuestionId: q.id,
          questionText: q.questionText,
          formType,
        }),
      ),
    );
  }
}
