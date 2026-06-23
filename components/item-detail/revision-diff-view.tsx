'use client';

import { useMemo } from 'react';
import { diffWords } from 'diff';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { computeLineDiff, OP_CLASS, OP_PREFIX } from '@/lib/diff/line-diff';
import type { RenderMode } from '@/lib/diff/unified-revision';

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
 * ID-117 {117.7}: LCS primitive extracted to lib/diff/line-diff.ts (CMP-2
 * struck). New renderMode prop added — default 'unified-line' preserves
 * byte-identical output for the two existing callers (INV-12). Additional
 * modes: 'side-by-side' (old↔new columns) and 'word-inline' (diffWords spans).
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
  /**
   * Render strategy for the diff pane.
   *
   * - `'unified-line'` (default) — single-column unified line diff using the
   *   LCS primitive. Output is byte-identical to the pre-117.7 behaviour so
   *   the two existing callers (CompareVersionsPanel, QARevisionHistory) need
   *   no change (INV-12 regression gate).
   * - `'side-by-side'` — old text in the left column, new text in the right
   *   column, each with OP_CLASS semantic tokens and OP_PREFIX gutters (INV-10/13).
   * - `'word-inline'` — unified view with word-level highlighting via diffWords
   *   from the `diff` package (INV-10/11). Line-level context rows remain; only
   *   changed lines are highlighted at the word level.
   */
  renderMode?: RenderMode;
  className?: string;
}

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

// ---------------------------------------------------------------------------
// Render-mode sub-components
// ---------------------------------------------------------------------------

/**
 * Unified line diff — the default mode (INV-12: byte-identical to pre-117.7).
 * Uses OP_CLASS semantic tokens and OP_PREFIX non-colour gutters (INV-13).
 */
function UnifiedLineDiff({
  older,
  newer,
}: {
  older: RevisionBlob;
  newer: RevisionBlob;
}) {
  const lines = useMemo(
    () => computeLineDiff(older.text, newer.text),
    [older.text, newer.text],
  );

  const hasChanges = useMemo(
    () => lines.some((line) => line.op !== 'context'),
    [lines],
  );

  if (!hasChanges) {
    return (
      <p
        className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        data-testid="revision-diff-empty"
      >
        No changes between these versions.
      </p>
    );
  }

  return (
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
  );
}

/**
 * Side-by-side mode — old text in the left column, new text in the right column.
 * Both columns use OP_CLASS semantic tokens and OP_PREFIX non-colour gutters (INV-13).
 */
function SideBySideDiff({
  older,
  newer,
}: {
  older: RevisionBlob;
  newer: RevisionBlob;
}) {
  const lines = useMemo(
    () => computeLineDiff(older.text, newer.text),
    [older.text, newer.text],
  );

  const hasChanges = useMemo(
    () => lines.some((line) => line.op !== 'context'),
    [lines],
  );

  if (!hasChanges) {
    return (
      <p
        className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        data-testid="revision-diff-empty"
      >
        No changes between these versions.
      </p>
    );
  }

  // Partition into old (remove + context) and new (add + context) columns
  const oldLines = lines.filter((l) => l.op === 'remove' || l.op === 'context');
  const newLines = lines.filter((l) => l.op === 'add' || l.op === 'context');

  return (
    <div className="flex gap-2">
      <div className="flex-1 min-w-0">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Older version
        </p>
        <pre
          data-testid="side-by-side-old"
          aria-label="Older revision text"
          className="overflow-x-auto rounded-md border bg-card p-3 font-mono text-xs leading-relaxed"
        >
          {oldLines.map((line, idx) => (
            <div
              key={`old-${idx}-${line.op}`}
              className={cn('flex gap-2 px-1', OP_CLASS[line.op])}
            >
              <span aria-hidden="true" className="select-none">
                {OP_PREFIX[line.op]}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {line.op === 'remove' ? `[Removed] ${line.text}` : line.text}
              </span>
            </div>
          ))}
        </pre>
      </div>
      <div className="flex-1 min-w-0">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Newer version
        </p>
        <pre
          data-testid="side-by-side-new"
          aria-label="Newer revision text"
          className="overflow-x-auto rounded-md border bg-card p-3 font-mono text-xs leading-relaxed"
        >
          {newLines.map((line, idx) => (
            <div
              key={`new-${idx}-${line.op}`}
              className={cn('flex gap-2 px-1', OP_CLASS[line.op])}
            >
              <span aria-hidden="true" className="select-none">
                {OP_PREFIX[line.op]}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {line.op === 'add' ? `[Added] ${line.text}` : line.text}
              </span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/**
 * Word-inline mode — unified view with word-level diffWords highlighting.
 * Changed lines show inline word spans using OP_CLASS semantic tokens (INV-10/13).
 * Unchanged lines render as context using the same LCS partitioning.
 */
function WordInlineDiff({
  older,
  newer,
}: {
  older: RevisionBlob;
  newer: RevisionBlob;
}) {
  const lines = useMemo(
    () => computeLineDiff(older.text, newer.text),
    [older.text, newer.text],
  );

  const hasChanges = useMemo(
    () => lines.some((line) => line.op !== 'context'),
    [lines],
  );

  if (!hasChanges) {
    return (
      <p
        className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
        data-testid="revision-diff-empty"
      >
        No changes between these versions.
      </p>
    );
  }

  // For word-inline we pair up adjacent remove+add sequences so we can run
  // diffWords across the pair. Context lines render as-is.
  //
  // Strategy: walk the lines in order; when we encounter a remove immediately
  // followed by an add, use diffWords for word-level highlighting across that
  // pair. Standalone removes or adds get the standard OP_CLASS treatment.
  const rendered: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (
      line.op === 'remove' &&
      i + 1 < lines.length &&
      lines[i + 1].op === 'add'
    ) {
      // Paired remove+add — run diffWords for word-level highlighting
      const oldLine = line.text;
      const newLine = lines[i + 1].text;
      const wordParts = diffWords(oldLine, newLine);

      rendered.push(
        <div
          key={`word-remove-${i}`}
          className={cn('flex gap-2 px-1', OP_CLASS.remove)}
        >
          <span aria-hidden="true" className="select-none">
            {OP_PREFIX.remove}
          </span>
          <span className="whitespace-pre-wrap break-words">
            {wordParts.map((part, pi) =>
              part.removed ? (
                <mark
                  key={pi}
                  className="bg-status-error/20 text-status-error rounded px-0.5"
                >
                  {part.value}
                </mark>
              ) : !part.added ? (
                <span key={pi}>{part.value}</span>
              ) : null,
            )}
          </span>
        </div>,
      );

      rendered.push(
        <div
          key={`word-add-${i}`}
          className={cn('flex gap-2 px-1', OP_CLASS.add)}
        >
          <span aria-hidden="true" className="select-none">
            {OP_PREFIX.add}
          </span>
          <span className="whitespace-pre-wrap break-words">
            {wordParts.map((part, pi) =>
              part.added ? (
                <mark
                  key={pi}
                  className="bg-status-success/20 text-status-success rounded px-0.5"
                >
                  {part.value}
                </mark>
              ) : !part.removed ? (
                <span key={pi}>{part.value}</span>
              ) : null,
            )}
          </span>
        </div>,
      );

      i += 2;
    } else {
      // Context, standalone remove, or standalone add
      rendered.push(
        <div
          key={`${i}-${line.op}`}
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
        </div>,
      );
      i++;
    }
  }

  return (
    <pre
      role="log"
      aria-label="Revision text diff"
      className="overflow-x-auto rounded-md border bg-card p-3 font-mono text-xs leading-relaxed"
    >
      {rendered}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function RevisionDiffView({
  older,
  newer,
  renderMode = 'unified-line',
  className,
}: RevisionDiffViewProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <RevisionMeta revision={older} sideLabel="Older" />
        <RevisionMeta revision={newer} sideLabel="Newer" />
      </div>

      {renderMode === 'side-by-side' ? (
        <SideBySideDiff older={older} newer={newer} />
      ) : renderMode === 'word-inline' ? (
        <WordInlineDiff older={older} newer={newer} />
      ) : (
        <UnifiedLineDiff older={older} newer={newer} />
      )}
    </div>
  );
}
