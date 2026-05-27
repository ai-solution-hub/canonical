/**
 * backlog-schema.ts — Zod schema for the Backlog surface (TECH §3).
 *
 * Formalises `docs/reference/product-backlog.json` shape with Zod so the
 * schema is the canonical source of truth for allowed status values and field
 * shapes. The existing `backlog-no-closed-rows.test.ts` guard now sources its
 * allowed status enum from here rather than a hard-coded local constant.
 *
 * `BacklogStatus` is the Backlog subset of the shared `WorkStatus` master enum
 * from `lib/validation/work-status.ts` (per TECH §1.0). Canonical values:
 * `spec_needed | needs_research | parked | ready | blocked`
 *
 * Note: backlog items canonically use `spec_needed`. The legacy `needs_spec`
 * form was retrofitted in S52 WP3 (FU-NEW); the schema only accepts the
 * canonical form.
 *
 * Per PRODUCT.md inv 36–40, 42 + TECH §3 (kh-prod-readiness-S50 Wave A.1).
 */

import { z } from 'zod';
import { BacklogStatus, Priority } from '@/lib/validation/work-status';
import { DocLinkSchema } from '@/lib/validation/roadmap-schema';
import { BARE_ID_REGEX } from '@/lib/validation/schemas';
import {
  LEDGER_BUDGETS,
  DISCIPLINE_DOC,
} from '@/lib/validation/ledger-budgets';

// ──────────────────────────────────────────────────────────────────────────────
// Re-export surface-level status enum (consumers import from here, not from
// work-status.ts directly, per the per-surface re-export convention in TECH §1.0).
// ──────────────────────────────────────────────────────────────────────────────

export { BacklogStatus };

// ──────────────────────────────────────────────────────────────────────────────
// Backlog item type enum — values observed in the live data.
// ──────────────────────────────────────────────────────────────────────────────

export const BacklogItemType = z.enum([
  'feature',
  'bug',
  'research',
  'tech_debt',
  'infrastructure',
  'documentation',
  'testing',
  'ux',
]);
export type BacklogItemType = z.infer<typeof BacklogItemType>;

// ──────────────────────────────────────────────────────────────────────────────
// BacklogItemSchema — individual item shape.
//
// Required fields mirror the current product-backlog.json shape exactly.
// New optional fields (`details`, `testStrategy`) per PRODUCT inv 38 make items
// promotion-compatible with the Task list surface without a content reshape.
//
// Field notes:
// - `dependencies` (renamed from `depends_on` in S52 WP3 per FU-2).
// - `effort_estimate` is nullable — some items carry no estimate.
// - `notes` is nullable — most items have null notes.
// - `priority` uses the shared `Priority` master enum (all three Ranked values
//   `high | medium | low` appear in the live data; MoSCoW/Trigger values are
//   excluded in practice but the schema accepts the full master set for
//   forwards-compatibility with items promoted from the Task list).
// ──────────────────────────────────────────────────────────────────────────────

export const BacklogItemSchema = z.object({
  /** Item identifier — bare-digit canonical form after ID-15.4 migration (inv 37). */
  id: z
    .string()
    .regex(BARE_ID_REGEX, 'Backlog item id must be a bare digit string'),

  /** One-sentence summary of the work item. */
  description: z.string().min(1),

  /** Classification of the work item. */
  type: BacklogItemType,

  /**
   * Forward-looking status from the Backlog subset of WorkStatus.
   * Canonical values: spec_needed | needs_research | parked | ready | blocked.
   * The legacy `needs_spec` form is NOT accepted (retrofitted in S52 WP3
   * per FU-NEW).
   */
  status: BacklogStatus,

  /** Rough size estimate, nullable (e.g. `"2-3h"`, `"1-2 sessions"`). */
  effort_estimate: z.string().nullable(),

  /** Priority using the shared Priority master enum. */
  priority: Priority,

  /** Engineering track / theme for this item. */
  track: z.string().min(1),

  /**
   * Array of other backlog item ids this item depends on.
   * Renamed from `depends_on` to `dependencies` in S52 WP3 per FU-2
   * (aligns with the Taskmaster canonical field name).
   */
  dependencies: z.array(z.string()),

  /**
   * Session references for structured provenance (OQ-4 ratification).
   * Written by workflow-curator at item creation; direct-copy on promotion
   * to Task. Empty array when no session reference is known.
   */
  session_refs: z.array(z.string()),

  /**
   * Commit SHA references for structured provenance (OQ-4 ratification).
   * Empty array when no commit reference is known.
   */
  commit_refs: z.array(z.string()),

  /**
   * Cross-document links for structured provenance (OQ-4 ratification).
   * Mirrors the Roadmap + Task list shape using DocLinkSchema from
   * roadmap-schema.ts. Empty array when no cross-doc links are known.
   */
  cross_doc_links: z.array(DocLinkSchema),

  /** Optional prose notes, nullable. */
  notes: z.string().nullable(),

  /**
   * Within-priority deterministic ordering. Lower integer = higher rank.
   * Default null; pre-existing items omit. Schema does NOT enforce uniqueness
   * or contiguity within tier (PRODUCT inv 3). Curator skill maintains
   * discipline (Subtask 30.5 + P-OQ-3 auto-shift default). Per TECH §3.1
   * (Subtask 30.6).
   */
  rank: z.number().int().nullable().optional(),

  // ── New optional fields per PRODUCT inv 38 ──────────────────────────────

  /**
   * Markdown brief, populated when the item has been pre-thought beyond the
   * one-sentence description. Nullable — omit or set null when absent.
   * Makes items promotion-compatible with the Task list `Subtask.details`
   * convention (per inv 39).
   */
  details: z.string().nullable().optional(),

  /**
   * Prose acceptance statement. Nullable — omit or set null when absent.
   * Maps to `Subtask.testStrategy` on promotion (per inv 39).
   */
  testStrategy: z.string().nullable().optional(),
});

export type BacklogItem = z.infer<typeof BacklogItemSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// BacklogSchema — root document shape.
// ──────────────────────────────────────────────────────────────────────────────

export const BacklogSchema = z
  .object({
    /** Document identifier literal. */
    document_name: z.string().min(1),

    /** One-paragraph human-readable purpose. */
    document_purpose: z.string().min(1),

    /** Repo-relative paths to related documents. */
    related_documents: z.array(z.string()),

    /** Flat array of backlog items. */
    items: z.array(BacklogItemSchema),
  })
  .superRefine((doc, ctx) => {
    const ids = doc.items.map((item) => item.id);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      else seen.add(id);
    }
    if (duplicates.size > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: `Backlog items must have unique ids — duplicate id(s) found: ${[...duplicates].join(', ')}`,
      });
    }
  });

export type BacklogDocument = z.infer<typeof BacklogSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// parseBacklogWithWarnings — field-length budget warnings ({35.13})
//
// Mirrors `parseTaskListWithWarnings` / `parseRoadmapWithWarnings`. Surfaces a
// SOFT warning for any item field that exceeds its char budget in the unified
// registry (`lib/validation/ledger-budgets.ts`). NOT a schema rejection — no
// `.max()` is added, so the live ledger keeps parsing and the vendored schema
// shape is unchanged (RESEARCH §2.3/§7). The CLI write-time pre-check ({35.17})
// is the prevent-at-source gate; this helper is the read-side advisory.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A warning raised by `parseBacklogWithWarnings` when an item field exceeds its
 * char budget. `itemId` scopes the warning to the offending item.
 */
export interface BacklogWarning {
  itemId: string;
  message: string;
}

/**
 * Parse a Backlog document and surface soft field-length warnings sourced from
 * the unified budget registry. Throws `ZodError` on hard validation failure
 * (same behaviour as `BacklogSchema.parse()`). On success, returns the parsed
 * document plus a `warnings` array — empty when every item is within budget.
 */
export function parseBacklogWithWarnings(input: unknown): {
  value: BacklogDocument;
  warnings: BacklogWarning[];
} {
  const value = BacklogSchema.parse(input);
  const warnings: BacklogWarning[] = [];

  for (const item of value.items) {
    if (item.description.length > LEDGER_BUDGETS.item.description) {
      warnings.push({
        itemId: item.id,
        message:
          `Backlog item "${item.id}" description is ${item.description.length} chars ` +
          `(budget ${LEDGER_BUDGETS.item.description}). Keep it a one-sentence summary; ` +
          `move detail to a spec/research doc and reference via cross_doc_links ` +
          `(see ${DISCIPLINE_DOC}).`,
      });
    }
  }

  return { value, warnings };
}
