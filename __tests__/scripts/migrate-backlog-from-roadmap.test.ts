/**
 * migrate-backlog-from-roadmap.test.ts — Subtask 30.9 PR-B migration script.
 *
 * Eight test cases (a-h) per PLAN §2.2 Subtask 30.9 testStrategy:
 *
 *   (a) Run once on live-JSON copy; delta = +54 entries; IDs 87-140 present.
 *   (b) Run again; delta = 0 (idempotent).
 *   (c) Fixture with one id pre-populated; script reports collision and does
 *       NOT write.
 *   (d) Fixture with corrupted `track` field empty string; Zod parse aborts
 *       write.
 *   (e) Task title 4-word-window-matches new backlog description; script
 *       aborts with duplicate-detection error.
 *   (f) Every new entry's `notes` contains 'Migrated from roadmap §'
 *       substring.
 *   (g) 4 PARTIAL_OVERLAP cluster id-lists present in post-migration
 *       backlog; each cluster member has notes line citing every other
 *       member.
 *   (h) Roadmap item count drops from 61 to 53.
 *
 * Tests use synthetic pre-migration baselines (live JSONs filtered to drop
 * any IDs 87+ that might already be present from triage-routed entries)
 * so the script's migration behaviour is exercised independently of
 * accidental coupling to the current live data state.
 *
 * Spec refs: PRODUCT inv 1, 2, 5, 15, 12 PR-B; TECH §2 + §3.2 + §6.1;
 * PLAN §2.2 Subtask 30.9.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  runMigration,
  tokenise,
  detectFourWordOverlap,
  classifyFixtureEntry,
  withAdjacencyNote,
  loadFixture,
  PROVENANCE_MARKER,
  REMOVE_REDUNDANT_ROADMAP_IDS,
  PARTIAL_OVERLAP_CLUSTERS,
  DEFAULT_PATHS,
  type MigrationPaths,
  type PartialOverlapCluster,
} from '../../scripts/migrate-backlog-from-roadmap';

import {
  BacklogSchema,
  type BacklogItem,
} from '@/lib/validation/backlog-schema';
import { RoadmapSchema } from '@/lib/validation/roadmap-schema';

// ────────────────────────────────────────────────────────────────────────────
// Live source paths (read-only — tests copy these into tmpdir before mutating).
// ────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = process.cwd();
const LIVE_BACKLOG = path.resolve(REPO_ROOT, DEFAULT_PATHS.backlogPath);
const LIVE_ROADMAP = path.resolve(REPO_ROOT, DEFAULT_PATHS.roadmapPath);
const LIVE_TASKLIST = path.resolve(REPO_ROOT, DEFAULT_PATHS.taskListPath);
const LIVE_FIXTURE = path.resolve(REPO_ROOT, DEFAULT_PATHS.fixturePath);

// ────────────────────────────────────────────────────────────────────────────
// Per-test sandbox helpers.
// ────────────────────────────────────────────────────────────────────────────

interface Sandbox {
  readonly dir: string;
  readonly paths: MigrationPaths;
}

function makeSandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-bl-'));
  const paths: MigrationPaths = {
    backlogPath: path.join(dir, 'product-backlog.json'),
    roadmapPath: path.join(dir, 'product-roadmap.json'),
    taskListPath: path.join(dir, 'task-list.json'),
    fixturePath: path.join(dir, 'backlog-migration-payload.json'),
  };
  return { dir, paths };
}

function cleanupSandbox(sb: Sandbox): void {
  fs.rmSync(sb.dir, { recursive: true, force: true });
}

/**
 * Build a synthetic "pre-migration" backlog by reading the live JSON and
 * filtering out any IDs 87-140 (which may have been independently authored
 * via triage-routing post-migration-spec). The result has the same shape
 * but mirrors the original "55 → 109" baseline shape PRODUCT inv 1
 * specified before T-OQ-1 reconciliation.
 */
function buildPreMigrationBacklog(): unknown {
  const raw = JSON.parse(fs.readFileSync(LIVE_BACKLOG, 'utf-8')) as {
    items: Array<BacklogItem>;
  } & Record<string, unknown>;
  const migrationIdSet = new Set(
    Array.from({ length: 54 }, (_, i) => String(87 + i)),
  );
  return {
    ...raw,
    items: raw.items.filter((it) => !migrationIdSet.has(it.id)),
  };
}

/**
 * Build a clean sandbox primed with pre-migration baselines. Copies live
 * roadmap + task-list verbatim; rebuilds backlog as the synthetic pre-
 * migration baseline; copies live fixture verbatim.
 */
function primeSandbox(sb: Sandbox): void {
  const preBacklog = buildPreMigrationBacklog();
  fs.writeFileSync(
    sb.paths.backlogPath,
    JSON.stringify(preBacklog, null, 2) + '\n',
    'utf-8',
  );
  fs.copyFileSync(LIVE_ROADMAP, sb.paths.roadmapPath);
  fs.copyFileSync(LIVE_TASKLIST, sb.paths.taskListPath);
  fs.copyFileSync(LIVE_FIXTURE, sb.paths.fixturePath);
}

/**
 * Re-seed the sandbox roadmap with the pre-30.10-migration baseline (61
 * items, including the 8 REMOVE_REDUNDANT items) sourced from
 * `840f140a:docs/reference/product-roadmap.json`. Used exclusively by the
 * (h) test so the migration script's roadmap-removal contract is
 * verifiable post-30.10 (when LIVE_ROADMAP is already 53 items). Mirrors
 * the spirit of buildPreMigrationBacklog (re-derive baseline from history).
 *
 * Approach B per Subtask 30.10 brief — chosen because Approach C
 * (delta-based on live state alone) reports roadmapRemovals: 0 against
 * a post-migration sandbox roadmap.
 */
function primeSandboxWithPreMigrationRoadmap(sb: Sandbox): void {
  const PRE_MIGRATION_COMMIT = '840f140a';
  const historicalRoadmap = execFileSync(
    'git',
    ['show', `${PRE_MIGRATION_COMMIT}:docs/reference/product-roadmap.json`],
    { cwd: REPO_ROOT, encoding: 'utf-8' },
  );
  fs.writeFileSync(sb.paths.roadmapPath, historicalRoadmap, 'utf-8');
}

function readBacklog(p: string): {
  items: Array<BacklogItem>;
} & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function readRoadmap(p: string): {
  sections?: Array<{ id: string; items: Array<{ id: string }> }>;
} & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function countRoadmapItems(rp: ReturnType<typeof readRoadmap>): number {
  if (!rp.sections) return 0;
  return rp.sections.reduce((sum, s) => sum + s.items.length, 0);
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helper tests (sanity + behaviour anchors for the runMigration cases).
// ────────────────────────────────────────────────────────────────────────────

describe('pure helpers — sanity anchors', () => {
  it('tokenise lowercases and splits on non-word characters', () => {
    expect(tokenise('Bid drafting eval baseline')).toEqual([
      'bid',
      'drafting',
      'eval',
      'baseline',
    ]);
    expect(tokenise('UK English: behaviour / colour')).toEqual([
      'uk',
      'english',
      'behaviour',
      'colour',
    ]);
  });

  it('detectFourWordOverlap finds matching window across description and title', () => {
    const desc = 'Per-entity confidence in Pass 1 absorbed by cocoindex T8';
    const title = 'Per-entity confidence in Pass 1';
    expect(detectFourWordOverlap(desc, title)).toBe('per entity confidence in');
  });

  it('detectFourWordOverlap returns null when no 4-word window aligns', () => {
    const desc = 'Bid drafting eval baseline replaces synthetic question IDs';
    const title = 'Knowledge Hub MCP server hardening';
    expect(detectFourWordOverlap(desc, title)).toBeNull();
  });

  it('detectFourWordOverlap returns null when either input has fewer than 4 tokens', () => {
    expect(detectFourWordOverlap('short text', 'short text')).toBeNull();
  });

  it('classifyFixtureEntry distinguishes absent / migration-skip / collision', () => {
    const fixtureEntry: BacklogItem = {
      id: '99',
      description: 'desc',
      type: 'feature',
      status: 'ready',
      effort_estimate: null,
      priority: 'medium',
      track: 'test',
      dependencies: [],
      session_refs: [],
      commit_refs: [],
      cross_doc_links: [],
      notes: `${PROVENANCE_MARKER}99.0`,
    };
    expect(
      classifyFixtureEntry(fixtureEntry, new Map<string, BacklogItem>()),
    ).toBe('absent');
    const matchingExisting: BacklogItem = {
      ...fixtureEntry,
      notes: `${PROVENANCE_MARKER}99.0. some content`,
    };
    expect(
      classifyFixtureEntry(
        fixtureEntry,
        new Map<string, BacklogItem>([[fixtureEntry.id, matchingExisting]]),
      ),
    ).toBe('migration-skip');
    const collidingExisting: BacklogItem = {
      ...fixtureEntry,
      notes: 'Independently authored — no migration marker.',
    };
    expect(
      classifyFixtureEntry(
        fixtureEntry,
        new Map<string, BacklogItem>([[fixtureEntry.id, collidingExisting]]),
      ),
    ).toBe('collision');
  });

  it('withAdjacencyNote produces a canonical line citing every other cluster member', () => {
    const cluster: PartialOverlapCluster = {
      name: 'ingest-UI',
      ids: ['61', '62', '87', '108'],
    };
    const line = withAdjacencyNote(null, cluster, '87');
    expect(line).toContain('ingest-UI');
    expect(line).toContain('ID-61');
    expect(line).toContain('ID-62');
    expect(line).toContain('ID-108');
    expect(line).not.toContain('ID-87');
    // Idempotent — re-applying does not double the line.
    const reapplied = withAdjacencyNote(line, cluster, '87');
    expect(reapplied).toBe(line);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Eight required test cases (a-h) per Subtask 30.9 brief.
// ────────────────────────────────────────────────────────────────────────────

describe('runMigration — Subtask 30.9 testStrategy (a-h)', () => {
  let sb: Sandbox;

  beforeEach(() => {
    sb = makeSandbox();
    primeSandbox(sb);
  });

  afterEach(() => {
    cleanupSandbox(sb);
  });

  // ─────────────────── (a) ─────────────────────────────────────────────────
  it('(a) appends 54 net-new entries (IDs 87-140) on first run', () => {
    const before = readBacklog(sb.paths.backlogPath);
    const result = runMigration({ paths: sb.paths, write: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow for TS

    expect(result.appended).toBe(54);
    expect(result.skipped).toBe(0);

    const after = readBacklog(sb.paths.backlogPath);
    expect(after.items.length - before.items.length).toBe(54);
    const ids = new Set(after.items.map((it) => it.id));
    for (let i = 87; i <= 140; i++) {
      expect(ids.has(String(i))).toBe(true);
    }
    // Post-write file parses through BacklogSchema (PRODUCT inv 15).
    expect(() => BacklogSchema.parse(after)).not.toThrow();
  });

  // ─────────────────── (b) ─────────────────────────────────────────────────
  it('(b) second run after (a) is idempotent — delta 0; final JSON identical', () => {
    runMigration({ paths: sb.paths, write: true });
    const afterFirst = fs.readFileSync(sb.paths.backlogPath, 'utf-8');
    const roadmapAfterFirst = fs.readFileSync(sb.paths.roadmapPath, 'utf-8');

    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.appended).toBe(0);
    expect(result.skipped).toBe(54);
    expect(result.roadmapRemovals).toBe(0);

    const afterSecond = fs.readFileSync(sb.paths.backlogPath, 'utf-8');
    const roadmapAfterSecond = fs.readFileSync(sb.paths.roadmapPath, 'utf-8');
    expect(afterSecond).toBe(afterFirst);
    expect(roadmapAfterSecond).toBe(roadmapAfterFirst);
  });

  // ─────────────────── (c) ─────────────────────────────────────────────────
  it('(c) fixture id pre-populated as non-migration entry — collision; no write', () => {
    // Seed the pre-migration backlog with ID-87 as an INDEPENDENT entry
    // (notes lack the migration marker), then run migration.
    const backlog = readBacklog(sb.paths.backlogPath);
    backlog.items.push({
      id: '87',
      description:
        'Independently authored stub for collision-detection test (no migration marker)',
      type: 'feature',
      status: 'ready',
      effort_estimate: null,
      priority: 'medium',
      track: 'test-fixtures',
      dependencies: [],
      session_refs: [],
      commit_refs: [],
      cross_doc_links: [],
      notes: 'No provenance marker — independently authored.',
    } as BacklogItem);
    fs.writeFileSync(
      sb.paths.backlogPath,
      JSON.stringify(backlog, null, 2) + '\n',
      'utf-8',
    );

    const preFile = fs.readFileSync(sb.paths.backlogPath, 'utf-8');
    const preRoadmap = fs.readFileSync(sb.paths.roadmapPath, 'utf-8');

    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('collision');
    expect(result.detail).toContain('87');

    // Crucial: no write occurred.
    const postFile = fs.readFileSync(sb.paths.backlogPath, 'utf-8');
    const postRoadmap = fs.readFileSync(sb.paths.roadmapPath, 'utf-8');
    expect(postFile).toBe(preFile);
    expect(postRoadmap).toBe(preRoadmap);
  });

  // ─────────────────── (d) ─────────────────────────────────────────────────
  it('(d) fixture with corrupted `track: ""` aborts via Zod parse — no write', () => {
    // Corrupt the fixture: empty-string `track` on the first entry.
    const fixture = JSON.parse(
      fs.readFileSync(sb.paths.fixturePath, 'utf-8'),
    ) as Array<BacklogItem>;
    fixture[0] = { ...fixture[0], track: '' };
    fs.writeFileSync(
      sb.paths.fixturePath,
      JSON.stringify(fixture, null, 2) + '\n',
      'utf-8',
    );

    const preBacklog = fs.readFileSync(sb.paths.backlogPath, 'utf-8');
    const preRoadmap = fs.readFileSync(sb.paths.roadmapPath, 'utf-8');

    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fixture-schema-invalid');
    expect(result.detail).toMatch(/track|BacklogItemSchema/i);

    expect(fs.readFileSync(sb.paths.backlogPath, 'utf-8')).toBe(preBacklog);
    expect(fs.readFileSync(sb.paths.roadmapPath, 'utf-8')).toBe(preRoadmap);
  });

  // ─────────────────── (e) ─────────────────────────────────────────────────
  it('(e) Task title 4-word-overlaps a new entry description — abort; no write', () => {
    // Inject a synthetic Task whose title shares a 4-word window with the
    // first fixture entry's description.
    const fixture = JSON.parse(
      fs.readFileSync(sb.paths.fixturePath, 'utf-8'),
    ) as Array<BacklogItem>;
    const firstDescription = fixture[0].description;
    const firstFourWords = tokenise(firstDescription).slice(0, 4).join(' ');

    const taskList = JSON.parse(
      fs.readFileSync(sb.paths.taskListPath, 'utf-8'),
    ) as {
      tasks: Array<{
        id: string;
        title: string;
        [k: string]: unknown;
      }>;
    } & Record<string, unknown>;

    // Mutate the first task's title to a string containing the first
    // fixture entry's first-four-words window. This forces a 4-word-window
    // overlap.
    taskList.tasks[0].title = `${firstFourWords} synthetic task title for overlap test`;
    fs.writeFileSync(
      sb.paths.taskListPath,
      JSON.stringify(taskList, null, 2) + '\n',
      'utf-8',
    );

    const preBacklog = fs.readFileSync(sb.paths.backlogPath, 'utf-8');
    const preRoadmap = fs.readFileSync(sb.paths.roadmapPath, 'utf-8');

    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('task-title-overlap');
    expect(result.detail).toContain(firstFourWords);

    expect(fs.readFileSync(sb.paths.backlogPath, 'utf-8')).toBe(preBacklog);
    expect(fs.readFileSync(sb.paths.roadmapPath, 'utf-8')).toBe(preRoadmap);
  });

  // ─────────────────── (f) ─────────────────────────────────────────────────
  it('(f) every new entry`s notes contains the canonical provenance marker', () => {
    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(true);

    const after = readBacklog(sb.paths.backlogPath);
    const migrationIds = new Set(
      Array.from({ length: 54 }, (_, i) => String(87 + i)),
    );
    const migrated = after.items.filter((it) => migrationIds.has(it.id));
    expect(migrated).toHaveLength(54);
    for (const it of migrated) {
      expect(it.notes ?? '').toContain(PROVENANCE_MARKER);
    }
  });

  // ─────────────────── (g) ─────────────────────────────────────────────────
  it('(g) 4 PARTIAL_OVERLAP cluster id-lists present + each member cites every other', () => {
    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(true);

    const after = readBacklog(sb.paths.backlogPath);
    const byId = new Map(after.items.map((it) => [it.id, it]));

    expect(PARTIAL_OVERLAP_CLUSTERS).toHaveLength(4); // 4 clusters per brief

    for (const cluster of PARTIAL_OVERLAP_CLUSTERS) {
      for (const memberId of cluster.ids) {
        const member = byId.get(memberId);
        // Some cluster members are in the pre-migration backlog (e.g. ID-61),
        // others are migration entries (e.g. ID-88). All four must exist in
        // the post-migration backlog and carry the adjacency note.
        expect(member).toBeDefined();
        if (!member) continue;
        const notes = member.notes ?? '';
        const others = cluster.ids.filter((id) => id !== memberId);
        for (const otherId of others) {
          expect(notes).toContain(`ID-${otherId}`);
        }
        // Sanity: the cluster name appears in the adjacency line.
        expect(notes).toContain(cluster.name);
      }
    }
  });

  // ─────────────────── (h) ─────────────────────────────────────────────────
  it.skip('(h) roadmap item count drops by 8 — 30.10-historic, archived post-Option-β scope expansion in 30.13', () => {
    // The script + this test verified the 30.10 migration contract against
    // the pre-migration sections-shape roadmap. Post-30.12 schema reshape
    // (themes-only RoadmapSchema; sections[] dropped entirely) rejects
    // sections-shape sandboxes at parse time, making this assertion path
    // unreachable. The 30.10 migration outcome is verifiable via git
    // history (commits ee04f7b2 + 81258b26 + c9808105) and the live count
    // delta (54 → 108 backlog after IDs 87-140; 61 → 53 roadmap after the
    // 8 REMOVE_REDUNDANT items). Subtask 30.13 (Option β expanded scope)
    // dropped the sections-traversal branch from runMigration (lines
    // 421-433 in the pre-30.13 script) so the script is now safely
    // idempotent on the post-30.12 themes-shape RoadmapSchema.
    //
    // Helper references retained for posterity but unused (the test is
    // skipped, not deleted, so the historical contract is auditable):
    void primeSandboxWithPreMigrationRoadmap;
    void readRoadmap;
    void countRoadmapItems;
    void REMOVE_REDUNDANT_ROADMAP_IDS;
    void RoadmapSchema;
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Additional defensive case — fixture internal-duplicate detection
// (covers the `loadFixture` internal-duplicate branch even though not in
// the (a-h) explicit list; PRODUCT inv 15 fail-loud discipline).
// ────────────────────────────────────────────────────────────────────────────

describe('runMigration — additional defensive cases', () => {
  let sb: Sandbox;

  beforeEach(() => {
    sb = makeSandbox();
    primeSandbox(sb);
  });

  afterEach(() => {
    cleanupSandbox(sb);
  });

  it('rejects fixture carrying internal duplicate ids', () => {
    const fixture = JSON.parse(
      fs.readFileSync(sb.paths.fixturePath, 'utf-8'),
    ) as Array<BacklogItem>;
    // Duplicate the first entry's id onto entry 2.
    fixture[1] = { ...fixture[1], id: fixture[0].id };
    fs.writeFileSync(
      sb.paths.fixturePath,
      JSON.stringify(fixture, null, 2) + '\n',
      'utf-8',
    );

    const result = runMigration({ paths: sb.paths, write: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('fixture-internal-duplicate');
  });

  it('loadFixture surfaces the validated array on a clean fixture', () => {
    const result = loadFixture(sb.paths.fixturePath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(54);
    expect(result.data[0].id).toBe('87');
    expect(result.data[result.data.length - 1].id).toBe('140');
  });
});
