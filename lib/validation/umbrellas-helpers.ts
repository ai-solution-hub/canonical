/**
 * umbrellas-helpers.ts — Templating helper for retrospective journal blocks
 * appended to Subtask `details` fields when a retrospective Task is opened in
 * `done` status post-implementation.
 *
 * Implements TECH §5 (Journal-block templating helper) of
 * `docs/specs/canonical-pipeline-task-list-migration/TECH.md`, satisfying
 * PRODUCT inv 12 (retrospective journal-block contents) + inv 15 (UK English
 * + ISO 8601 timestamps) of the same spec set.
 *
 * Sibling module to `lib/validation/umbrellas-schema.ts` per T-OQ-1 RATIFIED
 * DEFAULT (Wave 0 §4). No barrel re-export.
 *
 * The helper does NOT load `docs/reference/umbrellas.json`. The `umbrella_id`
 * input is inserted verbatim as a plain string; callers verify id existence
 * against the umbrellas root document independently.
 *
 * Tests inject a fixed timestamp via `vi.useFakeTimers()` /
 * `vi.setSystemTime()`; production code calls `new Date().toISOString()` at
 * invocation time, so each call produces a single ISO 8601 timestamp shared
 * by both the opening `<info added on …>` and closing `</info added on …>`
 * tags.
 *
 * Spec references:
 *   - docs/specs/canonical-pipeline-task-list-migration/PRODUCT.md inv 12, 15
 *   - docs/specs/canonical-pipeline-task-list-migration/TECH.md §5.1, §5.2
 *   - docs/specs/canonical-pipeline-task-list-migration/PLAN.md §2 Subtask 31.6
 */

// NOTE: TECH §5.1 specifies `import type { UmbrellaEntry } from '@/lib/validation/umbrellas-schema'`
// as part of the helper's documented contract. The runtime helper does NOT
// reference UmbrellaEntry — `umbrella_id` is inserted as a plain string and
// callers verify id existence against the umbrellas root document. The import
// is intentionally omitted to satisfy lint (`@typescript-eslint/no-unused-vars`)
// while preserving the doc-level relationship via the JSDoc on
// `RetrospectiveOpeningInput.umbrella_id` below.

// ──────────────────────────────────────────────────────────────────────────────
// RetrospectiveOpeningInput (TECH §5.1 — LOCKED contract)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Inputs needed to render a retrospective opening journal block per PRODUCT
 * inv 12. Field names mirror TECH §5.1 verbatim — do not rename without
 * surfacing as T-OQ.
 */
export interface RetrospectiveOpeningInput {
  /** Session counter when the retro is being opened (NOT the original work session). */
  retro_open_session: string;
  /** Original work session for the shipped piece (e.g. "S242"). */
  original_session: string;
  /** Original work branch (e.g. "content-items-investigation"). */
  original_branch: string;
  /** Path (repo-relative) to the continuation prompt that documented the original work. */
  continuation_prompt_path: string;
  /** Load-bearing commits in chronological order. */
  commits: Array<{ sha8: string; message_line: string }>;
  /** Migration file references (paths from repo root), optional. */
  migration_files?: string[];
  /** PLAN.md section number this retro Task delivered against (e.g. "4.1"). */
  plan_md_section: string;
  /** Follow-up flags / known gaps (one-liners), optional. */
  followup_flags?: string[];
  /** Optional umbrella id for the cross-reference line. */
  umbrella_id?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// formatRetrospectiveJournalBlock (TECH §5.1)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Format a retrospective journal block per PRODUCT inv 12.
 *
 * Output shape (TECH §5.1):
 *
 *   <info added on YYYY-MM-DDTHH:MM:SS.sssZ>
 *   RETROSPECTIVE OPENING — Task opened in `done` status post-implementation.
 *   Original work happened S{NN} per `docs/continuation-prompts/<file>.md`.
 *
 *   Commits (S{NN}, <branch>):
 *   - <sha8> — <message-line>
 *   ...
 *
 *   Migration files: (optional — omitted when empty/undefined)
 *   - supabase/migrations/<timestamp>_<name>.sql
 *
 *   Follow-up flags: (optional — omitted when empty/undefined)
 *   - <flag>
 *
 *   Umbrella: <id> (optional — omitted when undefined)
 *
 *   PLAN.md §{plan_md_section} acceptance criteria all met.
 *   </info added on YYYY-MM-DDTHH:MM:SS.sssZ>
 *
 * The opening and closing `<info added on …>` timestamps are identical (single
 * `new Date().toISOString()` call at invocation time). UK English throughout
 * (PRODUCT inv 15).
 *
 * The helper does NOT load `umbrellas.json` — `umbrella_id` is inserted
 * verbatim. Callers verify id existence against the umbrellas root document.
 */
export function formatRetrospectiveJournalBlock(
  input: RetrospectiveOpeningInput,
): string {
  const timestamp = new Date().toISOString();
  const sections: string[] = [];

  // Opening tag
  sections.push(`<info added on ${timestamp}>`);

  // RETROSPECTIVE OPENING preamble + Original-work line
  sections.push(
    'RETROSPECTIVE OPENING — Task opened in `done` status post-implementation.',
  );
  sections.push(
    `Original work happened ${input.original_session} per \`${input.continuation_prompt_path}\`.`,
  );

  // Blank line + Commits block
  sections.push('');
  sections.push(
    `Commits (${input.original_session}, ${input.original_branch}):`,
  );
  for (const commit of input.commits) {
    sections.push(`- ${commit.sha8} — ${commit.message_line}`);
  }

  // Optional Migration files block
  if (input.migration_files && input.migration_files.length > 0) {
    sections.push('');
    sections.push('Migration files:');
    for (const path of input.migration_files) {
      sections.push(`- ${path}`);
    }
  }

  // Optional Follow-up flags block
  if (input.followup_flags && input.followup_flags.length > 0) {
    sections.push('');
    sections.push('Follow-up flags:');
    for (const flag of input.followup_flags) {
      sections.push(`- ${flag}`);
    }
  }

  // Optional Umbrella line
  if (input.umbrella_id !== undefined) {
    sections.push('');
    sections.push(`Umbrella: ${input.umbrella_id}`);
  }

  // PLAN.md acceptance close line
  sections.push('');
  sections.push(
    `PLAN.md §${input.plan_md_section} acceptance criteria all met.`,
  );

  // Closing tag (timestamp matches opening exactly)
  sections.push(`</info added on ${timestamp}>`);

  return sections.join('\n');
}
