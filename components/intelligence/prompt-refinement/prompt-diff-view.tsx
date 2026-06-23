'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { computeLineDiff, OP_CLASS, OP_PREFIX } from '@/lib/diff/line-diff';

/**
 * PromptDiffView — unified (not side-by-side) line diff for the current
 * active scoring prompt versus the proposed rewrite returned by the
 * analysis step.
 *
 * Implementation delegates to the shared LCS-based line-diff primitive in
 * lib/diff/line-diff.ts (ID-117 {117.7} — jscpd CMP-2 struck). Prompts are
 * typically 20–50 lines, so O(n·m) time is fine and a third-party diff
 * library would be overkill for line-level comparison.
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
