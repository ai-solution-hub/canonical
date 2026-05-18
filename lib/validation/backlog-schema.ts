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

// ──────────────────────────────────────────────────────────────────────────────
// Re-export surface-level status enum (consumers import from here, not from
// work-status.ts directly, per the per-surface re-export convention in TECH §1.0).
// ──────────────────────────────────────────────────────────────────────────────

export { BacklogStatus };
export type BacklogStatus = z.infer<typeof BacklogStatus>;

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
  /** Item identifier — existing ids (e.g. `C2-PA5`) must not change (inv 37). */
  id: z.string().min(1),

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

  /** How this item was surfaced (e.g. `"Design critique audit"`). */
  surfaced: z.string().min(1),

  /** Optional prose notes, nullable. */
  notes: z.string().nullable(),

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

export const BacklogSchema = z.object({
  /** Document identifier literal. */
  document_name: z.string().min(1),

  /** One-paragraph human-readable purpose. */
  document_purpose: z.string().min(1),

  /** Freetext one-liner matching the Roadmap convention. */
  last_updated: z.string().min(1),

  /** Repo-relative paths to related documents. */
  related_documents: z.array(z.string()),

  /** Flat array of backlog items. */
  items: z.array(BacklogItemSchema),
});

export type BacklogDocument = z.infer<typeof BacklogSchema>;
