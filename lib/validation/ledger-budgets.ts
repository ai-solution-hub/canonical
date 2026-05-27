/**
 * ledger-budgets.ts — unified char-budget registry for all THREE workflow
 * ledgers (task-list, roadmap, backlog). Ledger-CLI v2 {35.13}.
 *
 * Single source of truth mapping `(recordKind → field → char budget)`, where
 * `recordKind` is one of `task | subtask | theme | item`. Consumed by:
 *   - the three `parse*WithWarnings` helpers (task-list / roadmap / backlog),
 *     which emit a SOFT warning for an over-budget field;
 *   - the ledger-CLI v2 write-time budget pre-check (RESEARCH §2.3), which
 *     REJECTS an over-budget write at source unless `--force`;
 *   - the `schema` / `--help` discoverability surface.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CRITICAL — this is PLAIN DATA, never a Zod `.max()` constraint.
 * ──────────────────────────────────────────────────────────────────────────
 * Per RESEARCH §2.3 + §7 and `docs/reference/task-list-discipline.md` §3 there
 * are NO hard length caps on any text field. A `z.string().max(N)` would
 *   (a) reject the live, legitimately over-budget ledger at parse time, and
 *   (b) diverge the vendored `lib/validation/*-schema.ts` from task-view's
 *       source (watched by `task-view-vendor-drift.yml`).
 * So the schema stays cap-free and parseable; budgets are enforced ONLY at the
 * CLI write gate (prevent-at-source) and surfaced as soft parse warnings. This
 * module is KH-authored and is NOT in the vendor-drift watched-paths list, so
 * it carries no vendor-drift weight.
 *
 * `subtask.details` is intentionally NOT budgeted — it is the append-only
 * dispatch-brief + journal home; length there is legitimate (RESEARCH §2.3).
 */

/**
 * Per-record-kind char budgets.
 *
 * Numbers:
 *   - `task` / `subtask` — seeded VERBATIM from the original task-list
 *     `FIELD_BUDGETS` (taskDescription 1500, taskStatusNote 300,
 *     subtaskDescription 250, subtaskTestStrategy 300) so the existing
 *     task-list discipline is unchanged.
 *   - `theme` — `description` shares the task-description class (a markdown
 *     scope statement) → 1500; `notes` shares the status_note prose class
 *     → 300.
 *   - `item.description` — the one-sentence summary under the (forthcoming)
 *     `title` heading. Live data: median 125 / mean 182 / max 971; 500 is a
 *     soft budget generous enough never to flag the median/mean but to surface
 *     the genuinely-long outliers. The `title` ≤80 budget is added by {35.14}.
 */
export const LEDGER_BUDGETS = {
  /** task-list.json — Task record. */
  task: {
    description: 1500,
    status_note: 300,
  },
  /** task-list.json — Subtask record. `details` is intentionally absent. */
  subtask: {
    description: 250,
    testStrategy: 300,
  },
  /** product-roadmap.json — Theme record. */
  theme: {
    description: 1500,
    notes: 300,
  },
  /** product-backlog.json — Item record. `title` ≤80 added by {35.14}. */
  item: {
    description: 500,
  },
} as const;

export type LedgerRecordKind = keyof typeof LEDGER_BUDGETS;

/**
 * Back-compatible task-list budget constant. Pre-dates the unified registry;
 * the original named import (`{ FIELD_BUDGETS }`) is preserved here so the two
 * existing consumers — `parseTaskListWithWarnings` and
 * `scripts/ledger-sweep-s269.ts` — keep compiling unchanged. Derived from the
 * registry so the two can never drift.
 */
export const FIELD_BUDGETS = {
  taskDescription: LEDGER_BUDGETS.task.description,
  taskStatusNote: LEDGER_BUDGETS.task.status_note,
  subtaskDescription: LEDGER_BUDGETS.subtask.description,
  subtaskTestStrategy: LEDGER_BUDGETS.subtask.testStrategy,
} as const;

/** Repo-relative field-discipline doc, referenced in warning messages. */
export const DISCIPLINE_DOC = 'docs/reference/task-list-discipline.md';
