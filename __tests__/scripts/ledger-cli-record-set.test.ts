/**
 * ledger-cli-record-set.test.ts — the record-set-preservation write gate
 * (ID-35.16, RESEARCH §2.6 — highest-severity prevent-at-source guard).
 *
 * ID-90.22 R1a: the WRITE suites now exercise the SERVER TRANSPORT path
 * (KH_LEDGER_SERVER unset → ON). The `assertRecordSet` PRIMITIVE moved UPSTREAM
 * to the task-view patch-server (its direct unit test is retired here — the
 * primitive is covered by task-view's own suite, U11). The serialise-side
 * INDUCTION tests that stubbed `@/lib/ledger/scoped-serialise` (a module R2
 * deletes) are also retired — that import is banned by the R1a hygiene gate.
 *
 * What stays, two layers, all without an `@/lib/ledger` import:
 *   1. integration over the OBSERVABLE envelope: a normal field-edit (∅),
 *      add-subtask (+1), delete (−1) and promote (+1/−1) all commit through the
 *      gate (server-routed) with ok:true.
 *   2. the canonical in-repo `record-set-violation` envelope assertion: editing
 *      a record's OWN `id` field is a ∅-delta field-patch whose serialised bytes
 *      carry a DIFFERENT id-set (old id gone, new id appears) — a real
 *      record-set violation induced purely through CLI inputs (no serialiser
 *      stub, no malformed fixture — the backlog schema rejects duplicate/missing
 *      ids on load, so the gate must be tripped by a legitimate-on-load mutation
 *      whose WRITE diverges). Asserted on the `--whole-file` path, which stays
 *      LOCAL under flag-ON (GAP-2a) and reaches the in-process gate. Three sibling
 *      suites (delete-subtask, bulk-add, scoped-create) cross-reference THIS file
 *      as the canonical record-set-violation observable.
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-rs-'));
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

  // ID-90.22 R1a: the two serialise-side induction tests that stubbed
  // `@/lib/ledger/scoped-serialise` (whole-file `escapeSerialise`; scoped
  // `scopedSerialise`) are RETIRED — that module is deleted by R2 so the import
  // is banned by the R1a hygiene gate. The induction below replaces them WITHOUT
  // any `@/lib/ledger` import: it trips the gate through pure CLI inputs.
  it('rejects a record-set-violation on the whole-file write — exit-worthy, NO bytes written', async () => {
    // Editing a backlog item's OWN `id` field is, to the write gate, a ∅-delta
    // field-patch (no record added/removed) — yet the bytes about to be written
    // carry a DIFFERENT id-set: the old id leaves, the new id appears. The
    // {35.16} gate parses those bytes and MUST reject before anything lands.
    //
    // This is the canonical in-repo `record-set-violation` observable. It needs
    // NO serialiser stub and NO malformed fixture: the backlog schema enforces
    // unique, present ids on LOAD, so a violation can only be induced by a
    // mutation that is legitimate-on-load but whose WRITE diverges — exactly an
    // id-field edit. `--whole-file` STILL PARSES but is a write-path NO-OP
    // post-R1b; the record-set gate runs authoritatively on the patch-server
    // substrate (the unconditional write enforcement point), which rejects the
    // divergent id-set under flag-ON regardless of the flag.
    const itemId = read('product-backlog').items[0].id;
    const before = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(
      args('update-backlog', [itemId, 'id', '999999'], { wholeFile: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('record-set-violation');
      // The detail names exactly which id left and which appeared.
      expect(r.detail).toContain(String(itemId));
      expect(r.detail).toContain('999999');
    }
    // Pre-write gate rejected — the file is byte-identical to before.
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      before,
    );
  });
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
