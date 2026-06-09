/**
 * Edit-intent arbitration ({59.6}).
 *
 * Pure, mock-free, time-independent: no DB, no route, no schema, no I/O.
 *
 * `EditIntent` is the SINGLE canonical-vocabulary (CV) source of truth — other
 * slices ({59.8}/{59.11}) import it from here via a direct file import
 * (`@/lib/edit-intent/arbitrate`), never a barrel re-export.
 *
 * Arbitration is invoked ONLY on the CRDT/collab paths ({59.8}/{59.11}), where
 * two concurrent edit intents must be merged. Single-actor use cases stamp an
 * intent directly and never call `arbitrate`/`arbitrateMany`.
 */
export type EditIntent = 'cosmetic' | 'data' | 'structural';

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
