/**
 * `emit-dry-run.ts` — markdown emitter for the `wrap-define-route` codemod.
 *
 * Spec:
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md §5
 *     (diff preview format)
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/TECH.md §6.1
 *     (markdown report sections)
 *   - docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.12
 *
 * Scope (Subtask 32.12): produce `docs/generated/codemod-dry-run.md` —
 * human-readable per-route preview emitted on EVERY run (dry-run AND apply).
 *
 * Sections per TECH §6.1:
 *   1. Summary table — count by shape and mechanisability verdict.
 *   2. Proposed transformations — per MECHANISABLE route: shape, inferred
 *      schema source (A/B/C/placeholder), diff preview.
 *   3. NEEDS-REVIEW routes — list with reason per route.
 *   4. MANUAL routes — list with reason per route.
 *
 * 32.10 / 32.11 supply the full diff-preview body for each MECHANISABLE
 * route once those rewrite emitters land; 32.12 emits the section
 * scaffolding and renders whatever per-route metadata the discovery loop
 * has already collected. The scaffold-only contract is honoured for Subtask
 * 32.12 — the emitter MUST work on a record set that does NOT yet contain
 * pre-rewrite/post-rewrite text snippets.
 */

import { writeFileSync } from 'node:fs';
import type { NeedsManualReason, RouteShape } from './types';

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Per-route record consumed by the markdown emitter.
 *
 * `route` is the repo-relative POSIX path of the route file.
 * `shape` is the classifier verdict from `classifyRoute()`.
 * `methods` is the full set of HTTP method exports (from `getExportedMethods`).
 * `action` is the verdict the codemod will take in `--apply` mode:
 *   - `TRANSFORM`   — codemod will rewrite (MECHANISABLE).
 *   - `NEEDS_REVIEW` — codemod will wrap but human review is required.
 *   - `MANUAL`      — codemod will skip; human must rewrite.
 *   - `SKIPPED`     — already wrapped; idempotent no-op (32.13).
 * `reason` is the `NeedsManualReason` discriminator when `action` is
 *   `NEEDS_REVIEW` or `MANUAL`; absent for `TRANSFORM` / `SKIPPED`.
 * `schemaSource` is `'A' | 'B' | 'C' | 'PLACEHOLDER'` — surfaced by the
 *   inference path (Subtask 32.8 = A only; downstream Subtasks add B/C).
 *   Absent for shapes that bypass inference (MANUAL).
 * `schemaIdentifier` is the schema constant name when inference succeeded;
 *   `z.unknown()` when the inference falls back; absent for MANUAL shapes.
 * `notes` is free-text per-route narration (rewrite diff text from 32.10 /
 *   32.11, idempotency reason from 32.13, etc.); rendered verbatim as a
 *   blockquote under the route heading.
 */
export interface RouteReportEntry {
  route: string;
  shape: RouteShape;
  methods: string[];
  action: 'TRANSFORM' | 'NEEDS_REVIEW' | 'MANUAL' | 'SKIPPED';
  reason?: NeedsManualReason;
  schemaSource?: 'A' | 'B' | 'C' | 'PLACEHOLDER';
  schemaIdentifier?: string;
  notes?: string;
}

// ── Section builders ──────────────────────────────────────────────────────

/**
 * Summary table — count by shape and mechanisability verdict per TECH §6.1.
 *
 * Two columns: shape literal and route count. Mechanisability verdict is
 * encoded in the section heading (TRANSFORM / NEEDS_REVIEW / MANUAL /
 * SKIPPED), making the per-shape table a flat tally.
 */
function renderSummaryTable(entries: readonly RouteReportEntry[]): string {
  if (entries.length === 0) {
    return '_(no routes discovered — corpus is empty)_\n';
  }

  const totals = new Map<RouteShape, number>();
  const actions = new Map<RouteReportEntry['action'], number>();
  for (const entry of entries) {
    totals.set(entry.shape, (totals.get(entry.shape) ?? 0) + 1);
    actions.set(entry.action, (actions.get(entry.action) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push(`Total routes discovered: **${entries.length}**.\n`);
  lines.push('### Verdict tally\n');
  lines.push('| Verdict | Count |');
  lines.push('|---------|------:|');
  for (const action of [
    'TRANSFORM',
    'NEEDS_REVIEW',
    'MANUAL',
    'SKIPPED',
  ] as const) {
    const count = actions.get(action) ?? 0;
    lines.push(`| ${action} | ${count} |`);
  }
  lines.push('');
  lines.push('### Shape distribution\n');
  lines.push('| Shape | Count |');
  lines.push('|-------|------:|');
  // Stable lexicographic ordering — the actual corpus distribution is
  // skewed but the table reads as a tally so alphabetical wins on legibility.
  const sortedShapes = Array.from(totals.keys()).sort();
  for (const shape of sortedShapes) {
    lines.push(`| ${shape} | ${totals.get(shape)} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render the per-MECHANISABLE-route "Proposed transformations" section.
 *
 * Each entry shows the route, methods, shape, inferred-schema source +
 * identifier, and the verbatim `notes` block if present. Per PRODUCT §5,
 * the format models the diff-preview shape — 32.10 / 32.11 supply the
 * verbatim before/after snippets via `notes`.
 */
function renderTransformSection(entries: readonly RouteReportEntry[]): string {
  const transforms = entries.filter((e) => e.action === 'TRANSFORM');
  if (transforms.length === 0) {
    return '_(no MECHANISABLE routes — nothing to transform)_\n';
  }
  const lines: string[] = [];
  for (const entry of transforms) {
    lines.push(`#### \`${entry.route}\`\n`);
    lines.push(`- Methods: ${entry.methods.join(', ') || '(none)'}`);
    lines.push(`- Shape: \`${entry.shape}\``);
    if (entry.schemaIdentifier) {
      const source = entry.schemaSource ?? 'PLACEHOLDER';
      const sourceLabel =
        source === 'PLACEHOLDER'
          ? '[PLACEHOLDER — author schema before committing]'
          : `(Source ${source})`;
      lines.push(`- Schema: \`${entry.schemaIdentifier}\` ${sourceLabel}`);
    }
    if (entry.notes) {
      lines.push('');
      lines.push('```');
      lines.push(entry.notes);
      lines.push('```');
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Render the NEEDS-REVIEW or MANUAL list section.
 *
 * Each entry shows route, methods, shape, reason. `notes` (if present) is
 * appended as a fenced block — at Subtask 32.12 these sections are
 * tabular-style; 32.10 / 32.11 may attach per-route narration.
 */
function renderListSection(
  entries: readonly RouteReportEntry[],
  action: 'NEEDS_REVIEW' | 'MANUAL',
): string {
  const filtered = entries.filter((e) => e.action === action);
  if (filtered.length === 0) {
    const label = action === 'NEEDS_REVIEW' ? 'NEEDS-REVIEW' : 'MANUAL';
    return `_(no ${label} routes detected)_\n`;
  }
  const lines: string[] = [];
  lines.push('| Route | Methods | Shape | Reason |');
  lines.push('|-------|---------|-------|--------|');
  for (const entry of filtered) {
    const methods =
      entry.methods.length > 0 ? entry.methods.join(', ') : '(none)';
    const reason = entry.reason ?? '—';
    lines.push(
      `| \`${entry.route}\` | ${methods} | \`${entry.shape}\` | \`${reason}\` |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Render the SKIPPED list section per PRODUCT §4 idempotency.
 *
 * Distinct from NEEDS-REVIEW / MANUAL because skipped routes are
 * already-wrapped successes, not unhandled cases. 32.13's idempotency
 * detector feeds entries here.
 */
function renderSkippedSection(entries: readonly RouteReportEntry[]): string {
  const skipped = entries.filter((e) => e.action === 'SKIPPED');
  if (skipped.length === 0) {
    return '_(no SKIPPED routes — nothing already wrapped)_\n';
  }
  const lines: string[] = [];
  for (const entry of skipped) {
    const reason = entry.notes ? ` — ${entry.notes}` : '';
    lines.push(`- \`${entry.route}\` — SKIPPED (already wrapped)${reason}`);
  }
  return `${lines.join('\n')}\n`;
}

// ── Emitter ───────────────────────────────────────────────────────────────

export interface DryRunReportContext {
  /** `true` when invoked with `--apply`. Surfaces in the report header so
   *  the artefact carries the run mode that produced it. */
  apply: boolean;
  /** `--scope` filter if any was supplied. Surfaces in the report header. */
  scope?: string;
  /** ISO 8601 timestamp captured at emit time. Defaults to `new Date()`. */
  generatedAt?: string;
}

/**
 * Serialise the dry-run report without writing it to disk. Returned string
 * matches what `emitDryRunReport()` would have written.
 */
export function serialiseDryRunReport(
  entries: readonly RouteReportEntry[],
  context: DryRunReportContext,
): string {
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];
  lines.push('# Codemod dry-run report — `wrap-define-route`');
  lines.push('');
  lines.push(
    `Generated: ${generatedAt}. Mode: ${context.apply ? '`--apply`' : 'dry-run (default)'}` +
      `${context.scope ? `. Scope: \`${context.scope}\`` : ''}.`,
  );
  lines.push('');
  lines.push(
    'Spec: `docs/specs/id-16-ast-dataflow-tool/ops-t1-codemod/PRODUCT.md` §5 + `TECH.md` §6.1.',
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(renderSummaryTable(entries));
  lines.push('## Proposed transformations');
  lines.push('');
  lines.push(renderTransformSection(entries));
  lines.push('## NEEDS-REVIEW routes');
  lines.push('');
  lines.push(renderListSection(entries, 'NEEDS_REVIEW'));
  lines.push('## MANUAL routes');
  lines.push('');
  lines.push(renderListSection(entries, 'MANUAL'));
  lines.push('## Skipped (already wrapped)');
  lines.push('');
  lines.push(renderSkippedSection(entries));
  return `${lines.join('\n')}\n`;
}

/**
 * Emit the codemod-dry-run.md artefact.
 *
 * `entries` is the full per-route record set already assembled by the
 * discovery loop. No filtering or sorting is done here — callers are
 * responsible for deterministic ordering.
 */
export function emitDryRunReport(
  entries: readonly RouteReportEntry[],
  outputPath: string,
  context: DryRunReportContext,
): void {
  const payload = serialiseDryRunReport(entries, context);
  writeFileSync(outputPath, payload, 'utf8');
}
