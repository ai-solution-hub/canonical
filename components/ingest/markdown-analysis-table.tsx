'use client';

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  XCircle,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type {
  MarkdownIngestAnalysis,
  MarkdownPerFileOverride,
} from '@/types/ingest';

// ---------------------------------------------------------------------------
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §6.3 (table columns) +
//   §4.3 (per-row controls + auto-exclude triggers).
// Plan:  docs/plans/§1.11-ep2-build-plan.md row EP2-T5.
//
// Controlled component. Parent owns:
//   - `analyses`            — analyse-phase response from /api/ingest/markdown
//   - `overrides`           — per-row override map (filename → draft/skip/exc)
//   - `autoSupersede`       — batch-wide toggle (admin only)
//   - `role`                — caller's resolved app role; gates admin-only
//                             controls (`skip_dedup` checkbox per row +
//                             auto-supersede batch toggle)
//   - `onChange*`           — controlled callbacks
//
// Auto-exclude triggers (spec §4.3 lines 405-414):
//   - encodingOk=false      → AUTO-EXCLUDE
//   - empty=true            → AUTO-EXCLUDE
//   - frontMatter.parsedOk=false → warn-only (does NOT auto-exclude)
//   - diffMarkers.warning=true   → warn-only (does NOT auto-exclude)
//
// `<ExistingMatchBadge>` is INLINE in this file — `components/dedup/
// duplicate-match-card.tsx` does not yet exist on main (§1.7 has not shipped).
// ---------------------------------------------------------------------------

// Module-level stable empty defaults — avoid recreating per render (G14).
const EMPTY_OVERRIDES: MarkdownPerFileOverride[] = [];
const EMPTY_ANALYSES: MarkdownIngestAnalysis[] = [];

type DraftOrFinalChoice = 'draft' | 'final';
type Role = 'admin' | 'editor' | 'viewer';

export interface MarkdownAnalysisTableProps {
  /** Analyse-phase per-file records — drives one row each. */
  analyses: MarkdownIngestAnalysis[];
  /** Per-file override state held by parent. */
  overrides: MarkdownPerFileOverride[];
  /** Batch-wide auto-supersede toggle (admin only — visible only when admin). */
  autoSupersede: boolean;
  /** Caller's role — gates admin-only controls. */
  role: Role;
  /** Replace the override map (parent merges/replaces as needed). */
  onChangeOverrides: (overrides: MarkdownPerFileOverride[]) => void;
  /** Toggle the batch-wide auto-supersede flag. */
  onChangeAutoSupersede: (next: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a byte count to a short label ("12 KB", "123 B", "1.2 MB"). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Provenance label — spec §6.3 column 2. */
function provenanceLabel(
  p: MarkdownIngestAnalysis['titleProvenance'],
): string {
  switch (p) {
    case 'front-matter':
      return 'front-matter';
    case 'h1':
      return 'H1';
    case 'bold-after-article-n':
      return 'bold-after-Article-N';
    case 'filename':
      return 'filename';
  }
}

/** Compute auto-exclude flag for a row (spec §4.3 lines 405-414). */
function shouldAutoExclude(a: MarkdownIngestAnalysis): boolean {
  return !a.encodingOk || a.empty;
}

/** Derive the effective draft/final value (override > heuristic > 'draft'). */
function effectiveDraftFinal(
  a: MarkdownIngestAnalysis,
  override: MarkdownPerFileOverride | undefined,
): DraftOrFinalChoice {
  if (override?.draftOrFinal) return override.draftOrFinal;
  if (a.draftOrFinalHeuristic === 'unknown') return 'draft';
  return a.draftOrFinalHeuristic;
}

/** Lookup helper — find override for a filename, or undefined. */
function findOverride(
  overrides: MarkdownPerFileOverride[],
  filename: string,
): MarkdownPerFileOverride | undefined {
  return overrides.find((o) => o.filename === filename);
}

/** Replace (or insert) an override entry by filename. */
function upsertOverride(
  overrides: MarkdownPerFileOverride[],
  next: MarkdownPerFileOverride,
): MarkdownPerFileOverride[] {
  const idx = overrides.findIndex((o) => o.filename === next.filename);
  if (idx === -1) return [...overrides, next];
  const copy = overrides.slice();
  copy[idx] = { ...copy[idx], ...next };
  return copy;
}

// ---------------------------------------------------------------------------
// ExistingMatchBadge — inline sub-component
// ---------------------------------------------------------------------------
// Minimal badge rendering — replaced by `components/dedup/duplicate-match-
// card.tsx` once §1.7 ships. Keep semantic-token only.

interface ExistingMatchBadgeProps {
  dedupVerdict: MarkdownIngestAnalysis['dedupVerdict'];
  sourceFileMatch: MarkdownIngestAnalysis['sourceFileMatch'];
}

function ExistingMatchBadge({
  dedupVerdict,
  sourceFileMatch,
}: ExistingMatchBadgeProps) {
  if (dedupVerdict.isDuplicate && dedupVerdict.existingId) {
    const title = dedupVerdict.existingTitle ?? 'existing item';
    return (
      <a
        href={`/item/${dedupVerdict.existingId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded bg-status-warning/15 px-1.5 py-0.5 text-xs font-medium text-status-warning hover:underline"
      >
        <span aria-hidden="true">Hash match &rarr;</span>
        <span className="sr-only">Hash match: open</span>
        <span className="max-w-[12rem] truncate">{title}</span>
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }

  if (sourceFileMatch) {
    return (
      <a
        href={`/item/${sourceFileMatch.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground hover:underline"
      >
        <span aria-hidden="true">Filename match &rarr;</span>
        <span className="sr-only">Filename match: open</span>
        <span className="max-w-[12rem] truncate">{sourceFileMatch.title}</span>
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }

  return (
    <span className="text-xs text-muted-foreground" aria-label="No match">
      No match
    </span>
  );
}

// ---------------------------------------------------------------------------
// Front-matter status cell
// ---------------------------------------------------------------------------

function FrontMatterStatus({
  frontMatter,
}: {
  frontMatter: MarkdownIngestAnalysis['frontMatter'];
}) {
  if (!frontMatter.present) {
    return (
      <span className="text-xs text-muted-foreground">absent</span>
    );
  }
  if (!frontMatter.parsedOk) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-status-warning">
        <AlertTriangle className="size-3" aria-hidden="true" />
        malformed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-quality-good">
      <CheckCircle2 className="size-3" aria-hidden="true" />
      OK
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarkdownAnalysisTable({
  analyses,
  overrides,
  autoSupersede,
  role,
  onChangeOverrides,
  onChangeAutoSupersede,
}: MarkdownAnalysisTableProps) {
  // Stable empty fallback per G14.
  const safeOverrides = useMemo(
    () => overrides ?? EMPTY_OVERRIDES,
    [overrides],
  );
  const safeAnalyses = useMemo(
    () => analyses ?? EMPTY_ANALYSES,
    [analyses],
  );

  const isAdmin = role === 'admin';

  // Compute initial-effective excluded for each row, applying the
  // auto-exclude triggers when no explicit override is set.
  function effectiveExcluded(
    a: MarkdownIngestAnalysis,
    override: MarkdownPerFileOverride | undefined,
  ): boolean {
    if (override?.excluded !== undefined) return override.excluded;
    return shouldAutoExclude(a);
  }

  function handleToggleExcluded(
    a: MarkdownIngestAnalysis,
    next: boolean,
  ): void {
    const existing = findOverride(safeOverrides, a.filename);
    const merged: MarkdownPerFileOverride = {
      ...(existing ?? { filename: a.filename }),
      filename: a.filename,
      excluded: next,
    };
    onChangeOverrides(upsertOverride(safeOverrides, merged));
  }

  function handleChangeDraftFinal(
    a: MarkdownIngestAnalysis,
    next: DraftOrFinalChoice,
  ): void {
    const existing = findOverride(safeOverrides, a.filename);
    const merged: MarkdownPerFileOverride = {
      ...(existing ?? { filename: a.filename }),
      filename: a.filename,
      draftOrFinal: next,
    };
    onChangeOverrides(upsertOverride(safeOverrides, merged));
  }

  function handleToggleSkipDedup(
    a: MarkdownIngestAnalysis,
    next: boolean,
  ): void {
    const existing = findOverride(safeOverrides, a.filename);
    const merged: MarkdownPerFileOverride = {
      ...(existing ?? { filename: a.filename }),
      filename: a.filename,
      skipDedup: next,
    };
    onChangeOverrides(upsertOverride(safeOverrides, merged));
  }

  return (
    <div
      className="space-y-3"
      data-testid="markdown-analysis-table"
    >
      {/* Batch-wide controls (admin only) */}
      {isAdmin && (
        <div
          className="flex items-center justify-end gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
          data-testid="markdown-analysis-table-batch-controls"
        >
          <Checkbox
            id="markdown-batch-auto-supersede"
            checked={autoSupersede}
            onCheckedChange={(checked) =>
              onChangeAutoSupersede(checked === true)
            }
          />
          <label
            htmlFor="markdown-batch-auto-supersede"
            className="cursor-pointer text-sm text-foreground"
          >
            Auto-supersede on filename match
          </label>
          <span
            className="text-xs text-muted-foreground"
            aria-hidden="true"
          >
            (admin)
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Markdown batch analysis — per-file pre-flight results
          </caption>
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                File
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Title (from)
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Size
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Front matter
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Draft / Final
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Conflict markers
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Existing match
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Exclude
              </th>
              {isAdmin && (
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Skip dedup
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {safeAnalyses.map((a) => {
              const override = findOverride(safeOverrides, a.filename);
              const excluded = effectiveExcluded(a, override);
              const draftFinal = effectiveDraftFinal(a, override);
              const skipDedup = override?.skipDedup ?? false;
              const conflictCount = a.diffMarkers.gitConflictCount;
              const showDiffWarn = a.diffMarkers.warning;
              const fmParseError =
                a.frontMatter.present && !a.frontMatter.parsedOk;
              const autoExcluded =
                shouldAutoExclude(a) && override?.excluded === undefined;

              const rowTestId = `markdown-analysis-row-${a.filename}`;
              const excludeId = `exclude-${a.filename}`;
              const skipDedupId = `skip-dedup-${a.filename}`;

              return (
                <tr
                  key={a.filename}
                  data-testid={rowTestId}
                  className={cn(
                    'border-t border-border align-top',
                    excluded && 'bg-muted/30 text-muted-foreground',
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-1.5">
                      <FileText
                        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="break-all font-medium text-foreground">
                        {a.filename}
                      </span>
                    </div>
                    {a.error && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 text-xs text-destructive"
                        role="alert"
                      >
                        <XCircle className="size-3" aria-hidden="true" />
                        {a.error}
                      </p>
                    )}
                    {!a.encodingOk && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 text-xs text-destructive"
                        role="alert"
                      >
                        <XCircle className="size-3" aria-hidden="true" />
                        Not valid UTF-8
                      </p>
                    )}
                    {a.empty && a.encodingOk && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 text-xs text-status-warning"
                        role="alert"
                      >
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        File appears empty
                      </p>
                    )}
                    {showDiffWarn && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 text-xs text-status-warning"
                        role="alert"
                      >
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        Diff markers detected
                      </p>
                    )}
                    {fmParseError && (
                      <p
                        className="mt-1 inline-flex items-center gap-1 text-xs text-status-warning"
                        role="alert"
                      >
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        Front-matter could not be parsed
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-foreground">{a.title}</div>
                    <div className="text-xs text-muted-foreground">
                      from {provenanceLabel(a.titleProvenance)}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-foreground">
                    {formatBytes(a.sizeBytes)}
                  </td>
                  <td className="px-3 py-2">
                    <FrontMatterStatus frontMatter={a.frontMatter} />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={draftFinal}
                      onValueChange={(v: string) =>
                        handleChangeDraftFinal(a, v as DraftOrFinalChoice)
                      }
                      disabled={excluded}
                    >
                      <SelectTrigger
                        className="h-8 w-28 text-xs"
                        size="sm"
                        aria-label={`Draft or final for ${a.filename}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">draft</SelectItem>
                        <SelectItem value="final">final</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    {conflictCount === 0 ? (
                      <span className="text-xs text-muted-foreground">0</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-status-warning">
                        <AlertTriangle
                          className="size-3"
                          aria-hidden="true"
                        />
                        {conflictCount} conflict line
                        {conflictCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ExistingMatchBadge
                      dedupVerdict={a.dedupVerdict}
                      sourceFileMatch={a.sourceFileMatch}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={excludeId}
                        checked={excluded}
                        onCheckedChange={(checked) =>
                          handleToggleExcluded(a, checked === true)
                        }
                      />
                      <label
                        htmlFor={excludeId}
                        className="cursor-pointer text-xs text-muted-foreground"
                      >
                        {autoExcluded ? 'auto' : 'exclude'}
                      </label>
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={skipDedupId}
                          checked={skipDedup}
                          onCheckedChange={(checked) =>
                            handleToggleSkipDedup(a, checked === true)
                          }
                          disabled={excluded}
                        />
                        <label
                          htmlFor={skipDedupId}
                          className="cursor-pointer text-xs text-muted-foreground"
                        >
                          skip
                        </label>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
