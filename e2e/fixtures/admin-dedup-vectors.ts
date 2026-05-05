/**
 * Deterministic 1024-dim vector helpers for admin-dedup E2E fixtures.
 *
 * Generates unit vectors with bit-identical determinism across runs and a
 * perturbation function that lands a second vector at a precisely-controlled
 * cosine similarity to a base vector. Used by the §1.7 + §1.9 admin-dedup
 * fixture to seed near-duplicate pairs without OpenAI API calls.
 *
 * Reference: `docs/audits/s213b-admin-dedup-fixtures-design.md` §4
 * (embedding strategy) + §9.3 (deterministic seed decision).
 */

const VECTOR_DIM = 1024;
const LARGE_PRIME = 7919;
const SEED_MIX = 31;
const SEED_FREQ = 104729; // distinct large prime for the (i * seed) cross-term
const DEFAULT_SEED = 0xc0ffee;

/**
 * Deterministic seed for reproducible vector generation.
 * Override via the `E2E_FIXTURE_SEED` env var for local debugging or
 * bisection; otherwise falls back to a hardcoded constant.
 */
export const FIXTURE_SEED: number = (() => {
  const raw = process.env.E2E_FIXTURE_SEED;
  if (raw === undefined) return DEFAULT_SEED;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
})();

/**
 * Compute the L2 (Euclidean) norm of a vector. Pure helper; no zero-norm
 * defence here — callers must guard before normalising.
 */
function l2Norm(v: readonly number[]): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i += 1) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * Normalise a vector to unit length. Returns a new array. If the input has
 * zero norm, returns a copy unchanged (defensive — callers in this module
 * never feed zero vectors).
 */
function normalise(v: readonly number[]): number[] {
  const norm = l2Norm(v);
  if (norm === 0) return v.slice();
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i += 1) {
    out[i] = v[i] / norm;
  }
  return out;
}

/**
 * 1024-dim unit vector deterministically derived from `seed`.
 *
 * Components are produced by
 *   `Math.sin(i * LARGE_PRIME + seed * SEED_MIX + i * seed * SEED_FREQ)`
 * for `i in 0..1023`, then unit-normalised. The cross-term `i * seed * SEED_FREQ`
 * decorrelates output for nearby seeds — without it, distinct seeds collapse to
 * a near-uniform phase shift and the resulting vectors stay highly correlated.
 *
 * Pure function of `(i, seed)` — no PRNG state, bit-identical across calls
 * and runs.
 */
export function baseVector(seed: number): number[] {
  const v = new Array<number>(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i += 1) {
    v[i] = Math.sin(i * LARGE_PRIME + seed * SEED_MIX + i * seed * SEED_FREQ);
  }
  return normalise(v);
}

/**
 * Returns a 1024-dim unit vector with cosine similarity ≈ `targetCosine`
 * to `base`. `noiseSeed` makes the orthogonal-noise selection deterministic.
 *
 * Math contract: |actual - target| ≤ 0.001 across `targetCosine` in
 * [0.86, 0.99] (verified by `__tests__/fixtures/admin-dedup-vectors.test.ts`).
 *
 * Construction:
 *   1. `noise = baseVector(noiseSeed)`.
 *   2. Project out the `base` component: `orthNoise = noise - (noise · base) * base`,
 *      then re-normalise so it is a unit vector orthogonal to `base`.
 *   3. Mix: `result = α * base + β * orthNoise` with `α = targetCosine`,
 *      `β = sqrt(1 - α²)`.
 *   4. Re-normalise (defensive against floating-point drift).
 */
export function perturbVector(
  base: readonly number[],
  targetCosine: number,
  noiseSeed: number,
): number[] {
  if (base.length !== VECTOR_DIM) {
    throw new Error(
      `perturbVector: base must be ${VECTOR_DIM}-dim, got ${base.length}`,
    );
  }

  const noise = baseVector(noiseSeed);

  // Project noise onto base, then subtract — produces a vector orthogonal to base.
  let dot = 0;
  for (let i = 0; i < VECTOR_DIM; i += 1) {
    dot += noise[i] * base[i];
  }
  const orth = new Array<number>(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i += 1) {
    orth[i] = noise[i] - dot * base[i];
  }
  const orthNoise = normalise(orth);

  const alpha = targetCosine;
  // Clamp the radicand at zero to absorb floating-point overshoot when
  // `targetCosine` is very close to ±1.
  const beta = Math.sqrt(Math.max(0, 1 - alpha * alpha));

  const mixed = new Array<number>(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i += 1) {
    mixed[i] = alpha * base[i] + beta * orthNoise[i];
  }

  return normalise(mixed);
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns 0 on zero-norm input (defensive — avoids NaN propagation).
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * FNV-1a 32-bit hash of a UTF-8 string. Deterministic, no dependencies.
 * Used to derive a numeric seed from a human-readable pair-key.
 */
function hashStringToInt(s: string): number {
  // FNV-1a constants (32-bit).
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via Math.imul to stay in int32 range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned 32-bit so callers see a stable non-negative integer.
  return hash >>> 0;
}

/**
 * Convenience: build a near-duplicate pair at `targetCosine` using deterministic
 * seeds derived from `pairKey`. Returns `[left, right]`.
 *
 * `left = baseVector(hash(pairKey))`;
 * `right = perturbVector(left, targetCosine, hash(pairKey) + 1)`.
 */
export function buildPair(
  pairKey: string,
  targetCosine: number,
): [number[], number[]] {
  const seed = hashStringToInt(pairKey);
  const left = baseVector(seed);
  const right = perturbVector(left, targetCosine, seed + 1);
  return [left, right];
}
