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

/** ID-156.7 — LOCAL read of one TOP-LEVEL initiative (`show initiatives <id>`,
 * {148.6}). Nested sub-initiative state is reached by drilling into the
 * returned doc's `'sub-initiatives'` array (no dedicated per-path show verb
 * exists). */
async function showInitiative(
  dir: string,
  id: string,
): Promise<Record<string, unknown>> {
  const r = await run(localArgs('show', ['initiatives', id], dir));
  if (!r.ok) throw new Error(`show initiatives ${id} failed: ${r.error}`);
  return r.result as Record<string, unknown>;
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
      // ID-156.6 gap (d), bl-468: a slug shaped like a bare digit-dotted
      // initiative/sub-initiative path (e.g. "4") would be misresolved as an
      // initiative path FIRST by resolveRecordId — permanently unreachable as
      // a project by id afterwards. Client-side create-time guard.
      'create-project rejects a digit-dotted-path-shaped slug BEFORE any request is sent (invalid-slug, client-side)',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
        const bareDigit = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          '4',
          '--title',
          'Should be rejected — collides with initiative-path shape',
        ]);
        expect(bareDigit.exitCode).toBe(1);
        expect(bareDigit.envelope?.ok).toBe(false);
        expect(bareDigit.envelope?.error).toBe('invalid-slug');

        const dottedPath = runLedgerCli(dir, [
          'create-project',
          '1',
          '--id',
          '4.2',
          '--title',
          'Should also be rejected — dotted path shape',
        ]);
        expect(dottedPath.exitCode).toBe(1);
        expect(dottedPath.envelope?.ok).toBe(false);
        expect(dottedPath.envelope?.error).toBe('invalid-slug');

        // never reached the server — on-disk bytes untouched.
        expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(
          before,
        );
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

    // ── ID-156.7 — update-initiative (initiative/sub-initiative twin of
    // update-project; S477 discovery: update-project's fieldPath is
    // project-only, so it walk-errors against an initiative path even though
    // the vendored server-side patch-apply already handles
    // ['initiatives', dottedPath, field]) ────────────────────────────────

    it(
      'update-initiative <topLevelPath> status <value> writes a valid enum value',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // fixture initiative "4" starts status:"active".
        const r = runLedgerCli(dir, [
          'update-initiative',
          '4',
          'status',
          'planned',
        ]);
        expect(r.exitCode).toBe(0);
        expect(r.envelope?.ok).toBe(true);
        const after = await showInitiative(dir, '4');
        expect(after.status).toBe('planned');
      },
    );

    it(
      'update-initiative <dottedSubPath> status <value> writes the nested sub-initiative',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // "1.1" -> initiative "1"'s first sub-initiative, starts status:"active".
        const r = runLedgerCli(dir, [
          'update-initiative',
          '1.1',
          'status',
          'completed',
        ]);
        expect(r.exitCode).toBe(0);
        expect(r.envelope?.ok).toBe(true);
        const parent = await showInitiative(dir, '1');
        const subs = parent['sub-initiatives'] as {
          id: string;
          status: string;
        }[];
        expect(subs.find((s) => s.id === '1')?.status).toBe('completed');
      },
    );

    it(
      'update-initiative <path> status <invalid> rejects invalid-status BEFORE any request is sent (INV-3, client-side)',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
        const r = runLedgerCli(dir, [
          'update-initiative',
          '4',
          'status',
          'not-a-real-status',
        ]);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.ok).toBe(false);
        expect(r.envelope?.error).toBe('invalid-status');
        expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(
          before,
        );
      },
    );

    it(
      'update-initiative against a project slug (not an initiative path) rejects initiatives-path-only, pointing to update-project',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const r = runLedgerCli(dir, [
          'update-initiative',
          'fixture-nested-project',
          'status',
          'planned',
        ]);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.ok).toBe(false);
        expect(r.envelope?.error).toBe('initiatives-path-only');
      },
    );

    it(
      'update-initiative against an unknown path rejects record-not-found, nothing written',
      { timeout: 20_000 },
      () => {
        const dir = fixtureDir();
        const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
        const r = runLedgerCli(dir, [
          'update-initiative',
          '999',
          'status',
          'planned',
        ]);
        expect(r.exitCode).toBe(1);
        expect(r.envelope?.error).toBe('record-not-found');
        expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(
          before,
        );
      },
    );

    it(
      'update-initiative 4 linked_tasks/linked_backlog [] empties the transitional off-project links (S477 immediate consumer, DR-074)',
      { timeout: 20_000 },
      async () => {
        const dir = fixtureDir();
        // fixture initiative "4" starts linked_tasks:["10","20"], linked_backlog:["5"]
        // — the same transitional shape as the live initiative-4 this verb
        // exists to redistribute-then-clear.
        const before = await showInitiative(dir, '4');
        expect(before.linked_tasks).toEqual(['10', '20']);
        expect(before.linked_backlog).toEqual(['5']);

        const tasksCleared = runLedgerCli(dir, [
          'update-initiative',
          '4',
          'linked_tasks',
          '[]',
        ]);
        expect(tasksCleared.exitCode).toBe(0);
        expect(tasksCleared.envelope?.ok).toBe(true);

        const backlogCleared = runLedgerCli(dir, [
          'update-initiative',
          '4',
          'linked_backlog',
          '[]',
        ]);
        expect(backlogCleared.exitCode).toBe(0);
        expect(backlogCleared.envelope?.ok).toBe(true);

        const after = await showInitiative(dir, '4');
        expect(after.linked_tasks).toEqual([]);
        expect(after.linked_backlog).toEqual([]);
      },
    );

    // {148.13} note: the test above proves only the CLI's client-side
    // pre-flight (`requireValidProjectStatus`, scripts/ledger-cli.ts) — this
    // CLI has no flag to bypass that check, so a CLI-driven end-to-end proof
    // of the SERVER rejecting an invalid status is not constructible from
    // this file without dedicated bypass plumbing (out of scope here). The
    // server-side half of INV-3 — now the AUTHORITATIVE enforcement point,
    // `requireValidProjectStatus` jsdoc updated to defense-in-depth framing —
    // is proven end-to-end (direct HTTP PATCH/POST, bypassing any CLI, both
    // rejection and acceptance, project + initiative nodes) upstream in
    // task-view's `packages/server/patch-server.test.ts` ("INV-3 status-enum
    // gate" describe blocks) and unit-tested in
    // `packages/server/gates/status-enum-gate.test.ts`.

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
