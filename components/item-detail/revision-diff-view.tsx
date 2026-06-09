'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * RevisionDiffView — v1 MINIMAL user-edit Diff-UI (ID-59 {59.12}).
 *
 * Renders a unified (not side-by-side) line diff of the changed text between
 * two arbitrary revision blobs, plus each revision's metadata panel. It is
 * deliberately source-agnostic: callers pass two `RevisionBlob`s derived from
 * either `content_history` or `q_a_pair_history` rows, so the same component
 * serves both substrates (PC-14/15/16/17, INV-14..INV-17).
 *
 * Diff is computed client-side over the two text blobs — there is NO diff
 * table. The component never reads `source_document_diffs` (INV-17 leaves
 * that in its re-ingest role; bl-267 doc-diff re-point is a separate slice).
 *
 * Accessibility (INV-16): colour is never the sole signal. Added lines are
 * prefixed with a `[+]` gutter and an `[Added]` label, removed lines with
 * `[-]` and `[Removed]`. The diff block is announced as a log region so
 * assistive tech can browse it linearly. Identical revisions render an
 * explicit "no changes" state, never a blank panel.
 *
 * Richer side-by-side markdown + inline word-level highlighting is v1.1
 * (OQ-59-4) and intentionally out of scope here.
 */

/** A single revision, normalised from a content_history / q_a_pair_history row. */
export interface RevisionBlob {
  /** Monotonic version number for this revision. */
  version: number;
  /** The text body being diffed (content body, or Q&A answer). */
  text: string;
  /** Change type — e.g. 'edit', 'ai_update', 'create'. */
  changeType: string;
  /** Human-authored change summary, if any. */
  changeSummary: string | null;
  /** ISO 8601 timestamp the revision was created. */
  createdAt: string;
  /** Resolved display name of the author (or 'System' / 'Unknown'). */
  createdByLabel: string;
  /** The new structured edit-intent classification ({59.5}), if recorded. */
  editIntent: string | null;
}

interface RevisionDiffViewProps {
  /** The earlier of the two revisions (rendered as removals / old side). */
  older: RevisionBlob;
  /** The later of the two revisions (rendered as additions / new side). */
  newer: RevisionBlob;
  className?: string;
}

type DiffOp = 'add' | 'remove' | 'context';

interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Compute the LCS table (lengths) for two line arrays.
 *
 * Standard O(n·m) DP. Revision bodies are modest, so this is comfortably
 * fast for the v1 minimal view and avoids pulling in a diff dependency for
 * the line-level comparison.
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
 * Walk the LCS table back-to-front to produce ordered diff ops.
 *
 * Ties prefer `remove` before `add` so removals appear before their
 * replacements — matches `git diff` intuition.
 */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
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

/** Semantic-token classes per op — teal for additions, rose for removals. */
const OP_CLASS: Record<DiffOp, string> = {
  add: 'bg-status-success/10 text-status-success',
  remove: 'bg-status-error/10 text-status-error line-through',
  context: 'text-muted-foreground',
};

/** Non-colour gutter marker so meaning never depends on hue (WCAG 2.1 AA). */
const OP_PREFIX: Record<DiffOp, string> = {
  add: '[+]',
  remove: '[-]',
  context: '   ',
};

function changeTypeLabel(type: string): string {
  switch (type) {
    case 'create':
      return 'Created';
    case 'edit':
      return 'Edited';
    case 'ai_update':
      return 'Auto update';
    case 'import':
      return 'Imported';
    case 'merge':
      return 'Merged';
    case 'rollback':
      return 'Rollback';
    default:
      return type;
  }
}

/** UK English date — DD/MM/YYYY HH:mm. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Metadata panel for a single revision. */
function RevisionMeta({
  revision,
  sideLabel,
}: {
  revision: RevisionBlob;
  sideLabel: string;
}) {
  const {
    version,
    changeType,
    changeSummary,
    createdAt,
    createdByLabel,
    editIntent,
  } = revision;
  return (
    <div className="flex-1 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {sideLabel}
        </span>
        <Badge variant="outline" className="text-[10px]">
          v{version}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          {changeTypeLabel(changeType)}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-foreground">
        {changeSummary ?? 'No description'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {createdByLabel} <span aria-hidden="true">&middot;</span>{' '}
        {formatDateTime(createdAt)}
      </p>
      {editIntent ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Edit intent:</span>{' '}
          {editIntent}
        </p>
      ) : null}
    </div>
  );
}

export function RevisionDiffView({
  older,
  newer,
  className,
}: RevisionDiffViewProps) {
  const lines = useMemo(
    () => computeLineDiff(older.text, newer.text),
    [older.text, newer.text],
  );

  const hasChanges = useMemo(
    () => lines.some((line) => line.op !== 'context'),
    [lines],
  );

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <RevisionMeta revision={older} sideLabel="Older" />
        <RevisionMeta revision={newer} sideLabel="Newer" />
      </div>

      {hasChanges ? (
        <pre
          role="log"
          aria-label="Revision text diff"
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
      ) : (
        <p
          className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
          data-testid="revision-diff-empty"
        >
          No changes between these versions.
        </p>
      )}
    </div>
  );
}
