/**
 * umbrellas-task-list-roundtrip.test.ts
 *
 * Cross-doc round-trip guard between `docs/reference/umbrellas.json` and
 * `docs/reference/task-list.json` per TECH §3.4 of
 * `docs/specs/id-31-canonical-pipeline-task-list-migration/TECH.md` and PRODUCT
 * invariant 9 (every `umbrellas[].task_ids[]` entry must resolve to a real
 * Task in `task-list.json`).
 *
 * Two assertions, separate enforcement strengths:
 *
 *   1. Hard fail (canary) — every `umbrellas[].task_ids[]` entry references
 *      a real Task by string id. Broken references collected into an array;
 *      `expect(broken).toEqual([])` produces a readable failure showing all
 *      offenders at once instead of breaking on the first mismatch. This is
 *      the load-bearing cross-doc check.
 *
 *   2. Soft warning — orphan Tasks (Tasks in `task-list.json` not assigned
 *      to any umbrella) are tolerated by default per P-OQ-2. The test
 *      `console.warn`s with the orphan list but never fails. Steady-state
 *      at first run is empty `canonical-pipeline.task_ids[]` (per 31.7), so
 *      every existing Task is orphan and the warning fires once.
 *
 * Companion test: `__tests__/validation/umbrellas-roundtrip.test.ts`
 * (self-parse, PRODUCT inv 17).
 *
 * T-OQ-4 RATIFIED: no shared fixture/helper between the two test files.
 * Each re-reads the JSON independently — the dependency surface stays at
 * the schema modules + the two on-disk JSONs.
 *
 * The set-membership pattern (rather than baking specific Task ids into the
 * assertions) means the test continues to pass regardless of `task-list.json`
 * HEAD shape — only the umbrellas → tasks pointer integrity is enforced.
 *
 * Failure recovery (hard fail): the failing assertion lists every broken
 * `{umbrella, missing_task_id}` pair. Either (a) the referenced Task was
 * removed from `task-list.json` (restore or move the umbrella entry), or
 * (b) the umbrella entry was authored against a non-existent Task id (fix
 * the umbrella entry or open the Task first).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { UmbrellasSchema } from '@/lib/validation/umbrellas-schema';
import { TaskListSchema } from '@/lib/validation/task-list-schema';

describe('umbrellas ↔ task-list round-trip (PRODUCT inv 9)', () => {
  const umbrellas = UmbrellasSchema.parse(
    JSON.parse(readFileSync('docs/reference/umbrellas.json', 'utf-8')),
  );
  const taskList = TaskListSchema.parse(
    JSON.parse(readFileSync('docs/reference/task-list.json', 'utf-8')),
  );
  const realTaskIds = new Set(taskList.tasks.map((t) => t.id));

  it('every umbrellas[].task_ids[] entry references a real Task', () => {
    const broken: { umbrella: string; missing_task_id: string }[] = [];
    for (const u of umbrellas.umbrellas) {
      for (const id of u.task_ids) {
        if (!realTaskIds.has(id)) {
          broken.push({ umbrella: u.id, missing_task_id: id });
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('warns (but does not fail) on orphan Tasks (P-OQ-2 default)', () => {
    const assigned = new Set<string>();
    for (const u of umbrellas.umbrellas) for (const id of u.task_ids) assigned.add(id);
    const orphans = taskList.tasks
      .map((t) => t.id)
      .filter((id) => !assigned.has(id));
    if (orphans.length > 0) {
      // Soft warning per PRODUCT inv 9 + P-OQ-2.
      console.warn(
        `Umbrella round-trip: ${orphans.length} orphan Task(s) (no umbrella membership):`,
        orphans,
      );
    }
    expect(true).toBe(true); // never fail
  });
});
