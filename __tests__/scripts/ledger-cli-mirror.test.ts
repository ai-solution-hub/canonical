/**
 * ledger-cli-mirror.test.ts — mirror regen default-on + fail-loud
 * (ID-35.18, RESEARCH §2.5). A mutating command regenerates the affected
 * mirror BY DEFAULT (so docs/reference/{tasks,roadmap,backlog}/ stay in sync
 * and CI ledger-mirror-parity stays green); `--no-regen-mirrors` opts out.
 *
 * The regen invocation is replaced via the CLI's `__setRegenRunnerForTest`
 * seam so the test NEVER clones task-view. We assert the runner is invoked (or
 * not) and that a non-zero exit is surfaced loud on stderr (post-write alert,
 * not a rollback).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  run,
  __setRegenRunnerForTest,
  mirrorReminderFor,
  type ParsedArgs,
} from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

let dir: string;
let regenSpy: ReturnType<typeof vi.fn<() => number | null>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-mirror-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
  regenSpy = vi.fn<() => number | null>(() => 0); // success by default
  __setRegenRunnerForTest(regenSpy);
});
afterEach(() => {
  __setRegenRunnerForTest(null); // restore the real runner
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

describe('mirror regen default-on (ID-35.18)', () => {
  it('a mutating command with NO mirror flag invokes regen by default', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(args('flip-subtask', [taskId, subId, 'done']));
    expect(r.ok).toBe(true);
    expect(regenSpy).toHaveBeenCalledTimes(1);
  });

  it('--no-regen-mirrors suppresses the regen', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { noRegenMirrors: true }),
    );
    expect(r.ok).toBe(true);
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('--regen-mirrors is a harmless no-op alias (regen still runs by default)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { regenMirrors: true }),
    );
    expect(r.ok).toBe(true);
    expect(regenSpy).toHaveBeenCalledTimes(1);
  });

  it('a dry-run does NOT regen (nothing was written)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { dryRun: true }),
    );
    expect(r.ok).toBe(true);
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('a non-zero regen exit is surfaced LOUD on stderr (post-write alert, not rollback)', async () => {
    regenSpy.mockImplementation(() => 2);
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(args('flip-subtask', [taskId, subId, 'done']));
    // The write committed (post-write alert, not a rollback).
    expect(r.ok).toBe(true);
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('done');
    const loud = stderrSpy.mock.calls.some((c) =>
      String(c[0]).includes('MIRROR REGEN FAILED'),
    );
    expect(loud).toBe(true);
    stderrSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ID-35.32 — discriminated mirror-reminder text.
//
// Bug: every mutating call printed the generic "mirror regen runs by default
// after a write; if you passed --no-regen-mirrors, run …" reminder even WHEN
// --no-regen-mirrors was passed. That lectures the operator about a default
// they already bypassed. Fix: discriminate the result-envelope `mirrorStale`
// signal with `mirrorStaleReason` ('suppressed' | 'regen-failed') and pick the
// reminder text accordingly.
// ─────────────────────────────────────────────────────────────────────────────

describe('mirror-reminder discrimination (ID-35.32)', () => {
  it('--no-regen-mirrors result envelope carries mirrorStaleReason: "suppressed"', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { noRegenMirrors: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
    expect(regenSpy).not.toHaveBeenCalled();
  });

  it('successful regen result envelope leaves mirrorStaleReason undefined and mirrorStale falsy', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(args('flip-subtask', [taskId, subId, 'done']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBeFalsy();
    expect(r.mirrorStaleReason).toBeUndefined();
    expect(regenSpy).toHaveBeenCalledTimes(1);
  });

  it('regen-runner failure result envelope carries mirrorStaleReason: "regen-failed"', async () => {
    regenSpy.mockImplementation(() => 2);
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(args('flip-subtask', [taskId, subId, 'done']));
    stderrSpy.mockRestore();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('regen-failed');
  });

  it('mirrorReminderFor("suppressed") confirms the skip — does NOT print generic "runs by default" lecture', () => {
    const text = mirrorReminderFor('suppressed');
    expect(text).toMatch(/mirror regen suppressed/i);
    expect(text).toMatch(/--no-regen-mirrors/);
    expect(text).toMatch(/regen-mirrors\.sh/);
    expect(text).not.toMatch(/runs by default/i);
    // Operator-facing message must end with a newline so stderr stays tidy.
    expect(text.endsWith('\n')).toBe(true);
  });

  it('mirrorReminderFor("regen-failed") flags the failure and prompts a manual rerun', () => {
    const text = mirrorReminderFor('regen-failed');
    expect(text).toMatch(/regen.*failed/i);
    expect(text).toMatch(/regen-mirrors\.sh/);
    expect(text.endsWith('\n')).toBe(true);
  });
});
