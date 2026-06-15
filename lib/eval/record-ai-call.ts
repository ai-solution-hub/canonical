/**
 * `recordAiCall()` — the single AI-call cost + signal capture point
 * (ID-104 T14 / B-INV-14, B-INV-16).
 *
 * ONE capture point for every instrumented AI touchpoint. It persists a row to
 * `ai_call_events` (M4) carrying the model + tier, the token/cache counts taken
 * straight off the Anthropic `usage` surface ({@link TokenUsage} in
 * `lib/anthropic.ts`), the derived `cost_usd` (computed via the EXISTING
 * {@link estimateCost} path — cost math is NOT reimplemented here), and a
 * ratified {@link OutcomeSignal} (`win | fail | loop | refusal`).
 *
 * Egress discipline (B-INV-15/16): the row is written on-platform only. There is
 * no off-platform writer or reader; the cost-tab rollup (T17) reads it back via
 * an admin-gated surface.
 *
 * Failure discipline: recording is observability, not the calling AI flow's
 * critical path. A persistence failure is returned as a {@link Result} (never
 * thrown) so an instrumented touchpoint cannot crash because its cost row failed
 * to land. The greppable `recordAiCall(` literal is the forcing function the
 * T16 guard (`__tests__/eval/record-ai-call-guard.test.ts`) holds every
 * `@ai-touchpoint` file to.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TablesInsert } from '@/supabase/types/database.types';
import { estimateCost, type TokenUsage, type ModelTier } from '@/lib/anthropic';
import { outcomeSignalSchema, type OutcomeSignal } from '@/lib/eval/contract';
import { tryQuery, SupabaseError, type Result } from '@/lib/supabase/safe';
import type { PostgrestError } from '@supabase/supabase-js';

/** Arguments for a single AI-call capture. */
export interface RecordAiCallArgs {
  /** Authorised (or service-role) client — writes are RLS-gated to service-only. */
  supabase: SupabaseClient<Database>;
  /** Stable touchpoint slug — FK into `eval_touchpoints` (M1). */
  touchpointId: string;
  /** The concrete model id the call ran against (e.g. `claude-sonnet-4-6`). */
  model: string;
  /** The tier the model was selected for (`analysis | drafting | quality`, or a raw string). */
  tier: ModelTier | string;
  /** Token + cache usage off the Anthropic response `usage` object. */
  usage: TokenUsage;
  /** Ratified outcome signal for the call. */
  outcomeSignal: OutcomeSignal;
}

/** Result of a capture: the new row id on success, a {@link SupabaseError} on failure. */
export type RecordAiCallResult = Result<{ id: string }, SupabaseError>;

/**
 * Persist one AI call's cost + outcome signal to `ai_call_events`.
 *
 * The Anthropic `usage` field names differ from the DB column names — the cache
 * counters are mapped here (`cache_creation_input_tokens` → `cache_write_tokens`,
 * `cache_read_input_tokens` → `cache_read_tokens`), and absent cache counts
 * default to zero (matching the column DEFAULTs).
 *
 * @returns `{ ok: true, data: { id } }` on success, or `{ ok: false, error }`
 *   on an invalid signal or a persistence failure — never throws.
 */
export async function recordAiCall(
  args: RecordAiCallArgs,
): Promise<RecordAiCallResult> {
  const { supabase, touchpointId, model, tier, usage, outcomeSignal } = args;

  // Validate the signal against the SAME source the migration enum mirrors, so
  // an unratified value is rejected before it can reach the DB (where it would
  // raise a less legible enum-violation error).
  const signal = outcomeSignalSchema.safeParse(outcomeSignal);
  if (!signal.success) {
    // Surface as a SupabaseError so the Result carries a uniform error type
    // whether the failure is a bad signal or a real PostgREST error. The
    // synthetic PostgrestError mirrors the shape tryQuery() wraps on a network
    // failure (see lib/supabase/safe.ts).
    const validationError = {
      message: `outcome_signal '${String(outcomeSignal)}' is not a ratified signal (win|fail|loop|refusal)`,
      code: 'INVALID_OUTCOME_SIGNAL',
      details: '',
      hint: '',
    } as PostgrestError;
    return {
      ok: false,
      error: new SupabaseError(validationError, 'ai_call_events.recordAiCall'),
    };
  }

  const row: TablesInsert<'ai_call_events'> = {
    touchpoint_id: touchpointId,
    model,
    tier: String(tier),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    // Anthropic usage → DB column-name mapping; absent cache counts default to 0.
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    cost_usd: estimateCost(model, usage),
    outcome_signal: signal.data,
  };

  return tryQuery(
    supabase
      .from('ai_call_events')
      .insert(row)
      .select('id')
      .single<{ id: string }>(),
    'ai_call_events.recordAiCall',
  );
}
