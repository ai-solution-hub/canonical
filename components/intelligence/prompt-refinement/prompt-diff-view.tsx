'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * PromptDiffView — unified (not side-by-side) line diff for the current
 * active scoring prompt versus the proposed rewrite returned by the
 * analysis step.
 *
 * Implementation is a minimal LCS-based line diff. Prompts are typically
 * 20–50 lines, so O(n·m) time is fine and a third-party diff library
 * would be overkill.
 *
 * Accessibility: colour is never the sole signal of meaning. Added lines
 * are prefixed with `[+]` and removed lines with `[-]`. The whole block
 * is announced as a log region so assistive tech users can browse it
 * linearly.
 */

interface PromptDiffViewProps {
  currentText: string;
  proposedText: string;
}

type DiffOp = 'add' | 'remove' | 'context';

interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Compute the LCS table (lengths) for two line arrays.
 *
 * Standard DP — `table[i][j]` is the length of the longest common
 * subsequence of `a[0..i)` and `b[0..j)`. Pure function, easy to test
 * in isolation if needed.
 */
function buildLcsTable(a: readonly string[], b: readonly string[]): number[][] {
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
 * Walk the LCS table back-to-front to produce the ordered diff ops.
 *
 * Ties prefer `remove` before `add` so removals appear before their
 * replacements in the unified output — matches developer intuition
 * from tools like `git diff`.
 */
function computeLineDiff(
  currentText: string,
  proposedText: string,
): DiffLine[] {
  // Edge cases — skip LCS for the trivial paths.
  if (currentText === proposedText) {
    return currentText
      .split('\n')
      .map((text) => ({ op: 'context' as const, text }));
  }
  if (currentText.length === 0) {
    return proposedText
      .split('\n')
      .map((text) => ({ op: 'add' as const, text }));
  }
  if (proposedText.length === 0) {
    return currentText
      .split('\n')
      .map((text) => ({ op: 'remove' as const, text }));
  }

  const a = currentText.split('\n');
  const b = proposedText.split('\n');
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

const OP_CLASS: Record<DiffOp, string> = {
  add: 'bg-status-success/10 text-status-success',
  remove: 'bg-status-error/10 text-status-error line-through',
  context: 'text-muted-foreground',
};

const OP_PREFIX: Record<DiffOp, string> = {
  add: '[+]',
  remove: '[-]',
  context: '   ',
};

export function PromptDiffView({
  currentText,
  proposedText,
}: PromptDiffViewProps) {
  const lines = useMemo(
    () => computeLineDiff(currentText, proposedText),
    [currentText, proposedText],
  );

  const hasChanges = useMemo(
    () => lines.some((line) => line.op !== 'context'),
    [lines],
  );

  if (!hasChanges) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="diff-empty">
        No differences between the active prompt and the proposed prompt.
      </p>
    );
  }

  return (
    <pre
      role="log"
      aria-label="Prompt text diff"
      className="overflow-x-auto rounded-md border bg-card p-3 font-mono text-xs leading-relaxed"
    >
      {lines.map((line, idx) => (
        <div
          key={`${idx}-${line.op}`}
          className={cn('flex gap-2 px-1', OP_CLASS[line.op])}
        >
          <span aria-hidden="true" className="select-none">
            {OP_PREFIX[line.op]}
          </span>
          <span className="whitespace-pre-wrap break-words">
            {line.op === 'add' ? `[Added] ${line.text}` : null}
            {line.op === 'remove' ? `[Removed] ${line.text}` : null}
            {line.op === 'context' ? line.text : null}
          </span>
        </div>
      ))}
    </pre>
  );
}
