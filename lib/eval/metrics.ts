/**
 * Pure metric functions for the AI evaluation framework.
 *
 * All functions are stateless and have no external dependencies.
 * Used by classification, search, summarisation, and bid drafting eval suites.
 */

// ── Internal helpers (not exported) ─────────────────────────────────

/** Lowercase, split on whitespace/punctuation, filter empty tokens */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((t) => t.length > 0);
}

/** DP-based longest common subsequence length */
function longestCommonSubsequence(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  // Use a 1D DP array for space efficiency
  const prev = new Array<number>(n + 1).fill(0);
  const curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    // Copy curr to prev
    for (let j = 0; j <= n; j++) {
      prev[j] = curr[j];
      curr[j] = 0;
    }
  }

  return prev[n];
}

/** Discounted Cumulative Gain: sum of score_i / log2(i + 2) */
function computeDCG(scores: number[]): number {
  let dcg = 0;
  for (let i = 0; i < scores.length; i++) {
    dcg += scores[i] / Math.log2(i + 2);
  }
  return dcg;
}

// ── Exported metric functions ───────────────────────────────────────

/** Precision: tp / (tp + fp). Returns 0 if both are 0. */
export function precision(tp: number, fp: number): number {
  const denominator = tp + fp;
  if (denominator === 0) return 0;
  return tp / denominator;
}

/** Recall: tp / (tp + fn). Returns 0 if both are 0. */
export function recall(tp: number, fn: number): number {
  const denominator = tp + fn;
  if (denominator === 0) return 0;
  return tp / denominator;
}

/** F1 score: harmonic mean of precision and recall. Returns 0 if both are 0. */
export function f1Score(p: number, r: number): number {
  const denominator = p + r;
  if (denominator === 0) return 0;
  return (2 * p * r) / denominator;
}

/** Accuracy: correct / total. Returns 0 if total is 0. */
export function accuracy(correct: number, total: number): number {
  if (total === 0) return 0;
  return correct / total;
}

/**
 * ROUGE-L using Longest Common Subsequence.
 * Returns precision, recall, and F1 based on LCS length.
 * Returns {0, 0, 0} for empty strings.
 */
export function rougeL(
  candidate: string,
  reference: string
): { precision: number; recall: number; f1: number } {
  const candTokens = tokenise(candidate);
  const refTokens = tokenise(reference);

  if (candTokens.length === 0 || refTokens.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const lcsLen = longestCommonSubsequence(candTokens, refTokens);
  const p = lcsLen / candTokens.length;
  const r = lcsLen / refTokens.length;
  const f = f1Score(p, r);

  return { precision: p, recall: r, f1: f };
}

/**
 * ROUGE-1: unigram overlap between candidate and reference.
 * Returns precision, recall, and F1 based on shared unigrams.
 * Returns {0, 0, 0} for empty strings.
 */
export function rouge1(
  candidate: string,
  reference: string
): { precision: number; recall: number; f1: number } {
  const candidateTokens = tokenise(candidate);
  const referenceTokens = tokenise(reference);

  if (candidateTokens.length === 0 || referenceTokens.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const candidateSet = new Set(candidateTokens);
  const referenceSet = new Set(referenceTokens);

  let overlap = 0;
  for (const token of candidateSet) {
    if (referenceSet.has(token)) overlap++;
  }

  const p = overlap / candidateSet.size;
  const r = overlap / referenceSet.size;
  const f = p + r === 0 ? 0 : (2 * p * r) / (p + r);

  return { precision: p, recall: r, f1: f };
}

/**
 * Mean Reciprocal Rank across multiple queries.
 * Each query provides an ordered list of results with relevance flags.
 * MRR = average of (1 / rank of first relevant result) across queries.
 * Returns 0 if no queries or no relevant results found.
 */
export function mrr(results: Array<{ relevant: boolean }[]>): number {
  if (results.length === 0) return 0;

  let sum = 0;
  for (const queryResults of results) {
    for (let i = 0; i < queryResults.length; i++) {
      if (queryResults[i].relevant) {
        sum += 1 / (i + 1);
        break;
      }
    }
  }

  return sum / results.length;
}

/**
 * Normalised Discounted Cumulative Gain at position k.
 * Compares actual relevance scores against ideal ordering.
 * Returns 0 if ideal DCG is 0 or k is 0.
 */
export function ndcgAtK(
  relevanceScores: number[],
  idealScores: number[],
  k: number
): number {
  if (k === 0) return 0;

  const actualSlice = relevanceScores.slice(0, k);
  const idealSlice = idealScores.slice(0, k);

  const actualDCG = computeDCG(actualSlice);
  const idealDCG = computeDCG(idealSlice);

  if (idealDCG === 0) return 0;
  return actualDCG / idealDCG;
}

/**
 * Precision at K: proportion of relevant results in top-k.
 * Returns 0 if k is 0.
 */
export function precisionAtK(
  results: Array<{ relevant: boolean }>,
  k: number
): number {
  if (k === 0) return 0;
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;
  const relevant = topK.filter((r) => r.relevant).length;
  return relevant / topK.length;
}
