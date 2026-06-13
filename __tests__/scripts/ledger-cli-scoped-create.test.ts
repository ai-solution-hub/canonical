/**
 * ledger-cli-scoped-create.test.ts — byte-minimal-diff proof for the four
 * single-record CREATE commands routed through the {65.2} scoped splice
 * primitive (ID-65.3).
 *
 * WHY this test exists (real-behaviour per docs/reference/test-philosophy.md):
 * before {65.3}, `add-subtask` called `commitMutation` with no scoped descriptor
 * → a whole-file `serialise()` re-emit (a ~6k-line diff on the live
 * `task-list.json`); `open-task`/`create-theme`/`create-backlog` likewise. After
 * {65.3} each of the four commands threads a `scopedSplice` descriptor so the
 * WRITTEN bytes are exactly the new record's lines appended into the original
 * text — every untouched record stays byte-identical.
 *
 * The proof is a LINE-DIFF assertion on the real before/after file bytes (copies
 * of the live ledgers): the only lines that may change are (a) the new record's
 * own lines (added) and (b) at most ONE prior-last-record closing line that gains
 * a trailing comma. We do NOT assert a specific key order on the new record (the
 * splice emits JS object key order for a brand-new record — KEY-ORDER NOTE in the
 * {65.3} brief).
 *
 * DOGFOODING HAZARD: this CLI writes the workflow's own ledgers. Every command
 * here runs against a TEMP COPY (mkdtemp + copyFile), never the real ledgers.
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-scoped-create-'));
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
function path(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return join(dir, `${name}.json`);
}
function readText(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return readFileSync(path(name), 'utf8');
}
function readJson(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readText(name));
}

/**
 * The core byte-minimal-diff oracle. Given before/after file text, returns the
 * lines that disappeared (`removed`) and the lines that appeared (`added`),
 * computed as a multiset difference so duplicate lines (e.g. `      ],`) are
 * handled correctly. A whole-file re-emit of a large array would produce many
 * removed+added lines; a minimal record-sized splice produces only the new
 * record's lines (added) plus at most one prior-last-record line whose only
 * change is a gained trailing comma.
 */
function lineDiff(before: string, after: string) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const counts = new Map<string, number>();
  for (const l of beforeLines) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const l of afterLines) counts.set(l, (counts.get(l) ?? 0) - 1);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [line, delta] of counts) {
    // delta > 0 ⇒ line existed in before but not (all copies) in after ⇒ removed.
    for (let i = 0; i < delta; i++) removed.push(line);
    // delta < 0 ⇒ line appears more in after ⇒ added.
    for (let i = 0; i < -delta; i++) added.push(line);
  }
  return { removed, added };
}

/**
 * Assert the diff is byte-minimal: every `removed` line is explained by the
 * matching `added` line being the same text plus a trailing comma (the prior
 * last record of the collection gained a `,` when the new record was appended).
 * Nothing else may be removed. Returns the genuinely-NEW lines (added lines that
 * are not just comma-additions of a removed line) for the caller to size-check.
 */
function assertMinimalDiff(before: string, after: string): string[] {
  const { removed, added } = lineDiff(before, after);
  const addedPool = [...added];
  for (const r of removed) {
    // A removed line must be explained by `${r},` having been added (trailing
    // comma on the prior last record). Anything else is a wide re-emit.
    const idx = addedPool.indexOf(`${r},`);
    expect(
      idx,
      `removed line not explained by a trailing-comma addition: ${JSON.stringify(r)}`,
    ).toBeGreaterThanOrEqual(0);
    addedPool.splice(idx, 1);
  }
  // At most ONE prior-record line may gain a trailing comma.
  expect(removed.length).toBeLessThanOrEqual(1);
  // The remaining added lines are the genuinely-new record's lines.
  return addedPool;
}

describe('add-subtask — scoped splice produces a record-sized diff (ID-65.3)', () => {
  it('appending one subtask to a 40-subtask Task does NOT re-emit the whole subtasks[] array', async () => {
    // Build a task carrying MANY subtasks so a whole-file re-emit of the parent
    // array would be unmistakable in the diff. open-task it first (also scoped),
    // then snapshot, then add-subtask and prove the diff is record-sized.
    const taskId = '9931';
    const subtasks = Array.from({ length: 40 }, (_, i) => ({
      id: String(i + 1),
      title: `Existing subtask ${i + 1}`,
      description: 'Short.',
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: null,
    }));
    const taskBody = {
      id: taskId,
      title: 'Forty-subtask task',
      description: 'Holds many subtasks to prove byte-minimal append.',
      priority: 'should',
      subtasks,
    };
    const seed = await run(args('open-task', [JSON.stringify(taskBody)]));
    expect(seed.ok).toBe(true);
    expect(
      readJson('task-list').tasks.find((t: { id: string }) => t.id === taskId)
        .subtasks,
    ).toHaveLength(40);

    const before = readText('task-list');
    const newSub = {
      title: 'The one appended subtask',
      description: 'Only these lines should appear in the diff.',
      details: 'detail body',
      testStrategy: 'unit',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(true);
    const after = readText('task-list');

    // 41 subtasks now; only the 41st's lines (plus one trailing comma) changed.
    const task = readJson('task-list').tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(task.subtasks).toHaveLength(41);

    const newLines = assertMinimalDiff(before, after);
    // The new subtask serialises to a bounded number of lines (object open/close
    // + its fields), NOT 40×lines-per-subtask. A whole-array re-emit would be
    // hundreds of changed lines; assert a tight upper bound that only a single
    // appended record can satisfy.
    expect(newLines.length).toBeLessThanOrEqual(25);
    // The new record's distinctive content is present in the added lines.
    expect(newLines.some((l) => l.includes('The one appended subtask'))).toBe(
      true,
    );
    // Every other subtask line is byte-identical (no whole-array re-emit): the
    // 40 existing subtask titles never appear in the changed-line set.
    const { removed, added } = lineDiff(before, after);
    for (let i = 1; i <= 40; i++) {
      const subtitle = `Existing subtask ${i}`;
      expect(removed.some((l) => l.includes(subtitle))).toBe(false);
      expect(added.some((l) => l.includes(subtitle))).toBe(false);
    }
  });

  it('success envelope shape is unchanged + dry-run writes nothing (scoped routing is transparent)', async () => {
    // {65.3} changes only WHICH bytes are written (splice vs whole-file re-emit),
    // never the success-envelope contract. add-subtask still returns
    // {taskId, subId, subtaskCount}; --dryRun still writes no bytes.
    // (Per OQ-65-1: add-subtask has NO dup-subtask-id oracle — pre-existing, and
    // NOT introduced by {65.3} — so we assert the real in-scope guarantees here;
    // the create-command dup-id rejection + the {35.16} gate are proven below.)
    const taskId = '9932';
    const taskBody = {
      id: taskId,
      title: 'Envelope-shape task',
      description: 'Asserts the add-subtask success envelope is unchanged.',
      priority: 'should',
      subtasks: [],
    };
    expect((await run(args('open-task', [JSON.stringify(taskBody)]))).ok).toBe(
      true,
    );
    const sub = {
      id: '7',
      title: 'Seventh',
      description: 'Short.',
      details: '',
      testStrategy: null,
    };
    const ok = await run(args('add-subtask', [taskId, JSON.stringify(sub)]));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.result).toMatchObject({ taskId, subId: '7', subtaskCount: 1 });
    }

    // --dryRun: the scoped path must short-circuit before any byte is written.
    const before = readText('task-list');
    const dry = await run(
      args('add-subtask', [taskId, JSON.stringify({ ...sub, id: '8' })], {
        dryRun: true,
      }),
    );
    expect(dry.ok).toBe(true);
    if (dry.ok) expect(dry.result).toMatchObject({ dryRun: true });
    expect(readText('task-list')).toBe(before);
  });
});

describe('open-task / create-theme / create-backlog — scoped splice (ID-65.3)', () => {
  it('open-task appends only the new task record (byte-minimal diff)', async () => {
    const before = readText('task-list');
    const body = {
      id: '9940',
      title: 'Scoped-create task',
      description: 'Only this task record should appear in the diff.',
      priority: 'should',
    };
    const r = await run(args('open-task', [JSON.stringify(body)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toMatchObject({ recordId: '9940' });
    const after = readText('task-list');

    const newLines = assertMinimalDiff(before, after);
    expect(newLines.some((l) => l.includes('Scoped-create task'))).toBe(true);
    expect(
      readJson('task-list').tasks.some((t: { id: string }) => t.id === '9940'),
    ).toBe(true);
  });

  it('create-theme appends only the new theme record (byte-minimal diff)', async () => {
    const before = readText('product-roadmap');
    const body = {
      id: '9941',
      title: 'Scoped-create theme',
      description: 'Only this theme record should appear in the diff.',
    };
    const r = await run(args('create-theme', [JSON.stringify(body)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toMatchObject({ recordId: '9941' });
    const after = readText('product-roadmap');

    const newLines = assertMinimalDiff(before, after);
    expect(newLines.some((l) => l.includes('Scoped-create theme'))).toBe(true);
    expect(
      readJson('product-roadmap').themes.some(
        (t: { id: string }) => t.id === '9941',
      ),
    ).toBe(true);
  });

  it('create-backlog appends only the new item record (byte-minimal diff)', async () => {
    const before = readText('product-backlog');
    const body = {
      id: '9942',
      title: 'Scoped-create item',
      description: 'Only this item record should appear in the diff.',
      priority: 'could',
    };
    const r = await run(args('create-backlog', [JSON.stringify(body)]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toMatchObject({ recordId: '9942' });
    const after = readText('product-backlog');

    const newLines = assertMinimalDiff(before, after);
    expect(newLines.some((l) => l.includes('Scoped-create item'))).toBe(true);
    expect(
      readJson('product-backlog').items.some(
        (it: { id: string }) => it.id === '9942',
      ),
    ).toBe(true);
  });

  it('create-backlog still rejects a duplicate id (oracle gate fires; nothing written)', async () => {
    const existingId = readJson('product-backlog').items[0].id;
    const before = readText('product-backlog');
    const body = {
      id: existingId,
      title: 'Dup item',
      description: 'Should be rejected as duplicate.',
      priority: 'could',
    };
    const r = await run(args('create-backlog', [JSON.stringify(body)]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('duplicate-id');
    // Nothing written.
    expect(readText('product-backlog')).toBe(before);
  });

  // ID-90.22 R1a: the {35.16} record-set gate induction test on the scoped
  // create path is RETIRED. It stubbed `scopedSpliceSerialise`
  // (@/lib/ledger/scoped-serialise) to drop a pre-existing item alongside the
  // legitimate insert — but the create now routes through the SERVER TRANSPORT,
  // where the record-set gate runs server-side on the bytes the SERVER
  // serialises, so the in-process namespace stub no longer sits on the write
  // path and the drop cannot be induced from this process. The server-side gate
  // is covered by task-view's own suite (U11); the canonical in-repo OBSERVABLE
  // record-set-violation envelope assertion lives in
  // ledger-cli-record-set.test.ts (the flag-ON LOCAL `--whole-file` path,
  // GAP-2a). The HONEST positive coverage — a legitimate scoped create commits
  // the +1 record-set delta, and the duplicate-id oracle still rejects — remains
  // above, exercised over the transport.
});
