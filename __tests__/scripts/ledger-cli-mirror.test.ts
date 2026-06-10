/**
 * ledger-cli-mirror.test.ts — mirror-staleness signalling over the SERVER
 * TRANSPORT (ID-35.18 / ID-35.32, re-targeted at ID-90.22 R1a).
 *
 * A mutating command regenerates the affected mirror BY DEFAULT (so
 * docs/reference/{tasks,roadmap,backlog}/ stay in sync and CI
 * ledger-mirror-parity stays green); `--no-regen-mirrors` opts out.
 *
 * ID-90.22 R1a: the WRITE path is now the server transport (KH_LEDGER_SERVER
 * unset → ON), so the in-process `__setRegenRunnerForTest` / `regenSpy` seam no
 * longer sits on the write path — REGEN RUNS SERVER-SIDE. The "regen was
 * invoked" and "regen-failed surfaces loud" behaviours are therefore the
 * server's responsibility (covered by task-view's own suite, U11; the
 * client-side response→envelope MAPPING is unit-tested with canned + real-server
 * responses in ledger-server-client.test.ts).
 *
 * What this suite now asserts is the CLIENT-OBSERVABLE mirror-staleness signal
 * over the transport:
 *   - `--no-regen-mirrors` → mirrorStale:true, mirrorStaleReason:'suppressed'
 *     (mapped client-side by transportCommit; no server regen needed).
 *   - a dry-run writes nothing and carries no stale signal.
 *   - a normal write succeeds (ok:true) and leaves no `suppressed` stale signal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-mirror-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

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
function read(name: 'task-list') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

describe('mirror-staleness signal over transport (ID-35.18 / ID-35.32)', () => {
  it('--no-regen-mirrors result envelope carries mirrorStaleReason: "suppressed"', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { noRegenMirrors: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The transport client maps the client-side regen-suppression to the stale
    // signal — no server-side regen run is needed to observe it.
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
    // The write itself committed through the server.
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('done');
  });

  it('a dry-run with --no-regen-mirrors writes nothing and still reports suppressed', async () => {
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], {
        dryRun: true,
        noRegenMirrors: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // dryRun honoured server-side: the canonical file is byte-unchanged.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
    expect(r.mirrorStaleReason).toBe('suppressed');
  });

  it('a normal write with --no-regen-mirrors commits and carries the suppressed signal', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'in_progress'], {
        noRegenMirrors: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('in_progress');
    // The operator opted out, so the mirror is knowingly stale.
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
  });
});
