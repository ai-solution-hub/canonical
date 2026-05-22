#!/usr/bin/env bun
/**
 * Back-fill `capability_theme` on `task-list.json` from
 * `roadmap.themes[].linked_tasks[]` — Subtask 30.13 (PR-C Wave 2).
 *
 * Reverse-map: for every Task that appears in exactly one theme's
 * `linked_tasks[]`, set `Task.capability_theme` to that theme's id.
 * Tasks that appear in multiple themes are flagged as ambiguous and
 * left with `capability_theme` unchanged (the curator skill resolves
 * ambiguous mappings explicitly per P-OQ-4 default).
 *
 * Spec refs:
 *   - PRODUCT.md inv 9 (`capability_theme` optional back-link on TaskSchema)
 *   - TECH.md §3.2 order 8 (back-fill `capability_theme` on Tasks where clear)
 *   - PLAN.md §2.3 Subtask 30.13 (back-fill script + reverse-map logic)
 *   - T-OQ-3 ratified default — cardinality threshold 30 Tasks; escalate
 *     to Orchestrator if exceeded (split 30.13 into back-fill + renderer).
 *
 * Determinism: iteration order is JSON-stable (preserves insertion order
 * from `themes[]` and `tasks[]`). No timestamps, no UUIDs.
 *
 * Usage:
 *   bun run scripts/backfill-capability-theme.ts            # write task-list.json
 *   bun run scripts/backfill-capability-theme.ts --check    # dry-run; report counts only
 *
 * Exit codes:
 *   0 — back-fill complete (or --check passed)
 *   1 — input JSON missing or schema validation failed
 *   2 — output write failed
 *   3 — cardinality threshold exceeded (>30 Tasks affected — T-OQ-3 escalation)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'node:util';
import { RoadmapSchema } from '@/lib/validation/roadmap-schema';
import { TaskListSchema } from '@/lib/validation/task-list-schema';

const DEFAULT_ROADMAP = 'docs/reference/product-roadmap.json';
const DEFAULT_TASK_LIST = 'docs/reference/task-list.json';
const CARDINALITY_THRESHOLD = 30; // T-OQ-3 ratified default

interface CliFlags {
  roadmap: string;
  taskList: string;
  check: boolean;
}

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      roadmap: { type: 'string', default: DEFAULT_ROADMAP },
      'task-list': { type: 'string', default: DEFAULT_TASK_LIST },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'backfill-capability-theme.ts — reverse-map theme.linked_tasks[] to set Task.capability_theme.\n',
    );
    process.exit(0);
  }
  return {
    roadmap: values.roadmap as string,
    taskList: values['task-list'] as string,
    check: Boolean(values.check),
  };
}

interface BackfillResult {
  updatedCount: number;
  ambiguousCount: number;
  ambiguousIds: string[];
}

/**
 * Build a reverse-map from task-id to theme-id. Tasks that appear in
 * multiple themes get a sentinel empty-string value (caller filters these
 * out — ambiguous mappings are left for the curator to resolve).
 *
 * Pure function. Deterministic.
 */
function buildReverseMap(roadmap: {
  themes: ReadonlyArray<{ id: string; linked_tasks: ReadonlyArray<string> }>;
}): {
  reverseMap: Map<string, string>;
  ambiguous: Set<string>;
} {
  const reverseMap = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const theme of roadmap.themes) {
    for (const taskId of theme.linked_tasks) {
      if (reverseMap.has(taskId)) {
        ambiguous.add(taskId);
        reverseMap.set(taskId, ''); // sentinel for ambiguous
      } else if (!ambiguous.has(taskId)) {
        reverseMap.set(taskId, theme.id);
      }
    }
  }
  return { reverseMap, ambiguous };
}

function main(): void {
  const flags = parseCli();
  const roadmapPath = resolve(process.cwd(), flags.roadmap);
  const taskListPath = resolve(process.cwd(), flags.taskList);

  if (!existsSync(roadmapPath)) {
    console.error('backfill-capability-theme: roadmap not found: ' + roadmapPath);
    process.exit(1);
  }
  if (!existsSync(taskListPath)) {
    console.error(
      'backfill-capability-theme: task-list not found: ' + taskListPath,
    );
    process.exit(1);
  }

  let roadmapParsed: unknown;
  let taskListParsed: unknown;
  try {
    roadmapParsed = JSON.parse(readFileSync(roadmapPath, 'utf-8'));
    taskListParsed = JSON.parse(readFileSync(taskListPath, 'utf-8'));
  } catch (err) {
    console.error(
      'backfill-capability-theme: invalid JSON: ' + (err as Error).message,
    );
    process.exit(1);
  }

  const roadmapValidation = RoadmapSchema.safeParse(roadmapParsed);
  if (!roadmapValidation.success) {
    console.error('backfill-capability-theme: roadmap Zod validation failed:');
    console.error(JSON.stringify(roadmapValidation.error.format(), null, 2));
    process.exit(1);
  }

  const taskListValidation = TaskListSchema.safeParse(taskListParsed);
  if (!taskListValidation.success) {
    console.error('backfill-capability-theme: task-list Zod validation failed:');
    console.error(JSON.stringify(taskListValidation.error.format(), null, 2));
    process.exit(1);
  }

  const roadmap = roadmapValidation.data;
  const taskList = taskListValidation.data;

  // Build reverse map: task_id -> theme_id (or empty sentinel for ambiguous).
  const { reverseMap, ambiguous } = buildReverseMap(roadmap);

  // Back-fill task_list — iterate Tasks in JSON-stable order.
  let updatedCount = 0;
  let ambiguousCount = 0;
  const ambiguousIds: string[] = [];
  for (const task of taskList.tasks) {
    const themeId = reverseMap.get(task.id);
    if (themeId !== undefined && themeId !== '') {
      task.capability_theme = themeId;
      updatedCount++;
    } else if (themeId === '') {
      ambiguousCount++;
      ambiguousIds.push(task.id);
    }
  }

  const result: BackfillResult = { updatedCount, ambiguousCount, ambiguousIds };

  // T-OQ-3 cardinality check.
  if (updatedCount > CARDINALITY_THRESHOLD) {
    console.error(
      `backfill-capability-theme: T-OQ-3 cardinality threshold exceeded ` +
        `(${updatedCount} Tasks affected; threshold ${CARDINALITY_THRESHOLD}). ` +
        `Escalate to Orchestrator: split 30.13 into 30.13a back-fill + 30.13b renderer.`,
    );
    process.exit(3);
  }

  // Validate the back-filled task-list before write.
  const writeValidation = TaskListSchema.safeParse(taskList);
  if (!writeValidation.success) {
    console.error('backfill-capability-theme: post-backfill validation failed:');
    console.error(JSON.stringify(writeValidation.error.format(), null, 2));
    process.exit(1);
  }

  if (flags.check) {
    console.log(
      `backfill-capability-theme: --check passed. ` +
        `Would update ${updatedCount} Tasks. Ambiguous: ${ambiguousCount}` +
        (ambiguous.size > 0 ? ` (ids: ${[...ambiguous].join(', ')})` : '') +
        `.`,
    );
    process.exit(0);
  }

  try {
    writeFileSync(
      taskListPath,
      JSON.stringify(writeValidation.data, null, 2) + '\n',
      'utf-8',
    );
  } catch (err) {
    console.error(
      'backfill-capability-theme: write failed: ' + (err as Error).message,
    );
    process.exit(2);
  }

  console.log(
    `Back-filled capability_theme on ${result.updatedCount} Tasks (ambiguous: ${result.ambiguousCount}` +
      (result.ambiguousIds.length > 0
        ? `; ids: ${result.ambiguousIds.join(', ')}`
        : '') +
      `).`,
  );
  process.exit(0);
}

// Export buildReverseMap for tests (pure function).
export { buildReverseMap, type BackfillResult };

// Run main when invoked as a script, not when imported.
if (import.meta.main) {
  main();
}
