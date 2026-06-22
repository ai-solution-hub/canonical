/**
 * line-diff — shared LCS-based line-diff primitive (ID-117 {117.7}, cluster C+D, CMP-2).
 *
 * Extracted from the verbatim-duplicate definitions that lived in both
 *   components/item-detail/revision-diff-view.tsx (buildLcsTable@70, computeLineDiff@94,
 *   OP_CLASS@139, OP_PREFIX@146) and
 *   components/intelligence/prompt-refinement/prompt-diff-view.tsx (buildLcsTable@40,
 *   computeLineDiff@65, OP_CLASS@117, OP_PREFIX@123).
 *
 * Both callers now import from this module. The extracted logic is byte-identical to
 * the revision-diff-view.tsx source (which is itself byte-identical to prompt-diff-view.tsx
 * in the LCS core; reconciled to the revision-diff-view.tsx copies which use OP_CLASS
 * semantic tokens bg-status-success/10 + bg-status-error/10 — matching Warm Meridian).
 *
 * This module performs no I/O, no DB access, and no diff-storage write. It is a pure
 * computation module (INV-3: diffs are computed on demand, never stored).
 *
 * jscpd CMP-2 is STRUCK by this extraction (ID-117 is the single owner of lib/diff/).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The three diff operations a line can carry. */
export type DiffOp = 'add' | 'remove' | 'context';

/** A single diffed line with its op annotation. */
export interface DiffLine {
  op: DiffOp;
  text: string;
}

// ---------------------------------------------------------------------------
// LCS primitive
// ---------------------------------------------------------------------------

/**
 * Compute the LCS table (lengths) for two line arrays.
 *
 * Standard O(n·m) DP. Revision bodies are modest, so this is comfortably
 * fast for the v1 minimal view and avoids pulling in a diff dependency for
 * the line-level comparison.
 */
export function buildLcsTable(
  a: readonly string[],
  b: readonly string[],
): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }
  return table;
}

/**
 * Walk the LCS table back-to-front to produce ordered diff ops.
 *
 * Ties prefer `remove` before `add` so removals appear before their
 * replacements — matches `git diff` intuition.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  if (oldText === newText) {
    return oldText
      .split('\n')
      .map((text) => ({ op: 'context' as const, text }));
  }
  if (oldText.length === 0) {
    return newText.split('\n').map((text) => ({ op: 'add' as const, text }));
  }
  if (newText.length === 0) {
    return oldText.split('\n').map((text) => ({ op: 'remove' as const, text }));
  }

  const a = oldText.split('\n');
  const b = newText.split('\n');
  const table = buildLcsTable(a, b);

  const out: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ op: 'context', text: a[i - 1] });
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      out.push({ op: 'remove', text: a[i - 1] });
      i--;
    } else {
      out.push({ op: 'add', text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    out.push({ op: 'remove', text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ op: 'add', text: b[j - 1] });
    j--;
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Presentation constants (shared across all diff render modes)
// ---------------------------------------------------------------------------

/**
 * Semantic-token classes per op — teal for additions, rose for removals.
 * Uses ONLY bg-status-* Warm Meridian tokens; no raw Tailwind colours (INV-13).
 */
export const OP_CLASS: Record<DiffOp, string> = {
  add: 'bg-status-success/10 text-status-success',
  remove: 'bg-status-error/10 text-status-error line-through',
  context: 'text-muted-foreground',
};

/**
 * Non-colour gutter marker so meaning never depends on hue (WCAG 2.1 AA).
 * INV-13: more-than-colour signalling is a presentation invariant for all depths.
 */
export const OP_PREFIX: Record<DiffOp, string> = {
  add: '[+]',
  remove: '[-]',
  context: '   ',
};
