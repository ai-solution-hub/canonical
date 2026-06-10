/**
 * ledger-cli-stdout-purity.test.ts — stdout JSON purity (ID-35.44).
 *
 * The ledger-CLI is the Orchestrator's only sanctioned ledger-write path and
 * its machine-readable envelope must be the SOLE stdout payload (a single-line
 * JSON object) so `ledger-cli … | jq` never throws and the `|| fallback` shell
 * idiom never silently RE-RUNS a mutation.
 *
 * ID-90.22 R1a: the WRITE path is now the SERVER TRANSPORT (KH_LEDGER_SERVER
 * unset → ON). Mirror regen runs SERVER-SIDE, so the in-process
 * `__setRegenRunnerForTest` / `regenSpy` seam (and the temp-cwd
 * `regen-mirrors.sh` STUB that shadowed the in-process shell-out) no longer sit
 * on the write path — the regen-DEFAULT-ON stdout-leak guard is now the
 * server's responsibility (the server pipes its child's stdout to stderr; inv
 * 13). What this suite asserts post-cutover:
 *   - a REAL server-routed write (`--no-regen-mirrors`) emits exactly ONE
 *     JSON-parseable object on stdout, with the human reminder PROSE on stderr.
 *   - `--dry-run` is BOUNDED: the envelope carries the small `resultPayload`
 *     (tagged `dryRun:true`), never the 34-67 KB whole-document dump, and the
 *     server writes nothing (defect-2 regression guard, asserted over transport).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const CLI = join(REPO, 'scripts/ledger-cli.ts');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

describe('ledger-cli stdout purity — real server-routed write (ID-35.44)', () => {
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
    // KH_LEDGER_SERVER unset → ON: this drives the REAL ledger-cli through the
    // server transport (ensureServer spawns an ephemeral task-view server for
    // the scratch ledger dir). The envelope is the SOLE stdout payload.
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
    expect(parsed.subcommand).toBe('flip-subtask');
    // The structured `mirrorStaleReason` lives INSIDE the JSON envelope (a
    // machine field), but the human-facing reminder PROSE goes to stderr only.
    expect(r.stdout).not.toContain('mirror regen suppressed');
    expect(r.stderr).toContain('mirror regen suppressed');
  });
});

describe('ledger-cli --dry-run is bounded (ID-35.44 defect 2)', () => {
  let dir: string;

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
        noRegenMirrors: true,
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
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a generic-path dry-run returns the bounded resultPayload, NOT the full document', async () => {
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
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
    // Nothing was written (server honoured dryRun) — file byte-unchanged.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
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
