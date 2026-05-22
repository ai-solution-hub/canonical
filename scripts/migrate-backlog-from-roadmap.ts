/**
 * migrate-backlog-from-roadmap.ts — PR-B bulk content migration.
 *
 * Per Subtask 30.9 (Wave 3, PR-B):
 *  - Append 54 net-new Backlog entries (IDs 86-139, renumbered from RESEARCH §3.2 78-131 via S67 W1b reconciliation to clear live MAX-ID 85) from
 *    scripts/fixtures/backlog-migration-payload.json (extracted from
 *    RESEARCH §3.2) to docs/reference/product-backlog.json.
 *  - Remove 8 REMOVE_REDUNDANT items (3.2, 3.4, 3.6, 7.2, 7.6, 8.1, 11.17,
 *    11.2) from docs/reference/product-roadmap.json.
 *  - Add adjacency notes lines to PARTIAL_OVERLAP clusters per
 *    PRODUCT inv 5 + RESEARCH §5.4.
 *  - Verify no 4-word-window overlap between new descriptions and active
 *    Task titles (PRODUCT inv 5 + TECH §2 inv 5 row).
 *  - Validate via BacklogSchema + RoadmapSchema pre-write (PRODUCT inv 15).
 *  - Idempotent: re-running on already-migrated content produces zero
 *    diff (skips entries whose id is already present AND whose `notes`
 *    carry the canonical provenance marker).
 *  - Collision-safe: if a fixture id collides with an existing Backlog
 *    entry that does NOT carry the migration marker, abort BEFORE writing
 *    (PRODUCT inv 15 fail-loud-not-quiet).
 *
 * Spec references:
 *  - PRODUCT.md inv 1, 2, 5, 15, 12 PR-B clause.
 *  - TECH.md §2 + §3.2 + §6.1 + §7 risk row 3.
 *  - PLAN.md §2.2 Subtask 30.9.
 *
 * Phase-B provenance contract per PRODUCT inv 2: every appended entry's
 * `notes` field carries the canonical 'Migrated from roadmap §X.Y. ...'
 * marker. The fixture itself encodes the marker; this script does not
 * synthesise notes (fail-loud if the fixture is malformed).
 *
 * IMPORTANT: This Subtask (30.9) ships the script. Subtask 30.10 RUNS the
 * script against live JSON; 30.9 only exercises it against tmpdir copies
 * in __tests__/scripts/migrate-backlog-from-roadmap.test.ts.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  BacklogSchema,
  BacklogItemSchema,
  type BacklogDocument,
  type BacklogItem,
} from '@/lib/validation/backlog-schema';
import { RoadmapSchema, type Roadmap } from '@/lib/validation/roadmap-schema';
import {
  TaskListSchema,
  type TaskList,
} from '@/lib/validation/task-list-schema';

// ──────────────────────────────────────────────────────────────────────────────
// Constants — PRODUCT inv 2 / inv 5 / inv 12 PR-B + RESEARCH §2 / §5.4
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Canonical Phase-B provenance marker (PRODUCT inv 2). Every migration
 * entry's `notes` field MUST contain this substring; idempotency detection
 * uses this marker to distinguish migration entries from independently
 * authored entries that happen to share an id.
 */
export const PROVENANCE_MARKER = 'Migrated from roadmap §';

/**
 * 8 REMOVE_REDUNDANT roadmap item ids per RESEARCH §2.3 (PRODUCT inv 12
 * PR-B clause). The "partial 11.2 per RESEARCH §2" note in the brief
 * refers to the rename-gated partition described in RESEARCH §2.3 line
 * 245 — operationally the entire 11.2 item is removed (the surviving
 * W-RE/W-RH scope migrates to other Backlog items, not preserved as a
 * residual 11.2 entry).
 */
export const REMOVE_REDUNDANT_ROADMAP_IDS: ReadonlyArray<string> = [
  '3.2',
  '3.4',
  '3.6',
  '7.2',
  '7.6',
  '8.1',
  '11.17',
  '11.2',
];

/**
 * PARTIAL_OVERLAP clusters per PRODUCT inv 5 + RESEARCH §5.4. For each
 * cluster, every member's `notes` gets an adjacency line citing every
 * other member.
 */
export interface PartialOverlapCluster {
  readonly name: string;
  readonly ids: ReadonlyArray<string>;
}

export const PARTIAL_OVERLAP_CLUSTERS: ReadonlyArray<PartialOverlapCluster> = [
  { name: 'ingest-UI', ids: ['61', '62', '87', '108'] },
  { name: 'doc-triage', ids: ['64', '90'] },
  { name: 'prompt-suggestion', ids: ['49', '99'] },
  { name: 'portal-automation', ids: ['53', '109'] },
];

// ──────────────────────────────────────────────────────────────────────────────
// File paths — defaults are the live JSONs; tests override via opts.
// ──────────────────────────────────────────────────────────────────────────────

export interface MigrationPaths {
  readonly backlogPath: string;
  readonly roadmapPath: string;
  readonly taskListPath: string;
  readonly fixturePath: string;
}

export const DEFAULT_PATHS: MigrationPaths = {
  backlogPath: 'docs/reference/product-backlog.json',
  roadmapPath: 'docs/reference/product-roadmap.json',
  taskListPath: 'docs/reference/task-list.json',
  fixturePath: 'scripts/fixtures/backlog-migration-payload.json',
};

// ──────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported for unit testing.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tokenise a string for 4-word-window overlap detection.
 * Lowercases, splits on non-word characters, drops empty tokens.
 */
export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length > 0);
}

/**
 * 4-word-window overlap detection per PRODUCT inv 5 + TECH §2 inv 5 row.
 * Returns the matched window when found, null otherwise.
 *
 * Implementation: tokenise both strings; check every 4-token window of
 * `description` for membership in the set of 4-token windows of `title`.
 */
export function detectFourWordOverlap(
  description: string,
  title: string,
): string | null {
  const descTokens = tokenise(description);
  const titleTokens = tokenise(title);

  if (descTokens.length < 4 || titleTokens.length < 4) return null;

  const titleWindows = new Set<string>();
  for (let i = 0; i <= titleTokens.length - 4; i++) {
    titleWindows.add(titleTokens.slice(i, i + 4).join(' '));
  }

  for (let i = 0; i <= descTokens.length - 4; i++) {
    const window = descTokens.slice(i, i + 4).join(' ');
    if (titleWindows.has(window)) return window;
  }

  return null;
}

/**
 * Idempotency + collision classifier.
 *
 * Three outcomes per fixture id:
 *  - 'absent': not in existing backlog → append.
 *  - 'migration-skip': exists and existing entry carries the provenance
 *    marker → skip silently (idempotent re-run).
 *  - 'collision': exists but the existing entry does NOT carry the
 *    provenance marker → abort migration before writing (existing entry
 *    is independently authored; we cannot safely merge).
 */
export type EntryStatus = 'absent' | 'migration-skip' | 'collision';

export function classifyFixtureEntry(
  fixtureEntry: BacklogItem,
  existingByid: Map<string, BacklogItem>,
): EntryStatus {
  const existing = existingByid.get(fixtureEntry.id);
  if (!existing) return 'absent';
  const notes = existing.notes ?? '';
  if (notes.includes(PROVENANCE_MARKER)) return 'migration-skip';
  return 'collision';
}

/**
 * Append the canonical adjacency-notes line for a PARTIAL_OVERLAP cluster
 * member, citing every other member of the cluster.
 *
 * Idempotent: if the line is already present in `notes`, returns notes
 * unchanged. Preserves prior notes content (appended on a new line).
 */
export function withAdjacencyNote(
  notes: string | null,
  cluster: PartialOverlapCluster,
  selfId: string,
): string {
  const others = cluster.ids.filter((id) => id !== selfId);
  // Canonical line shape (queryable substring). Stable ordering = cluster
  // declaration order minus self.
  const line = `PARTIAL_OVERLAP cluster '${cluster.name}': thematic adjacency with ID-${others.join(' / ID-')}.`;
  const current = notes ?? '';
  if (current.includes(line)) return current;
  return current.length > 0 ? `${current}\n\n${line}` : line;
}

/**
 * Result type — Result<T, MigrationError>-style for explicit success /
 * failure routing (no thrown errors from the pure entry point).
 */
export type MigrationResult =
  | { ok: true; appended: number; skipped: number; roadmapRemovals: number }
  | { ok: false; reason: MigrationFailReason; detail: string };

export type MigrationFailReason =
  | 'fixture-schema-invalid'
  | 'backlog-schema-invalid'
  | 'roadmap-schema-invalid'
  | 'tasklist-schema-invalid'
  | 'collision'
  | 'task-title-overlap'
  | 'fixture-internal-duplicate'
  | 'missing-roadmap-removal-target';

// ──────────────────────────────────────────────────────────────────────────────
// File I/O — read+parse helpers. Each fails loud via Zod.
// ──────────────────────────────────────────────────────────────────────────────

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadFixture(
  filePath: string,
): { ok: true; data: BacklogItem[] } | { ok: false; detail: string } {
  const raw = readJson(filePath);
  const parsed = z.array(BacklogItemSchema).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      detail: `Fixture failed BacklogItemSchema array parse: ${JSON.stringify(parsed.error.errors)}`,
    };
  }
  // Internal-duplicate check — fixture must not carry duplicate ids itself.
  const ids = parsed.data.map((e) => e.id);
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dups.push(id);
    else seen.add(id);
  }
  if (dups.length > 0) {
    return {
      ok: false,
      detail: `Fixture contains internal duplicate id(s): ${dups.join(', ')}`,
    };
  }
  return { ok: true, data: parsed.data };
}

// ──────────────────────────────────────────────────────────────────────────────
// Migration core — orchestrates 9 steps per PLAN §2.2 / brief.
// ──────────────────────────────────────────────────────────────────────────────

export interface RunMigrationOpts {
  readonly paths: MigrationPaths;
  /**
   * When false (default for tests), serialise side effects on the in-memory
   * structures but DO NOT write to disk. Tests assert against the returned
   * structures + write-shouldnt-have-occurred state. The CLI entry sets
   * write: true.
   */
  readonly write: boolean;
}

export function runMigration(opts: RunMigrationOpts): MigrationResult {
  const { paths, write } = opts;

  // Step 1: read backlog.
  const backlogRaw = readJson(paths.backlogPath);
  const backlogParse = BacklogSchema.safeParse(backlogRaw);
  if (!backlogParse.success) {
    return {
      ok: false,
      reason: 'backlog-schema-invalid',
      detail: `Backlog pre-migration failed BacklogSchema.parse(): ${JSON.stringify(backlogParse.error.errors)}`,
    };
  }
  const backlog: BacklogDocument = backlogParse.data;

  // Step 2: read fixture.
  const fixture = loadFixture(paths.fixturePath);
  if (!fixture.ok) {
    // Distinguish internal-duplicate from schema-invalid by inspecting detail
    // (kept as one bucket for caller simplicity per inv 15 fail-loud).
    if (fixture.detail.startsWith('Fixture contains internal duplicate')) {
      return {
        ok: false,
        reason: 'fixture-internal-duplicate',
        detail: fixture.detail,
      };
    }
    return {
      ok: false,
      reason: 'fixture-schema-invalid',
      detail: fixture.detail,
    };
  }

  // Step 3: classify each fixture entry — absent / migration-skip / collision.
  const existingByid = new Map<string, BacklogItem>(
    backlog.items.map((i) => [i.id, i]),
  );

  const toAppend: BacklogItem[] = [];
  let skipped = 0;
  const collisions: string[] = [];

  for (const entry of fixture.data) {
    const status = classifyFixtureEntry(entry, existingByid);
    if (status === 'absent') toAppend.push(entry);
    else if (status === 'migration-skip') skipped++;
    else collisions.push(entry.id);
  }

  if (collisions.length > 0) {
    return {
      ok: false,
      reason: 'collision',
      detail: `Fixture id(s) collide with existing non-migration Backlog entries (existing entry lacks the '${PROVENANCE_MARKER}' marker, so this is NOT an idempotent re-run): ${collisions.join(', ')}`,
    };
  }

  // Step 4: add PARTIAL_OVERLAP cluster adjacency notes. Apply across
  // BOTH net-new entries (in toAppend) AND existing backlog members of
  // any cluster — every cluster member ends up with the adjacency line
  // after migration, regardless of when the member was authored.
  const allMutated = [...backlog.items, ...toAppend];
  const indexById = new Map<string, BacklogItem>(
    allMutated.map((i) => [i.id, i]),
  );

  for (const cluster of PARTIAL_OVERLAP_CLUSTERS) {
    for (const memberId of cluster.ids) {
      const member = indexById.get(memberId);
      if (!member) continue; // not all cluster members may be present yet
      member.notes = withAdjacencyNote(member.notes, cluster, memberId);
    }
  }

  // Step 5: read task-list; verify no 4-word-window overlap between new
  // descriptions and active Task titles.
  const taskListRaw = readJson(paths.taskListPath);
  const taskListParse = TaskListSchema.safeParse(taskListRaw);
  if (!taskListParse.success) {
    return {
      ok: false,
      reason: 'tasklist-schema-invalid',
      detail: `Task list failed TaskListSchema.parse(): ${JSON.stringify(taskListParse.error.errors)}`,
    };
  }
  const taskList: TaskList = taskListParse.data;

  const overlapTargets: Array<{
    entryId: string;
    taskId: string;
    window: string;
  }> = [];
  for (const entry of toAppend) {
    for (const task of taskList.tasks) {
      const window = detectFourWordOverlap(entry.description, task.title);
      if (window !== null) {
        overlapTargets.push({ entryId: entry.id, taskId: task.id, window });
      }
    }
  }

  if (overlapTargets.length > 0) {
    const head = overlapTargets[0];
    const summary = overlapTargets
      .map((o) => `entry ${o.entryId} ↔ Task ${o.taskId} via "${o.window}"`)
      .join('; ');
    return {
      ok: false,
      reason: 'task-title-overlap',
      detail: `${overlapTargets.length} 4-word-window overlap(s) detected between new Backlog descriptions and active Task titles (PRODUCT inv 5). First match: entry ${head.entryId} description ↔ Task ${head.taskId} title via window "${head.window}". All matches: ${summary}`,
    };
  }

  // Step 6: merge toAppend into backlog.items[]; revalidate.
  const mergedBacklog: BacklogDocument = {
    ...backlog,
    items: [...backlog.items, ...toAppend],
  };
  const mergedParse = BacklogSchema.safeParse(mergedBacklog);
  if (!mergedParse.success) {
    return {
      ok: false,
      reason: 'backlog-schema-invalid',
      detail: `Merged backlog failed BacklogSchema.parse() (post-merge): ${JSON.stringify(mergedParse.error.errors)}`,
    };
  }

  // Step 7: read roadmap; remove 8 REMOVE_REDUNDANT items.
  const roadmapRaw = readJson(paths.roadmapPath);
  const roadmapParse = RoadmapSchema.safeParse(roadmapRaw);
  if (!roadmapParse.success) {
    return {
      ok: false,
      reason: 'roadmap-schema-invalid',
      detail: `Roadmap pre-migration failed RoadmapSchema.parse(): ${JSON.stringify(roadmapParse.error.errors)}`,
    };
  }
  const roadmap: Roadmap = roadmapParse.data;

  const removalSet = new Set(REMOVE_REDUNDANT_ROADMAP_IDS);
  const observedRemovals = new Set<string>();
  let removed = 0;

  let updatedRoadmap: Roadmap = roadmap;
  if (roadmap.sections) {
    const newSections = roadmap.sections.map((section) => {
      const filteredItems = section.items.filter((it) => {
        if (removalSet.has(it.id)) {
          observedRemovals.add(it.id);
          removed++;
          return false;
        }
        return true;
      });
      return { ...section, items: filteredItems };
    });
    updatedRoadmap = { ...roadmap, sections: newSections };
  }

  // Verify every targeted id was actually present (idempotent re-runs of
  // PR-B against a roadmap that's already had the removals applied will
  // report `observedRemovals.size === 0` on second run, which is fine —
  // the count delta = 0 is the idempotent-success signal). We only fail
  // when the FIRST run can't find a targeted id (the roadmap is in an
  // unexpected state).
  const isFirstRun = removed > 0 || observedRemovals.size > 0;
  if (isFirstRun) {
    const missing = REMOVE_REDUNDANT_ROADMAP_IDS.filter(
      (id) => !observedRemovals.has(id),
    );
    if (missing.length > 0) {
      return {
        ok: false,
        reason: 'missing-roadmap-removal-target',
        detail: `Roadmap is missing REMOVE_REDUNDANT target id(s) on a first-run pass (some were removed but not all): ${missing.join(', ')}. Aborting before write to avoid partial state.`,
      };
    }
  }

  // Step 8: validate roadmap post-removal.
  const updatedRoadmapParse = RoadmapSchema.safeParse(updatedRoadmap);
  if (!updatedRoadmapParse.success) {
    return {
      ok: false,
      reason: 'roadmap-schema-invalid',
      detail: `Updated roadmap failed RoadmapSchema.parse() (post-removal): ${JSON.stringify(updatedRoadmapParse.error.errors)}`,
    };
  }

  // Step 9: write both files atomically (best effort — fs.writeFileSync
  // is atomic-per-file on POSIX). When `write: false`, this branch is
  // skipped — the test path asserts on the returned counts only.
  if (write) {
    fs.writeFileSync(
      paths.backlogPath,
      JSON.stringify(mergedParse.data, null, 2) + '\n',
      'utf-8',
    );
    fs.writeFileSync(
      paths.roadmapPath,
      JSON.stringify(updatedRoadmapParse.data, null, 2) + '\n',
      'utf-8',
    );
  }

  return {
    ok: true,
    appended: toAppend.length,
    skipped,
    roadmapRemovals: removed,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI entry point — argv parsing kept minimal. Tests do NOT invoke main();
// they call runMigration() directly with tmpdir paths.
// ──────────────────────────────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): {
  paths: MigrationPaths;
  write: boolean;
  help: boolean;
} {
  const args = { ...DEFAULT_PATHS } as {
    backlogPath: string;
    roadmapPath: string;
    taskListPath: string;
    fixturePath: string;
  };
  let write = true;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') write = false;
    else if (a === '--help' || a === '-h') help = true;
    else if (a === '--backlog' && argv[i + 1]) {
      args.backlogPath = argv[++i];
    } else if (a === '--roadmap' && argv[i + 1]) {
      args.roadmapPath = argv[++i];
    } else if (a === '--task-list' && argv[i + 1]) {
      args.taskListPath = argv[++i];
    } else if (a === '--fixture' && argv[i + 1]) {
      args.fixturePath = argv[++i];
    }
  }
  return { paths: args, write, help };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: bun scripts/migrate-backlog-from-roadmap.ts [options]

PR-B bulk content migration — appends 54 net-new Backlog entries (IDs
86-139) and removes 8 REMOVE_REDUNDANT Roadmap items per PRODUCT inv 12.

Options:
  --dry-run, -n            Validate + classify, but do not write either JSON file.
  --backlog <path>         Backlog file (default: docs/reference/product-backlog.json).
  --roadmap <path>         Roadmap file (default: docs/reference/product-roadmap.json).
  --task-list <path>       Task list file (default: docs/reference/task-list.json).
  --fixture <path>         Fixture payload (default: scripts/fixtures/backlog-migration-payload.json).
  --help, -h               Show this help.

This script is idempotent: re-running on already-migrated content produces
zero diff (skips fixture entries whose id is already present AND whose notes
carry the canonical 'Migrated from roadmap §' marker). Collisions (existing
entry with same id but no marker) abort BEFORE writing.
`);
}

async function main(): Promise<void> {
  const { paths, write, help } = parseCliArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    process.exit(0);
  }

  const cwd = process.cwd();
  const resolvedPaths: MigrationPaths = {
    backlogPath: path.resolve(cwd, paths.backlogPath),
    roadmapPath: path.resolve(cwd, paths.roadmapPath),
    taskListPath: path.resolve(cwd, paths.taskListPath),
    fixturePath: path.resolve(cwd, paths.fixturePath),
  };

  const result = runMigration({ paths: resolvedPaths, write });
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(`MIGRATION FAILED (${result.reason}): ${result.detail}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(
    `MIGRATION OK — appended ${result.appended} new Backlog entries; ` +
      `skipped ${result.skipped} already-migrated entries; ` +
      `removed ${result.roadmapRemovals} Roadmap items. ` +
      `Wrote: ${write}.`,
  );
}

// Run main() iff invoked directly (not when imported by tests).
// Bun sets import.meta.main = true for the entry script.
if (import.meta.main) {
  void main();
}
