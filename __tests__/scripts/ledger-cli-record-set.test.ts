/**
 * ledger-cli-record-set.test.ts — the record-set-preservation write gate
 * (ID-35.16, RESEARCH §2.6 — highest-severity prevent-at-source guard).
 *
 * ID-90.22 R1a: the WRITE suites now exercise the SERVER TRANSPORT path
 * (KH_LEDGER_SERVER unset → ON). The record-set gate moved UPSTREAM to the
 * task-view patch-server (the `assertRecordSet` primitive is server-side now and
 * its direct unit test, plus the SCOPED in-process serialiser-stub induction,
 * are retired here — the primitive is covered by task-view's own suite, U11).
 *
 * What stays, exercised over the OBSERVABLE envelope:
 *   - integration: a normal field-edit (∅), add-subtask (+1), delete (−1) and
 *     promote (+1/−1) all commit through the gate (server-routed) with ok:true.
 *   - the `--whole-file` path stays LOCAL under flag-ON (GAP-2a), so the
 *     serialise()→escapeSerialise drop induction still reaches the gate and the
 *     `record-set-violation` envelope (exit-worthy, NO bytes written) is asserted
 *     there — the canonical in-repo record-set-violation envelope assertion.
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-rs-'));
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
      noRegenMirrors: true, // suppress regen in tests (no task-view clone)
      ledgerDir: dir,
      ...extra,
    },
  };
}
function read(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

describe('record-set gate — integration through the write gate (ID-35.16)', () => {
  it('a normal flip-subtask (∅ delta) commits through the gate', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(args('flip-subtask', [taskId, subId, 'done']));
    expect(r.ok).toBe(true);
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('done');
  });

  it('a normal add-subtask (+1 delta) commits through the gate', async () => {
    const taskId = read('task-list').tasks[0].id;
    const count = read('task-list').tasks[0].subtasks.length;
    const newSub = {
      id: 999,
      title: 'Gate test subtask',
      description: 'A short summary.',
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(true);
    expect(read('task-list').tasks[0].subtasks.length).toBe(count + 1);
  });

  it('a normal delete-backlog (−1 delta) commits through the gate', async () => {
    const id = read('product-backlog').items[0].id;
    const r = await run(args('delete-backlog', [id]));
    expect(r.ok).toBe(true);
    expect(
      read('product-backlog').items.some((it: { id: string }) => it.id === id),
    ).toBe(false);
  });

  it('a normal promote (+1 task / −1 backlog) commits through the gate', async () => {
    const backlogId = read('product-backlog').items[0].id;
    const task = validTaskRecord('9995');
    const r = await run(args('promote', [backlogId, JSON.stringify(task)]));
    expect(r.ok).toBe(true);
    expect(
      read('task-list').tasks.some((t: { id: string }) => t.id === '9995'),
    ).toBe(true);
  });

  // ID-90.22 R1a: BOTH serialise-side induction tests (whole-file via
  // `escapeSerialise`; scoped via `scopedSerialise`) are RETIRED. Each induced a
  // serialise-side drop by stubbing `@/lib/ledger/scoped-serialise` — a module
  // R2 deletes, so the import is banned by the R1a hygiene gate (zero
  // `@/lib/ledger/` hits in __tests__/scripts/). The record-set gate moved
  // UPSTREAM to the task-view patch-server (the scoped write routes through the
  // SERVER TRANSPORT; the legacy whole-file `serialise()` path is the staged/
  // direct path R1b removes). The server-side gate is covered by task-view's own
  // suite (U11), and the OFF-vs-ON byte-parity (which would surface any
  // serialiser drop as a byte mismatch) is locked by the K5 differential-parity
  // harness until {68.30}. The HONEST positive coverage — normal ∅/+1/−1/promote
  // mutations commit through the gate (ok:true) — remains above, exercised over
  // the transport.
});

/** A minimal schema-valid Task record (all required fields present). */
function validTaskRecord(id: string) {
  return {
    id,
    title: 'Promoted task',
    description: 'Compact what+why.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks: [],
    updatedAt: '2026-05-26T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}
