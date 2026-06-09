/**
 * Edit-intent arbitration ({59.6}) + coercion fallback ({59.7}).
 *
 * The arbitration core (`arbitrate`/`arbitrateMany`) is pure, time-independent:
 * no DB, no route, no schema. `coerceIntent` ({59.7}) is the one boundary-guard
 * here; its ONLY side effect is a best-effort structured log on the fallback
 * path (delegated to `logBestEffortWarn`, which never throws).
 *
 * `EditIntent` is the SINGLE canonical-vocabulary (CV) source of truth — other
 * slices ({59.8}/{59.11}) import it from here via a direct file import
 * (`@/lib/edit-intent/arbitrate`), never a barrel re-export.
 *
 * Arbitration is invoked ONLY on the CRDT/collab paths ({59.8}/{59.11}), where
 * two concurrent edit intents must be merged. Single-actor use cases stamp an
 * intent directly and never call `arbitrate`/`arbitrateMany`.
 */
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

export type EditIntent = 'cosmetic' | 'data' | 'structural';

/**
 * Canonical-vocabulary (CV) membership set — the source of truth for
 * `coerceIntent`'s "is this a known intent?" test. Kept in lock-step with the
 * `EditIntent` union above.
 */
const EDIT_INTENT_CV: ReadonlySet<EditIntent> = new Set<EditIntent>([
  'cosmetic',
  'data',
  'structural',
]);

/**
 * Structured-log category for the {59.7} coercion fallback
 * (PRODUCT PC-12 / INV-12). Dot-delimited per the `logBestEffortWarn`
 * naming convention.
 */
const ARBITRATION_FALLBACK_CATEGORY = 'edit.intent.arbitration.fallback';

/**
 * Provenance for a single coercion call — the ids that let an operator trace a
 * skewed client's payload back to the user / item / collaboration op.
 */
export interface CoerceIntentContext {
  userId: string;
  contentItemId: string;
  opId: string;
}

/**
 * Coerce an untrusted, per-side `received` value to a valid {@link EditIntent}
 * BEFORE it reaches `arbitrateMany` (PRODUCT PC-12 / INV-12).
 *
 * - If `received` is already a CV member, it is returned verbatim.
 * - Otherwise (null, undefined, or any out-of-CV value) the value is treated as
 *   the unit element `'cosmetic'`, so a skewed or malicious client can never
 *   *dilute* another participant's explicit `'data'`/`'structural'` intent —
 *   cosmetic is absorbed by arbitration, it does not absorb.
 *
 * The fallback emits a best-effort structured log
 * (`edit_intent_arbitration_fallback`) carrying the offending `received` value,
 * `treated_as: 'cosmetic'`, and the `ctx` ids. That log is the OBSERVABLE
 * contract of the fallback path. `coerceIntent` NEVER throws: the logger is
 * best-effort and the return is total over all inputs.
 */
export function coerceIntent(
  received: unknown,
  ctx: CoerceIntentContext,
): EditIntent {
  if (
    typeof received === 'string' &&
    EDIT_INTENT_CV.has(received as EditIntent)
  ) {
    return received as EditIntent;
  }

  logBestEffortWarn(
    ARBITRATION_FALLBACK_CATEGORY,
    'edit_intent_arbitration_fallback',
    {
      received,
      treated_as: 'cosmetic',
      userId: ctx.userId,
      contentItemId: ctx.contentItemId,
      opId: ctx.opId,
    },
  );

  return 'cosmetic';
}

/**
 * Merge two concurrent edit intents.
 *
 * Truth table (verbatim, PRODUCT INV-2/9/10 · TECH PC-2/9/10):
 *   - cosmetic + cosmetic ⇒ 'cosmetic' (cosmetic is the unit element);
 *   - any data/structural on either side ⇒ 'data'.
 *
 * Commutative: `arbitrate(a, b) === arbitrate(b, a)` for all inputs.
 */
export function arbitrate(a: EditIntent, b: EditIntent): EditIntent {
  if (a === 'cosmetic' && b === 'cosmetic') return 'cosmetic';
  return 'data';
}

/**
 * Fold a list of edit intents to a single arbitrated intent.
 *
 * Seeds with the unit element `'cosmetic'`, so:
 *   - `arbitrateMany([]) === 'cosmetic'`;
 *   - the result is order-independent (arbitration is commutative).
 */
export function arbitrateMany(intents: EditIntent[]): EditIntent {
  return intents.reduce<EditIntent>((acc, x) => arbitrate(acc, x), 'cosmetic');
}
