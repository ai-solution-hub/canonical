/**
 * `emit-needs-manual.ts` — JSON emitter for the `wrap-define-route` codemod.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md §6.2
 *     (NeedsManualEntry / NeedsManualReason schema)
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-4
 *     (both artefacts produced in every run)
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PLAN.md §4 Subtask 32.12
 *
 * Scope (Subtask 32.12): produce `docs/generated/codemod-needs-manual.json`
 * containing every MANUAL + NEEDS-REVIEW route + every NEEDS_SCHEMA fall-back
 * (the latter surfaced by Source A inference from Subtask 32.8 once 32.10 /
 * 32.11 wire the rewrite loop). Idempotency-SKIPPED routes (32.13) are NOT
 * emitted to this artefact per PRODUCT §4.
 *
 * Output is a JSON array (`.json` file extension; TECH §6.2 prose
 * "JSONL (one object per route)" describes the logical record-per-route
 * shape, not the file format — the file extension is the source of truth).
 *
 * Tests do not write to `docs/generated/` — they redirect emission via the
 * `outputPath` parameter to a `tmpdir()` location.
 */

import { writeFileSync } from 'node:fs';
import type { NeedsManualReason, RouteShape } from './types';

// ── Public types ──────────────────────────────────────────────────────────

/**
 * One record per emitted route (TECH §6.2).
 *
 * `route` is the repo-relative POSIX path of the route file
 * (e.g. `app/api/cron/process-queue/route.ts`).
 *
 * `shape` is the `RouteShape` literal returned by `classifyRoute()` from
 * `wrap-define-route.ts`; serialised verbatim so downstream consumers can
 * cross-reference the route-shape-inventory.md taxonomy.
 *
 * `reason` is the canonical `NeedsManualReason` discriminator. Mapping from
 * shape → reason follows PRODUCT §6 + TECH §6.2:
 *
 *   - `CRON`                          → `CRON_AUTH_MODEL`
 *   - `NAKED_NO_AUTH`                 → `NAKED_NO_AUTH`
 *   - `MCP`                           → `MCP_TRANSPORT`
 *   - `MULTI_*` (incl. `+WRC`)        → `MULTI_METHOD_SCHEMA`
 *   - `*+WRC` (single-method only)    → `WRC_COMPOSITION`
 *   - any MECHANISABLE shape where
 *     inference falls back to z.unknown() → `NEEDS_SCHEMA`
 *
 * `methods` is set for multi-method shapes (the brief says "for multi-method
 * routes, the affected methods"); omitted for single-method shapes.
 */
export interface NeedsManualEntry {
  route: string;
  shape: RouteShape;
  reason: NeedsManualReason;
  methods?: string[];
}

// ── Reason mapping ────────────────────────────────────────────────────────

/**
 * Shape → reason vocabulary mapping per PRODUCT §6 + TECH §6.2.
 *
 * Multi-method shapes (with or without +WRC) carry the `MULTI_METHOD_SCHEMA`
 * reason because each exported method needs its own ResponseSchema (per
 * Subtask 32.11) — the multi-method discriminator subsumes the `+WRC` one.
 *
 * Single-method `+WRC` shapes carry the `WRC_COMPOSITION` reason — the codemod
 * does rewrite these, but the developer must confirm the outer-wrap order
 * before merging (PRODUCT §6.2 "withRequestContext sub-variant").
 *
 * `NEEDS_SCHEMA` is NOT in this map because the discriminator is the
 * inference outcome, not the shape — Source A's fall-back path
 * (`inference-source-a.ts`) surfaces the reason explicitly. The discovery
 * loop in `wrap-define-route.ts` consumes both the shape mapping AND any
 * inference-time NEEDS_SCHEMA reason, then synthesises one `NeedsManualEntry`
 * per affected route+method.
 *
 * Returns `null` for MECHANISABLE single-method shapes that do not carry
 * `+WRC` — these are wrapped cleanly by the codemod and do not need a
 * needs-manual entry (unless inference falls back, in which case the caller
 * supplies `NEEDS_SCHEMA` directly).
 */
export function reasonForShape(shape: RouteShape): NeedsManualReason | null {
  // MANUAL shapes (PRODUCT §6.1)
  if (shape === 'CRON') return 'CRON_AUTH_MODEL';
  if (shape === 'NAKED_NO_AUTH') return 'NAKED_NO_AUTH';
  if (shape === 'MCP') return 'MCP_TRANSPORT';
  // Unknown outer wrapper (S262 fix B1) — the codemod cannot safely transform
  // an `export const METHOD = <unrecognisedCall>(...)` outer wrapper, so the
  // route is skipped during apply and flagged for manual migration.
  if (shape === 'UNKNOWN_WRAPPER') return 'UNKNOWN_WRAPPER';
  // Multi-method shapes (PRODUCT §6.2) — both with and without +WRC carry the
  // same reason because the multi-method concern dominates.
  if (shape.startsWith('MULTI_')) return 'MULTI_METHOD_SCHEMA';
  // Single-method +WRC shapes (PRODUCT §6.2 withRequestContext sub-variant) —
  // only the non-MULTI variants land here because the multi-method branch
  // matched first above.
  if (shape.endsWith('+WRC')) return 'WRC_COMPOSITION';
  // MECHANISABLE single-method shapes (no +WRC) have no shape-derived reason;
  // the caller may still emit a NEEDS_SCHEMA entry derived from inference.
  return null;
}

// ── Emitter ───────────────────────────────────────────────────────────────

/**
 * Emit the codemod-needs-manual.json artefact.
 *
 * `entries` is the full record set already assembled by the discovery loop
 * — this function does no filtering, sorting, or de-duplication. Callers
 * are responsible for the upstream shape (one entry per (route, reason)
 * pair, deterministic ordering, etc.).
 *
 * Output format: pretty-printed JSON array with 2-space indentation and a
 * trailing newline. The pretty-print keeps git-diff noise low when the
 * artefact is committed for snapshot review (Subtask 32.12 leaves the
 * artefact uncommitted by default; downstream tooling may opt in).
 */
export function emitNeedsManualReport(
  entries: NeedsManualEntry[],
  outputPath: string,
): void {
  const payload = `${JSON.stringify(entries, null, 2)}\n`;
  writeFileSync(outputPath, payload, 'utf8');
}

/**
 * Serialise the report without writing it to disk. Returned string matches
 * what `emitNeedsManualReport()` would have written (same indentation,
 * trailing newline). Useful for in-process round-trip tests.
 */
export function serialiseNeedsManualReport(
  entries: NeedsManualEntry[],
): string {
  return `${JSON.stringify(entries, null, 2)}\n`;
}
