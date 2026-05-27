/**
 * ledger-cli-record-set.test.ts — the record-set-preservation write gate
 * (ID-35.16, RESEARCH §2.6 — highest-severity prevent-at-source guard).
 *
 * Two layers:
 *   1. unit-test `assertRecordSet(beforeIds, afterIds, expectedDelta)` directly:
 *      ∅ / +1 / −1 pass when honoured; a missing id, an unexpected extra id, or
 *      a wrong delta is a violation.
 *   2. integration: a normal field-edit (∅) and a normal add-subtask (+1) both
 *      commit through the gate; a crafted serialised-output drop is rejected
 *      with `record-set-violation`, exit 1, NO bytes written.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  assertRecordSet,
  run,
  type ParsedArgs,
} from '@/scripts/ledger-cli';

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

describe('assertRecordSet — unit (ID-35.16)', () => {
  it('∅ delta passes when id-sets are identical', () => {
    const r = assertRecordSet(
      new Set(['1', '2', '3']),
      new Set(['1', '2', '3']),
      { kind: 'none' },
    );
    expect(r.ok).toBe(true);
  });

  it('∅ delta violates when an id is missing (silent drop)', () => {
    const r = assertRecordSet(
      new Set(['1', '2', '3']),
      new Set(['1', '3']),
      { kind: 'none' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toContain('2');
    expect(r.detail.toLowerCase()).toContain('missing');
  });

  it('∅ delta violates when an unexpected id appears (duplicate/insert)', () => {
    const r = assertRecordSet(
      new Set(['1', '2']),
      new Set(['1', '2', '99']),
      { kind: 'none' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toContain('99');
    expect(r.detail.toLowerCase()).toContain('unexpected');
  });

  it('+1 delta passes when exactly the one new id is added', () => {
    const r = assertRecordSet(
      new Set(['1', '2']),
      new Set(['1', '2', '3']),
      { kind: 'add', id: '3' },
    );
    expect(r.ok).toBe(true);
  });

  it('+1 delta violates when a different id appears or an old one vanishes', () => {
    const dropped = assertRecordSet(
      new Set(['1', '2']),
      new Set(['1', '3']), // 2 dropped, 3 added (should be +3 only)
      { kind: 'add', id: '3' },
    );
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) expect(dropped.detail).toContain('2');
  });

  it('−1 delta passes when exactly the one id is removed', () => {
    const r = assertRecordSet(
      new Set(['1', '2', '3']),
      new Set(['1', '3']),
      { kind: 'remove', id: '2' },
    );
    expect(r.ok).toBe(true);
  });

  it('−1 delta violates when an extra id also disappears', () => {
    const r = assertRecordSet(
      new Set(['1', '2', '3']),
      new Set(['3']), // 1 also dropped (only 2 should go)
      { kind: 'remove', id: '2' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('1');
  });

  it('numeric ids are compared by value (subtask ids are numbers)', () => {
    const r = assertRecordSet(
      new Set([1, 2, 3]),
      new Set([1, 2, 3, 4]),
      { kind: 'add', id: 4 },
    );
    expect(r.ok).toBe(true);
  });
});

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

  it('rejects a serialised-output drop with record-set-violation, NO bytes written', async () => {
    // Induce a serialise-side drop: stub escapeSerialise so the whole-file
    // write path emits a document missing one pre-existing backlog item. The
    // gate parses the bytes-about-to-be-written and MUST catch the drop before
    // atomicWriteFile lands anything.
    const mod = await import('@/lib/ledger/scoped-serialise');
    const real = mod.escapeSerialise;
    const spy = vi
      .spyOn(mod, 'escapeSerialise')
      .mockImplementation((parsedValue: unknown) => {
        const v = parsedValue as { items?: { id: string }[] };
        if (Array.isArray(v.items) && v.items.length > 1) {
          // Drop the first surviving item — a silent record loss.
          const clone = { ...v, items: v.items.slice(1) };
          return real(clone);
        }
        return real(parsedValue);
      });

    const before = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    // update-backlog is a ∅-delta whole-file write; the stub drops one item so
    // the post-write id-set is short by one → record-set-violation.
    const itemId = read('product-backlog').items[2].id;
    const r = await run(args('update-backlog', [itemId, 'status', 'parked']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-set-violation');
    // Nothing written — the original file is byte-identical.
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(before);
    spy.mockRestore();
  });

  it('rejects a serialised-output drop on the SCOPED write path too ({35.24})', async () => {
    // The {35.16} gate runs on the bytes-about-to-be-written regardless of write
    // path. The whole-file case is proven above (escapeSerialise stub, which the
    // CLI's serialise() reaches through the module import). The SCOPED path's
    // bytes come from `scopedSerialise`, whose final emit is an INTRA-module call
    // to escapeSerialise that a namespace spy cannot intercept — so to induce a
    // scoped-path drop we stub `scopedSerialise` itself to return a document with
    // one task removed. The gate must catch it before atomicWriteFile lands.
    const mod = await import('@/lib/ledger/scoped-serialise');
    const real = mod.scopedSerialise;
    const spy = vi
      .spyOn(mod, 'scopedSerialise')
      .mockImplementation((originalText, patch) => {
        const r = real(originalText, patch);
        if (!r.ok) return r;
        const doc = JSON.parse(r.text) as { tasks?: { id: string }[] };
        if (Array.isArray(doc.tasks) && doc.tasks.length > 1) {
          // Drop the SECOND task — a silent record loss on the scoped path.
          doc.tasks = doc.tasks.filter((_, i) => i !== 1);
          return { ...r, text: mod.escapeSerialise(doc) };
        }
        return r;
      });

    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const taskId = read('task-list').tasks[0].id;
    // A ∅-delta scoped flip-task; the stub drops a different task so the
    // post-write id-set is short by one → record-set-violation, nothing written.
    const r = await run(
      args('flip-task', [taskId, 'in_progress'], { scoped: true }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-set-violation');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
    spy.mockRestore();
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
