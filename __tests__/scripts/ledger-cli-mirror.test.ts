/**
 * ledger-cli-mirror.test.ts — mirror-staleness signalling over the SERVER
 * TRANSPORT (ID-35.18 / ID-35.32, re-targeted at ID-90.22 R1a).
 *
 * A mutating command regenerates the affected mirror BY DEFAULT (so
 * docs/reference/{tasks,backlog,initiatives,retros}/ stay in sync);
 * `--no-regen-mirrors` opts out.
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
 *
 * ID-148.12 (supersedes ID-148.9): the KH-native `generate-initiatives-mirror.ts`
 * / `generate-retros-mirror.ts` scripts + their direct-generator-run tests are
 * DELETED — task-view's mirror-generator gained an initiatives arm (nested
 * render, repurposed roadmap arm) + a retros arm at {148.10}, so initiatives
 * and retros mirrors now regenerate SERVER-SIDE via the identical `--check`
 * one-shot mechanism as task-list/backlog (covered by task-view's own suite,
 * same U11 rationale as the transport-write regen above — not re-tested here).
 * `regen-mirrors.sh`'s wiring (four `--check` invocations, no generator-script
 * calls) is asserted below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

// ID-68.35: repointed from docs/reference/ live ledgers to synthetic fixtures.
const FIXTURES = {
  task: resolve(__dirname, '../fixtures/ledger/task-list.json'),
  roadmap: resolve(__dirname, '../fixtures/ledger/product-roadmap.json'),
  backlog: resolve(__dirname, '../fixtures/ledger/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-mirror-'));
  copyFileSync(FIXTURES.task, join(dir, 'task-list.json'));
  copyFileSync(FIXTURES.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(FIXTURES.backlog, join(dir, 'product-backlog.json'));
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

describe('regen-mirrors.sh wiring (ID-148.12, supersedes ID-148.9)', () => {
  it('is wired to task-view --check for all four ledgers, not the retired KH-native generators', () => {
    const script = readFileSync(
      resolve(__dirname, '../../scripts/regen-mirrors.sh'),
      'utf8',
    );
    // ID-148.9's KH-native generator scripts are DELETED — no more direct
    // `bun scripts/generate-{initiatives,retros}-mirror.ts` invocations.
    expect(script).not.toContain('generate-initiatives-mirror.ts');
    expect(script).not.toContain('generate-retros-mirror.ts');
    // Every ledger regenerates through the identical server-owned --check
    // mechanism (filename-agnostic — detectSchema routes by document_name).
    expect(script).toContain('--check "$LEDGER_DIR/task-list.json"');
    expect(script).toContain('--check "$LEDGER_DIR/product-backlog.json"');
    expect(script).toContain('--check "$LEDGER_DIR/initiatives.json"');
    expect(script).toContain('--check "$LEDGER_DIR/product-retros.json"');
    // roadmap retired under ID-148 — no more product-roadmap.json --check.
    expect(script).not.toContain('product-roadmap.json');
    const mirrorDirsLine = script
      .split('\n')
      .find((line) => line.trimStart().startsWith('MIRROR_DIRS='));
    expect(mirrorDirsLine).toBeDefined();
    expect(mirrorDirsLine).toContain('/tasks"');
    expect(mirrorDirsLine).toContain('/backlog"');
    expect(mirrorDirsLine).toContain('/initiatives"');
    expect(mirrorDirsLine).toContain('/retros"');
    expect(mirrorDirsLine).not.toContain('/roadmap"');
  });
});
