/**
 * ledger-cli-stdout-purity.test.ts — stdout JSON purity (ID-35.44).
 *
 * The ledger-CLI is the Orchestrator's only sanctioned ledger-write path and
 * its machine-readable envelope must be the SOLE stdout payload (a single-line
 * JSON object) so `ledger-cli … | jq` never throws and the `|| fallback` shell
 * idiom never silently RE-RUNS a mutation. Two coupled defects broke that:
 *
 *   (1) The default `regenRunner` spawned `bash scripts/regen-mirrors.sh` with
 *       `stdio: 'inherit'`. That script echoes many human/advisory lines to
 *       its stdout (`→ task-view: …`, `✎ mirrors regenerated …`), which with
 *       `inherit` land on the PARENT's stdout (fd1) and interleave with the
 *       JSON envelope. Regen is DEFAULT-ON after every write, so every mutating
 *       command leaked. FIX: route the child's stdout to the parent's stderr
 *       (`stdio: ['ignore', 2, 2]`).
 *
 *   (2) `commitMutation`'s `--dry-run` returned `result.document = detected.data`
 *       — the whole 34-67 KB ledger document. FIX: return the bounded
 *       `resultPayload` (the same shape the live write emits), tagged
 *       `dryRun: true`.
 *
 * The faithful regen-on path is exercised by spawning the CLI as a REAL
 * subprocess in a temp cwd whose `scripts/regen-mirrors.sh` is a STUB that
 * echoes to stdout — the parent's captured stdout must be exactly ONE
 * `JSON.parse`-able object. The in-process tests cover the dry-run bounding via
 * the `__setRegenRunnerForTest` seam.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  run,
  __setRegenRunnerForTest,
  type ParsedArgs,
} from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const CLI = join(REPO, 'scripts/ledger-cli.ts');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

/**
 * A stub regen script that mimics `regen-mirrors.sh`'s stdout chatter — bare
 * `echo`s go to stdout, exactly the bytes that polluted the envelope under the
 * old `stdio: 'inherit'`. The fix must keep these off the parent's stdout.
 */
const STUB_REGEN = `#!/usr/bin/env bash
echo "→ task-view: tag=stub"
echo "→ cloning task-view…"
echo "✎ mirrors regenerated — review + stage…"
exit 0
`;

/** Spawn the CLI in a temp cwd; returns separated stdout/stderr. */
function runCli(
  ledgerDir: string,
  cwd: string,
  cmd: string[],
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('bun', [CLI, ...cmd, '--ledger-dir', ledgerDir], {
    cwd,
    encoding: 'utf8',
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

describe('ledger-cli stdout purity — faithful regen-on subprocess (ID-35.44 defect 1)', () => {
  let ledgerDir: string;
  let cwd: string;
  let taskId: string;
  let subId: string;

  beforeEach(() => {
    // Temp ledger (NEVER mutate docs/reference/*.json).
    ledgerDir = mkdtempSync(join(tmpdir(), 'ledger-purity-ledger-'));
    copyFileSync(REAL.task, join(ledgerDir, 'task-list.json'));
    copyFileSync(REAL.roadmap, join(ledgerDir, 'product-roadmap.json'));
    copyFileSync(REAL.backlog, join(ledgerDir, 'product-backlog.json'));

    // Temp cwd with a stub `scripts/regen-mirrors.sh` echoing to stdout. The
    // production `regenRunner` shells `bash scripts/regen-mirrors.sh` relative
    // to cwd, so this stub shadows the real (task-view-cloning) script.
    cwd = mkdtempSync(join(tmpdir(), 'ledger-purity-cwd-'));
    mkdirSync(join(cwd, 'scripts'), { recursive: true });
    const stub = join(cwd, 'scripts/regen-mirrors.sh');
    writeFileSync(stub, STUB_REGEN);
    chmodSync(stub, 0o755);

    const doc = JSON.parse(
      readFileSync(join(ledgerDir, 'task-list.json'), 'utf8'),
    );
    taskId = String(doc.tasks[0].id);
    subId = String(doc.tasks[0].subtasks[0].id);
  });

  afterEach(() => {
    rmSync(ledgerDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('a mutating command with regen DEFAULT-ON emits exactly one JSON object on stdout', () => {
    const { stdout, stderr, status } = runCli(ledgerDir, cwd, [
      'flip-subtask',
      taskId,
      subId,
      'pending',
    ]);
    expect(status).toBe(0);

    // stdout is a SINGLE JSON object — parse the whole thing, no leading or
    // trailing human lines. This is the `cmd | jq` contract.
    const trimmed = stdout.trim();
    expect(trimmed.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(trimmed);
    expect(parsed.ok).toBe(true);
    expect(parsed.subcommand).toBe('flip-subtask');

    // The stub's regen chatter landed on STDERR, not stdout.
    expect(stdout).not.toContain('mirrors regenerated');
    expect(stdout).not.toContain('task-view');
    expect(stderr).toContain('mirrors regenerated');
  });

  it('regen chatter never appears on stdout (defect-1 regression guard)', () => {
    const { stdout } = runCli(ledgerDir, cwd, [
      'flip-subtask',
      taskId,
      subId,
      'pending',
    ]);
    // Every stub stdout line must be absent from the parent's stdout.
    for (const needle of ['→ task-view', 'cloning task-view', '✎ mirrors']) {
      expect(stdout).not.toContain(needle);
    }
  });
});

describe('ledger-cli stdout purity — --no-regen-mirrors subprocess pipe (ID-35.44)', () => {
  let ledgerDir: string;
  let taskId: string;
  let subId: string;

  beforeEach(() => {
    ledgerDir = mkdtempSync(join(tmpdir(), 'ledger-purity-norgn-'));
    copyFileSync(REAL.task, join(ledgerDir, 'task-list.json'));
    copyFileSync(REAL.roadmap, join(ledgerDir, 'product-roadmap.json'));
    copyFileSync(REAL.backlog, join(ledgerDir, 'product-backlog.json'));
    const doc = JSON.parse(
      readFileSync(join(ledgerDir, 'task-list.json'), 'utf8'),
    );
    taskId = String(doc.tasks[0].id);
    subId = String(doc.tasks[0].subtasks[0].id);
  });
  afterEach(() => {
    rmSync(ledgerDir, { recursive: true, force: true });
  });

  it('a mutating command with --no-regen-mirrors emits pure single-object JSON on stdout', () => {
    const r = spawnSync(
      'bun',
      [
        CLI,
        'flip-subtask',
        taskId,
        subId,
        'pending',
        '--no-regen-mirrors',
        '--ledger-dir',
        ledgerDir,
      ],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const trimmed = (r.stdout ?? '').trim();
    expect(trimmed.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(trimmed);
    expect(parsed.ok).toBe(true);
    // The structured `mirrorStaleReason` lives INSIDE the JSON envelope (a
    // machine field), but the human-facing reminder PROSE goes to stderr only.
    expect(r.stdout).not.toContain('mirror regen suppressed');
    expect(r.stderr).toContain('mirror regen suppressed');
  });
});

describe('ledger-cli --dry-run is bounded (ID-35.44 defect 2)', () => {
  let dir: string;
  let regenSpy: ReturnType<typeof vi.fn<() => number | null>>;

  function args(
    subcommand: string,
    positionals: string[],
    extra: Partial<ParsedArgs['flags']> = {},
  ): ParsedArgs {
    return {
      subcommand,
      positionals,
      flags: {
        dryRun: false,
        pretty: false,
        regenMirrors: false,
        scoped: false,
        ledgerDir: dir,
        ...extra,
      },
    };
  }
  function read() {
    return JSON.parse(readFileSync(join(dir, 'task-list.json'), 'utf8'));
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ledger-purity-dry-'));
    copyFileSync(REAL.task, join(dir, 'task-list.json'));
    copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
    copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
    regenSpy = vi.fn<() => number | null>(() => 0);
    __setRegenRunnerForTest(regenSpy);
  });
  afterEach(() => {
    __setRegenRunnerForTest(null);
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('a generic-path dry-run returns the bounded resultPayload, NOT the full document', async () => {
    const taskId = String(read().tasks[0].id);
    const subId = String(read().tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'pending'], { dryRun: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as Record<string, unknown>;
    expect(result.dryRun).toBe(true);
    // The whole-document dump must be gone (the {35.30}-bounded shape only).
    expect(result).not.toHaveProperty('document');
    // The bounded payload mirrors the live-write shape: flip-subtask passes
    // { taskId, subId, status }.
    expect(result).toHaveProperty('taskId');
    expect(result).toHaveProperty('status');
    // Nothing was written (dry-run), so regen never ran.
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('the serialised dry-run envelope stays small — no 34-67 KB ledger dump', async () => {
    const taskId = String(read().tasks[0].id);
    const subId = String(read().tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'pending'], { dryRun: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bytes = JSON.stringify(r.result).length;
    // A bounded payload is a few hundred bytes; the old full-document dump was
    // tens of kilobytes. 2 KB is a generous ceiling.
    expect(bytes).toBeLessThan(2_048);
  });
});
