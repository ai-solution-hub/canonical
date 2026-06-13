/**
 * migrate-ledger-ids-to-string.ts — ID-102.8 P6 one-shot ledger migration.
 *
 * Converts every stored subtask `id` (number → digit string) and every subtask
 * `dependencies[]` entry (number → digit string) in `task-list.json`, in place,
 * preserving value and gaps (PRODUCT inv 2, 10, 11; TECH §P6). This is the
 * SINGLE atomic flag-day data half (the schema half is P1); it runs exactly once
 * against the settled post-cutover write path and is DELETABLE after the
 * flag-day soak (TECH §Follow-ups).
 *
 * Bounded pre-migration read exception (inv 11): this script is the ONLY code
 * permitted to read the pre-migration number shape. It reads RAW JSON (never via
 * the now-string-only TaskListSchema, which would reject number ids), mutates,
 * re-serialises with the canonical formatter, then validates the OUTPUT against
 * the NEW string schema as its own exit gate.
 *
 * Idempotent (inv 10): the `typeof === 'number'` guards make a re-run a no-op —
 * already-string ids/deps pass through untouched, so a second run is
 * byte-identical to the first.
 *
 * Byte-shape (inv 12): re-serialise via `serialiseLedger`, which mirrors the
 * on-disk + server convention (2-space indent, all non-ASCII escaped to
 * `\uXXXX`, single trailing newline) — identical to task-view's
 * `packages/server/scoped-serialise.ts` `escapeSerialise`. A no-op
 * `JSON.parse(originalText)` round-trip is byte-identical to the original file,
 * so the only byte changes are the intended `15` → `"15"` id/dep quotations.
 *
 * Usage:  bun scripts/migrate-ledger-ids-to-string.ts [--ledger-dir <path>]
 *         (default --ledger-dir docs/reference)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskListSchema } from '@/lib/validation/task-list-schema';

// ── canonical serialiser (mirrors task-view scoped-serialise.ts escapeSerialise)

const NON_ASCII = new RegExp('[\\u0080-\\uffff]', 'g');

/** Escape every non-ASCII UTF-16 code unit to `\uXXXX` (ensure_ascii semantics). */
export function escapeNonAscii(s: string): string {
  return s.replace(
    NON_ASCII,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * Serialise a parsed-JSON value to the on-disk ledger convention: 2-space
 * indent, non-ASCII escaped, single trailing newline. Byte-identical to a no-op
 * round-trip of the original file (inv 12).
 */
export function serialiseLedger(parsedValue: unknown): string {
  return escapeNonAscii(JSON.stringify(parsedValue, null, 2)) + '\n';
}

// ── the in-place id/deps transform ──────────────────────────────────────────────

interface MigrationStats {
  idsConverted: number;
  depsConverted: number;
}

/**
 * Mutate a parsed task-list document IN PLACE: every subtask `id` and every
 * `dependencies[]` entry that is a `number` becomes its `String(...)` form. The
 * `typeof === 'number'` guard makes the transform idempotent (inv 10). Returns
 * the same object reference (mutated) for ergonomic chaining/testing.
 *
 * MUTATES the input in place AND returns it — do not rely on reference equality
 * to detect changes.
 */
export function migrateTaskListIds<T>(doc: T): T {
  migrateTaskListIdsWithStats(doc);
  return doc;
}

/** As {@link migrateTaskListIds} but also returns conversion counts. */
export function migrateTaskListIdsWithStats(doc: unknown): MigrationStats {
  const stats: MigrationStats = { idsConverted: 0, depsConverted: 0 };
  if (!doc || typeof doc !== 'object') return stats;
  const tasks = (doc as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return stats;

  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const subtasks = (task as { subtasks?: unknown }).subtasks;
    if (!Array.isArray(subtasks)) continue;

    for (const subtask of subtasks) {
      if (!subtask || typeof subtask !== 'object') continue;
      const s = subtask as { id?: unknown; dependencies?: unknown };

      if (typeof s.id === 'number') {
        s.id = String(s.id);
        stats.idsConverted += 1;
      }

      if (Array.isArray(s.dependencies)) {
        s.dependencies = s.dependencies.map((d) => {
          if (typeof d === 'number') {
            stats.depsConverted += 1;
            return String(d);
          }
          return d;
        });
      }
    }
  }

  return stats;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function parseLedgerDir(argv: string[]): string {
  const idx = argv.indexOf('--ledger-dir');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return 'docs/reference';
}

function main(argv: string[]): void {
  const ledgerDir = parseLedgerDir(argv);
  const target = join(ledgerDir, 'task-list.json');

  // Bounded pre-migration read exception (inv 11): RAW JSON, never TaskListSchema.
  const rawText = readFileSync(target, 'utf8');
  const parsed = JSON.parse(rawText);

  const stats = migrateTaskListIdsWithStats(parsed);

  // Exit gate (inv 11): the migrated document MUST satisfy the NEW string schema.
  const check = TaskListSchema.safeParse(parsed);
  if (!check.success) {
    process.stderr.write(
      'migrate-ledger-ids-to-string: migrated output FAILED TaskListSchema ' +
        'validation — aborting without write.\n',
    );
    process.stderr.write(JSON.stringify(check.error.issues, null, 2) + '\n');
    process.exit(1);
  }

  const out = serialiseLedger(parsed);
  writeFileSync(target, out);

  process.stdout.write(
    `migrate-ledger-ids-to-string: ${target} — ` +
      `${stats.idsConverted} subtask id(s), ${stats.depsConverted} dependency ` +
      `entr${stats.depsConverted === 1 ? 'y' : 'ies'} converted (number → string).\n`,
  );
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
