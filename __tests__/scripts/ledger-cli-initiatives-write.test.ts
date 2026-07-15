/**
 * ledger-cli-initiatives-write.test.ts — initiatives + projects WRITE verbs
 * (ID-148.7, TECH §3.3 — Option C: server-side, no in-process writer).
 *
 * Every write verb (`create-project`, `update-project`, `delete-project`,
 * `link-tasks`/`unlink-tasks`, `link-backlog`/`unlink-backlog`, `move-task`/
 * `move-backlog`) is UNCONDITIONALLY server-routed since the ID-90.22 R1b
 * cutover — there is no in-process write path left to flag-toggle. These
 * tests drive the REAL `scripts/ledger-cli.ts` as a subprocess against a
 * REAL ephemeral task-view patch-server clone (`.cache/task-view-<tag>/`),
 * matching the `ledger-server-client.test.ts` "ID-90.25 flag-ON parity" harness
 * pattern — fetch/the server are NEVER mocked (test-philosophy: behaviour,
 * not implementation). Skipped when the clone is not provisioned locally
 * (`.cache/task-view-<tag>/apps/server/index.ts` absent); CI provisions it.
 *
 * Read-only verification after each write reuses the in-process `run()` (the
 * {148.6} local read verbs — `show project` / `list projects` — never touch
 * the server), which is safe to call immediately after a `spawnSync` mutation
 * returns: the server `await`s `atomicWriteFile` before responding, so the
 * on-disk bytes are settled by the time the subprocess exits.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';
import { resolveTag } from '@/scripts/ledger-server-lifecycle';

// __tests__/scripts/ -> repo root (works under both Vitest/Node and Bun;
// import.meta.dir is a Bun-only field and is undefined under Vitest).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLONE_TAG = (() => {
  try {
    return resolveTag(REPO_ROOT);
  } catch {
    return null;
  }
})();
const CLONE_PRESENT =
  CLONE_TAG !== null &&
  existsSync(
    resolve(REPO_ROOT, `.cache/task-view-${CLONE_TAG}/apps/server/index.ts`),
  );

const FIXTURE_LEDGER_DIR = resolve(__dirname, '../fixtures/ledger');

interface CliRun {
  exitCode: number;
  envelope: Record<string, unknown> | null;
}

/** Run the real ledger-cli against a fixture dir. Every mutating verb is
 * unconditionally server-routed post-R1b — no flag to thread. */
function runLedgerCli(ledgerDir: string, args: string[]): CliRun {
  const res = spawnSync(
    'bun',
    ['scripts/ledger-cli.ts', ...args, '--ledger-dir', ledgerDir],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30_000 },
  );
  const stdout = (res.stdout ?? '').trim();
  let envelope: Record<string, unknown> | null = null;
  try {
    envelope = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    // An {ok:false} envelope writes to STDERR (emit(): result.ok ? stdout :
    // stderr) — some sandboxed environments prepend an unrelated warning line
    // (e.g. a branding-colour contrast notice), so take the LAST
    // `{...}`-shaped line rather than the whole stream.
    const stderrLines = (res.stderr ?? '').trim().split('\n');
    const jsonLine = [...stderrLines]
      .reverse()
      .find((l) => l.trim().startsWith('{'));
    try {
      envelope = jsonLine
        ? (JSON.parse(jsonLine) as Record<string, unknown>)
        : null;
    } catch {
      envelope = null;
    }
  }
  return { exitCode: res.status ?? 1, envelope };
}

/** LOCAL read (no server) — safe to call right after a settled write. */
function localArgs(
  subcommand: string,
  positionals: string[],
  dir: string,
): ParsedArgs {
  return {
    subcommand,
    positionals,
    flags: {
      dryRun: false,
      pretty: false,
      regenMirrors: false,
      noRegenMirrors: true,
      ledgerDir: dir,
    },
  };
}

async function showProject(
  dir: string,
  slug: string,
): Promise<{
  status: string;
  linked_tasks: string[];
  linked_backlog: string[];
}> {
  const r = await run(localArgs('show', ['project', slug], dir));
  if (!r.ok) throw new Error(`show project ${slug} failed: ${r.error}`);
  return r.result as {
    status: string;
    linked_tasks: string[];
    linked_backlog: string[];
  };
}

async function listProjectSlugs(dir: string): Promise<string[]> {
  const r = await run(localArgs('list', ['projects'], dir));
  if (!r.ok) throw new Error(`list projects failed: ${r.error}`);
  const res = r.result as { records: { id: string }[] };
  return res.records.map((p) => p.id);
}

// Honour $TMPDIR (sandbox-writable); os.tmpdir() can report a blocked path.
const TMP_BASE = process.env.TMPDIR ?? tmpdir();
let fixtureRoots: string[] = [];

function fixtureDir(): string {
  const root = mkdtempSync(join(TMP_BASE, 'ledger-1487-'));
  cpSync(
    join(FIXTURE_LEDGER_DIR, 'initiatives.json'),
    join(root, 'initiatives.json'),
  );
  fixtureRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of fixtureRoots)
    rmSync(root, { recursive: true, force: true });
  fixtureRoots = [];
});

describe.skipIf(!CLONE_PRESENT)(
  'ID-148.7 initiatives write verbs (server-backed, real subprocess + real server)',
  () => {
    it(
      'create-project inserts under the addressed initiativePath (record-create, INV-13)',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const r = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          'fixture-write-new-project',
          '--title',
          'Fixture write-verb project',
        ]);
        expect(r.exitCode).toBe(0);
        expect(r.envelope?.ok).toBe(true);
        const result = r.envelope?.result as { recordId: string };
        expect(result.recordId).toBe('fixture-write-new-project');
      },
    );

    it(
      'create-project rejects a duplicate slug (409 duplicate-id, oracle pre-check)',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const r = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          'fixture-project-dirty-status',
          '--title',
          'Collides with an existing project slug',
        ]);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.ok).toBe(false);
        expect(r.envelope?.error).toBe('duplicate-id');
      },
    );

    it(
      'update-project <slug> status <value> writes a valid enum value',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        const r = runLedgerCli(dir, [
          'update-project',
          'fixture-nested-project',
          'status',
          'accepted',
        ]);
        expect(r.exitCode).toBe(0);
        expect(r.envelope?.ok).toBe(true);
        const after = await showProject(dir, 'fixture-nested-project');
        expect(after.status).toBe('accepted');
      },
    );

    it(
      'update-project <slug> status <invalid> rejects invalid-status BEFORE any request is sent (INV-3, client-side)',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
        const r = runLedgerCli(dir, [
          'update-project',
          'fixture-nested-project',
          'status',
          'not-a-real-status',
        ]);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.ok).toBe(false);
        expect(r.envelope?.error).toBe('invalid-status');
        // never reached the server — on-disk bytes untouched.
        expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(
          before,
        );
      },
    );

    it(
      'delete-project rejects project-not-empty while linked_tasks is non-empty, then succeeds after unlinking (INV-5)',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // fixture-project-dirty-status starts with linked_tasks:["1"].
        const rejected = runLedgerCli(dir, [
          'delete-project',
          'fixture-project-dirty-status',
        ]);
        expect(rejected.exitCode).toBe(1);
        expect(rejected.envelope?.ok).toBe(false);
        expect(rejected.envelope?.error).toBe('project-not-empty');

        const unlinked = runLedgerCli(dir, [
          'unlink-tasks',
          'fixture-project-dirty-status',
          '1',
        ]);
        expect(unlinked.exitCode).toBe(0);

        const deleted = runLedgerCli(dir, [
          'delete-project',
          'fixture-project-dirty-status',
        ]);
        expect(deleted.exitCode).toBe(0);
        expect(deleted.envelope?.ok).toBe(true);
        const slugs = await listProjectSlugs(dir);
        expect(slugs).not.toContain('fixture-project-dirty-status');
      },
    );

    it(
      'link-tasks / unlink-tasks set the full linked_tasks array (dedupe on link)',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // fixture-nested-project starts with linked_tasks:[].
        const linked = runLedgerCli(dir, [
          'link-tasks',
          'fixture-nested-project',
          '30',
          '31',
          '30', // duplicate — must dedupe
        ]);
        expect(linked.exitCode).toBe(0);
        const afterLink = await showProject(dir, 'fixture-nested-project');
        expect(afterLink.linked_tasks.sort()).toEqual(['30', '31']);

        const unlinked = runLedgerCli(dir, [
          'unlink-tasks',
          'fixture-nested-project',
          '30',
        ]);
        expect(unlinked.exitCode).toBe(0);
        const afterUnlink = await showProject(dir, 'fixture-nested-project');
        expect(afterUnlink.linked_tasks).toEqual(['31']);
      },
    );

    it(
      'link-backlog / unlink-backlog set the full linked_backlog array',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        const linked = runLedgerCli(dir, [
          'link-backlog',
          'fixture-project-dirty-status',
          '40',
        ]);
        expect(linked.exitCode).toBe(0);
        const after = await showProject(dir, 'fixture-project-dirty-status');
        expect(after.linked_backlog).toEqual(['40']);

        const unlinked = runLedgerCli(dir, [
          'unlink-backlog',
          'fixture-project-dirty-status',
          '40',
        ]);
        expect(unlinked.exitCode).toBe(0);
        const afterUnlink = await showProject(
          dir,
          'fixture-project-dirty-status',
        );
        expect(afterUnlink.linked_backlog).toEqual([]);
      },
    );

    it(
      'link-tasks against an initiative path (not a project slug) rejects links-project-only (INV-6)',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        // "4" is a top-level INITIATIVE id (with off-project transitional
        // links), not a project slug.
        const r = runLedgerCli(dir, ['link-tasks', '4', '99']);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.ok).toBe(false);
        expect(r.envelope?.error).toBe('links-project-only');
      },
    );

    it(
      'move-task atomically re-parents a task between two projects (INV-13, record-set delta ∅)',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // fixture-project-dirty-status: linked_tasks:["1"]; fixture-nested-project: linked_tasks:[].
        const before = await listProjectSlugs(dir);

        const r = runLedgerCli(dir, [
          'move-task',
          '1',
          '--from',
          'fixture-project-dirty-status',
          '--to',
          'fixture-nested-project',
        ]);
        expect(r.exitCode).toBe(0);
        expect(r.envelope?.ok).toBe(true);

        const fromAfter = await showProject(
          dir,
          'fixture-project-dirty-status',
        );
        const toAfter = await showProject(dir, 'fixture-nested-project');
        expect(fromAfter.linked_tasks).toEqual([]);
        expect(toAfter.linked_tasks).toEqual(['1']);

        // record-set delta ∅ — no project was added or removed by the move.
        const after = await listProjectSlugs(dir);
        expect(after.sort()).toEqual(before.sort());
      },
    );

    it(
      'move-backlog atomically re-parents a backlog id between two projects (INV-13, record-set delta ∅)',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // fixture-nested-project: linked_backlog:["1"]; fixture-project-dirty-status: linked_backlog:[].
        const before = await listProjectSlugs(dir);

        const r = runLedgerCli(dir, [
          'move-backlog',
          '1',
          '--from',
          'fixture-nested-project',
          '--to',
          'fixture-project-dirty-status',
        ]);
        expect(r.exitCode).toBe(0);

        const fromAfter = await showProject(dir, 'fixture-nested-project');
        const toAfter = await showProject(dir, 'fixture-project-dirty-status');
        expect(fromAfter.linked_backlog).toEqual([]);
        expect(toAfter.linked_backlog).toEqual(['1']);

        const after = await listProjectSlugs(dir);
        expect(after.sort()).toEqual(before.sort());
      },
    );

    it(
      'move-task on an id not linked to --from rejects not-linked, nothing written',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
        const r = runLedgerCli(dir, [
          'move-task',
          '999',
          '--from',
          'fixture-project-dirty-status',
          '--to',
          'fixture-nested-project',
        ]);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.error).toBe('not-linked');
        expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(
          before,
        );
      },
    );

    it(
      'create-project --dry-run writes nothing and reports {dryRun:true,...}',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
        const r = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          'fixture-dryrun-project',
          '--title',
          'Should never be written',
          '--dry-run',
        ]);
        expect(r.exitCode).toBe(0);
        expect(r.envelope?.ok).toBe(true);
        const result = r.envelope?.result as { dryRun: boolean };
        expect(result.dryRun).toBe(true);
        expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(
          before,
        );
      },
    );

    it(
      'create-project over the description budget rejects budget-exceeded; --force downgrades and writes',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const overBudget = 'x'.repeat(2000); // budget: project.description = 1500
        const rejected = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          'fixture-over-budget-project',
          '--title',
          'Over budget',
          '--description',
          overBudget,
        ]);
        expect(rejected.exitCode).toBe(1);
        expect(rejected.envelope?.ok).toBe(false);
        expect(rejected.envelope?.error).toBe('budget-exceeded');

        const forced = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          'fixture-over-budget-project',
          '--title',
          'Over budget',
          '--description',
          overBudget,
          '--force',
        ]);
        expect(forced.exitCode).toBe(0);
        expect(forced.envelope?.ok).toBe(true);
      },
    );
  },
);
