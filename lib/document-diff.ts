/**
 * Q&A pair diff engine for source document version comparison.
 *
 * Uses deterministic string similarity (Dice coefficient / bigram overlap)
 * to match questions across document versions — no embeddings or AI required.
 *
 * Phase 4.2 of Content Lifecycle spec.
 */

export interface QAPair {
  question: string;
  answer: string;
}

export interface DiffEntry {
  diff_type: 'added' | 'removed' | 'modified' | 'unchanged';
  old_question?: string;
  old_content?: string; // old answer
  new_question?: string;
  new_content?: string; // new answer
  similarity_score?: number;
}

export interface DiffResult {
  old_document_id: string;
  new_document_id: string;
  entries: DiffEntry[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    total_old: number;
    total_new: number;
  };
}

// ---------------------------------------------------------------------------
// Q&A extraction
// ---------------------------------------------------------------------------

/** Maximum number of Q&A pairs to extract from a single document. */
export const MAX_QA_PAIRS = 1000;

/**
 * Extract Q&A pairs from document text.
 *
 * Supports multiple formats:
 *  1. "Q: ... A: ..." pattern (most common in bid library)
 *  2. "Question: ... Answer: ..." pattern
 *  3. Pipe-delimited table rows (Question | Answer)
 *
 * Multi-line answers are captured up to the next Q:/Question: marker or EOF.
 * Empty / whitespace-only pairs are filtered out.
 * Results are capped at {@link MAX_QA_PAIRS} pairs.
 */
export function extractQAPairs(text: string): QAPair[] {
  if (!text || text.trim().length === 0) return [];

  // Try structured Q/A patterns first
  let pairs = extractStructuredPairs(text);
  if (pairs.length === 0) {
    // Fall back to pipe-delimited table format
    pairs = extractTablePairs(text);
  }

  if (pairs.length > MAX_QA_PAIRS) {
    console.warn(`extractQAPairs: truncated ${pairs.length} pairs to ${MAX_QA_PAIRS}`);
    pairs = pairs.slice(0, MAX_QA_PAIRS);
  }

  return pairs;
}

/**
 * Extract pairs using Q:/Question: and A:/Answer: markers.
 *
 * Splits on Q:/Question: line markers, then within each block finds the
 * A:/Answer: marker to separate question from answer text.
 * Handles multi-line answers up to the next block or end of text.
 */
function extractStructuredPairs(text: string): QAPair[] {
  // Split on lines that start with Q: or Question: (case-insensitive)
  // Keep the delimiter by using a capturing group in the split
  // Only match Q:/Question: when followed by a colon (not inside table cells).
  // Require the marker to be at the start of a line, not preceded by a pipe.
  const markerPattern = /^(?:Q|Question)\s*:/im;
  if (!markerPattern.test(text)) return [];

  // Verify this is not actually a pipe-delimited table (tables use | delimiters)
  const firstQLine = text.split('\n').find((l) => markerPattern.test(l));
  if (firstQLine && firstQLine.trim().startsWith('|')) return [];

  // Split the text into blocks at each Q:/Question: marker
  const blocks = text.split(/^(?:Q|Question)\s*:\s*/im);

  const pairs: QAPair[] = [];

  // First element is text before the first Q: (usually empty), skip it
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block || block.trim().length === 0) continue;

    // Within the block, split on A:/Answer: to get question and answer.
    // The A: marker can appear either after a newline or at the very start
    // of the block (when the Q: line was empty and the split consumed whitespace).
    const answerSplit = block.split(/(?:^|\n)\s*(?:A|Answer)\s*:\s*/i);
    const question = answerSplit[0].trim();
    const answer = answerSplit.slice(1).join('\n').trim();

    // Skip pairs with empty questions (e.g. "Q: \nA: ")
    if (question.length === 0) continue;

    pairs.push({ question, answer });
  }

  return pairs;
}

/**
 * Extract pairs from a pipe-delimited table (e.g. Markdown tables).
 *
 * Expects rows like: | Question text | Answer text |
 * Skips header separator rows (e.g. |---|---|).
 */
function extractTablePairs(text: string): QAPair[] {
  const lines = text.split('\n').filter((l) => l.includes('|'));
  if (lines.length < 2) return [];

  const pairs: QAPair[] = [];
  for (const line of lines) {
    // Skip separator rows (e.g. |---|---|, |:---:|:---:|)
    if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) continue;

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length >= 2) {
      const question = cells[0];
      const answer = cells[1];

      // Skip header row (heuristic: if first cell is "Question" or "Q")
      if (/^(?:question|q)$/i.test(question)) continue;

      if (question.length > 0 && answer.length > 0) {
        pairs.push({ question, answer });
      }
    }
  }

  return pairs;
}

// ---------------------------------------------------------------------------
// String similarity — Dice coefficient (bigram overlap)
// ---------------------------------------------------------------------------

/**
 * Compute the Dice coefficient (bigram similarity) between two strings.
 *
 * Returns a value between 0 (completely different) and 1 (identical).
 * This is deterministic and does not require embeddings or AI.
 */
export function stringSimilarity(a: string, b: string): number {
  const normalise = (s: string) => s.toLowerCase().trim();
  const aN = normalise(a);
  const bN = normalise(b);

  if (aN === bN) return 1;
  if (aN.length < 2 || bN.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < aN.length - 1; i++) {
    const bigram = aN.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < bN.length - 1; i++) {
    const bigram = bN.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      bigramsA.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (aN.length - 1 + bN.length - 1);
}

// ---------------------------------------------------------------------------
// Diff algorithm
// ---------------------------------------------------------------------------

/**
 * Compare Q&A pairs from two document versions and produce a diff.
 *
 * Algorithm:
 *  1. Extract Q&A pairs from both documents.
 *  2. Exact match: identical question text -> 'unchanged' if answer identical,
 *     'modified' if answer different (similarity_score = 1.0).
 *  3. Similarity match: for remaining unmatched pairs, compute Dice coefficient
 *     on question text. Best match above threshold -> 'modified'.
 *  4. Remaining old pairs -> 'removed'.
 *  5. Remaining new pairs -> 'added'.
 *
 * Time complexity: O(n*m) where n = old pairs, m = new pairs.
 */
export function computeDocumentDiff(
  oldDocumentId: string,
  newDocumentId: string,
  oldText: string,
  newText: string,
  options?: {
    similarityThreshold?: number; // default: 0.8
  },
): DiffResult {
  const threshold = options?.similarityThreshold ?? 0.8;

  const oldPairs = extractQAPairs(oldText);
  const newPairs = extractQAPairs(newText);

  const entries: DiffEntry[] = [];

  // Track which new pairs have been matched
  const matchedNewIndices = new Set<number>();

  // Track which old pairs have been matched (for similarity pass)
  const unmatchedOldIndices: number[] = [];

  // ---- Pass 1: exact question match ----
  for (let oi = 0; oi < oldPairs.length; oi++) {
    const oldPair = oldPairs[oi];
    const oldQ = oldPair.question.toLowerCase().trim();

    let found = false;
    for (let ni = 0; ni < newPairs.length; ni++) {
      if (matchedNewIndices.has(ni)) continue;

      const newPair = newPairs[ni];
      const newQ = newPair.question.toLowerCase().trim();

      if (oldQ === newQ) {
        // Question identical — check answer
        if (oldPair.answer.trim() === newPair.answer.trim()) {
          entries.push({
            diff_type: 'unchanged',
            old_question: oldPair.question,
            old_content: oldPair.answer,
            new_question: newPair.question,
            new_content: newPair.answer,
            similarity_score: 1.0,
          });
        } else {
          entries.push({
            diff_type: 'modified',
            old_question: oldPair.question,
            old_content: oldPair.answer,
            new_question: newPair.question,
            new_content: newPair.answer,
            similarity_score: 1.0,
          });
        }

        matchedNewIndices.add(ni);
        found = true;
        break;
      }
    }

    if (!found) {
      unmatchedOldIndices.push(oi);
    }
  }

  // ---- Pass 2: similarity match on remaining pairs ----
  const stillUnmatchedOld: number[] = [];

  for (const oi of unmatchedOldIndices) {
    const oldPair = oldPairs[oi];
    let bestScore = 0;
    let bestNewIndex = -1;

    for (let ni = 0; ni < newPairs.length; ni++) {
      if (matchedNewIndices.has(ni)) continue;

      const score = stringSimilarity(oldPair.question, newPairs[ni].question);
      if (score > bestScore) {
        bestScore = score;
        bestNewIndex = ni;
      }
    }

    if (bestScore >= threshold && bestNewIndex >= 0) {
      const newPair = newPairs[bestNewIndex];
      entries.push({
        diff_type: 'modified',
        old_question: oldPair.question,
        old_content: oldPair.answer,
        new_question: newPair.question,
        new_content: newPair.answer,
        similarity_score: bestScore,
      });
      matchedNewIndices.add(bestNewIndex);
    } else {
      stillUnmatchedOld.push(oi);
    }
  }

  // ---- Pass 3: remaining old = removed, remaining new = added ----
  for (const oi of stillUnmatchedOld) {
    const oldPair = oldPairs[oi];
    entries.push({
      diff_type: 'removed',
      old_question: oldPair.question,
      old_content: oldPair.answer,
    });
  }

  for (let ni = 0; ni < newPairs.length; ni++) {
    if (matchedNewIndices.has(ni)) continue;
    const newPair = newPairs[ni];
    entries.push({
      diff_type: 'added',
      new_question: newPair.question,
      new_content: newPair.answer,
    });
  }

  // ---- Summary ----
  const summary = {
    added: entries.filter((e) => e.diff_type === 'added').length,
    removed: entries.filter((e) => e.diff_type === 'removed').length,
    modified: entries.filter((e) => e.diff_type === 'modified').length,
    unchanged: entries.filter((e) => e.diff_type === 'unchanged').length,
    total_old: oldPairs.length,
    total_new: newPairs.length,
  };

  return {
    old_document_id: oldDocumentId,
    new_document_id: newDocumentId,
    entries,
    summary,
  };
}
