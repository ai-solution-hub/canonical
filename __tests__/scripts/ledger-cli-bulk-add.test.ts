/**
 * ledger-cli-bulk-add.test.ts — ID-65.6: `add-subtasks <taskId> --file <json>`
 * batch-creates an ARRAY of TM-shape Subtask records in ONE scoped multi-record
 * splice — one {35.16} record-set-gate check, one mirror regen, one write.
 *
 * WHY this test exists (real-behaviour per docs/reference/test-philosophy.md):
 * before {65.6} there was NO bulk path; the {N.4} PLAN flow hand-crafted N
 * separate `add-subtask` writes (N gate passes, N mirror regens, N whole-file or
 * scoped writes). {65.6} folds N inserts into the accumulating text via the
 * {65.2} primitive so the FINAL text — with all N records spliced — is written
 * ONCE. The assertions below prove the real, observable guarantees:
 *   - all N records inserted with SEQUENTIAL auto-ids (no collisions),
 *   - a byte-minimal diff (every pre-existing record + every other record stays
 *     byte-identical; only the N new subtasks' lines appear),
 *   - stdin (`--file -`) parses the array,
 *   - a single-object (non-array) body is REJECTED with guidance,
 *   - per-record budget enforcement is ATOMIC (one over-budget record rejects
 *     the WHOLE batch; nothing written) unless --force,
 *   - per-record dependencies number[] coercion + explicit-id retention match
 *     single `add-subtask`.
 *
 * DOGFOODING HAZARD: this CLI writes the workflow's own ledgers. Every command
 * here runs against a TEMP COPY (mkdtemp + copyFile), never the real ledgers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  copyFileSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-bulk-add-'));
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
function path(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return join(dir, `${name}.json`);
}
function readText(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return readFileSync(path(name), 'utf8');
}
function readJson(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readText(name));
}
function findTask(taskId: string) {
  return readJson('task-list').tasks.find(
    (t: { id: string }) => t.id === taskId,
  );
}

/** Multiset line-diff oracle (same logic as ledger-cli-scoped-create.test.ts). */
function lineDiff(before: string, after: string) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const counts = new Map<string, number>();
  for (const l of beforeLines) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const l of afterLines) counts.set(l, (counts.get(l) ?? 0) - 1);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [line, delta] of counts) {
    for (let i = 0; i < delta; i++) removed.push(line);
    for (let i = 0; i < -delta; i++) added.push(line);
  }
  return { removed, added };
}

/**
 * Seed a task with `existing` subtasks (via single add-subtask each is fine, but
 * we open-task with the subtasks inline for speed) so a whole-array re-emit would
 * be unmistakable in the diff.
 */
async function seedTask(taskId: string, existingSubtasks: number) {
  const subtasks = Array.from({ length: existingSubtasks }, (_, i) => ({
    id: i + 1,
    title: `Existing subtask ${i + 1}`,
    description: 'Short.',
    details: '',
    status: 'pending',
    dependencies: [],
    testStrategy: null,
  }));
  const body = {
    id: taskId,
    title: 'Bulk-add host task',
    description: 'Holds subtasks to prove byte-minimal bulk append.',
    priority: 'should',
    subtasks,
  };
  const seed = await run(args('open-task', [JSON.stringify(body)]));
  expect(seed.ok).toBe(true);
}

describe('add-subtasks — bulk JSON-array create in ONE scoped multi-splice (ID-65.6)', () => {
  it('inserts all 3 records with SEQUENTIAL auto-ids in ONE byte-minimal write', async () => {
    const taskId = '9950';
    await seedTask(taskId, 5); // ids 1..5 exist → next auto-id is 6
    const before = readText('task-list');

    const batch = [
      { title: 'Bulk one', description: 'First of the batch.', details: '' },
      { title: 'Bulk two', description: 'Second of the batch.', details: '' },
      { title: 'Bulk three', description: 'Third of the batch.', details: '' },
    ];
    const file = join(dir, 'batch.json');
    writeFileSync(file, JSON.stringify(batch));

    const r = await run(args('add-subtasks', [taskId], { file }));
    expect(r.ok).toBe(true);

    const task = findTask(taskId);
    expect(task.subtasks).toHaveLength(8);
    // Sequential auto-ids assigned across the batch (6,7,8) — no collision.
    const newIds = task.subtasks.slice(5).map((s: { id: number }) => s.id);
    expect(newIds).toEqual([6, 7, 8]);
    expect(task.subtasks[5].title).toBe('Bulk one');
    expect(task.subtasks[6].title).toBe('Bulk two');
    expect(task.subtasks[7].title).toBe('Bulk three');

    // Byte-minimal: every pre-existing subtask line is byte-identical; only the
    // 3 new subtasks' lines appear. A whole-array re-emit would change the 5
    // existing subtask titles' lines — assert they are untouched.
    const after = readText('task-list');
    const { removed, added } = lineDiff(before, after);
    for (let i = 1; i <= 5; i++) {
      const subtitle = `Existing subtask ${i}`;
      expect(removed.some((l) => l.includes(subtitle))).toBe(false);
      expect(added.some((l) => l.includes(subtitle))).toBe(false);
    }
    // The 3 new titles appear in the added lines.
    expect(added.some((l) => l.includes('Bulk one'))).toBe(true);
    expect(added.some((l) => l.includes('Bulk two'))).toBe(true);
    expect(added.some((l) => l.includes('Bulk three'))).toBe(true);
    // At most ONE prior-last-record line gains a trailing comma (the splice
    // appends; no whole-array re-emit).
    expect(removed.length).toBeLessThanOrEqual(1);
  });

  it('reads the JSON array from stdin (--file -) — real CLI binary, fd 0 piped', async () => {
    const taskId = '9952';
    await seedTask(taskId, 2); // ids 1..2 → next is 3
    const batch = [
      { title: 'Stdin A', description: 'From stdin.', details: '' },
      { title: 'Stdin B', description: 'From stdin too.', details: '' },
    ];
    const r = spawnSync(
      'bun',
      [
        CLI,
        'add-subtasks',
        taskId,
        '--file',
        '-',
        '--ledger-dir',
        dir,
        '--no-regen-mirrors',
      ],
      { cwd: REPO, encoding: 'utf8', input: JSON.stringify(batch) },
    );
    expect(r.status).toBe(0);
    const task = findTask(taskId);
    expect(task.subtasks).toHaveLength(4);
    expect(task.subtasks.slice(2).map((s: { id: number }) => s.id)).toEqual([
      3, 4,
    ]);
    expect(task.subtasks[2].title).toBe('Stdin A');
    expect(task.subtasks[3].title).toBe('Stdin B');
  });

  it('rejects a single-object (non-array) body with guidance', async () => {
    const taskId = '9953';
    await seedTask(taskId, 1);
    const before = readText('task-list');
    const file = join(dir, 'single.json');
    writeFileSync(
      file,
      JSON.stringify({ title: 'Not an array', description: 'Single object.' }),
    );
    const r = await run(args('add-subtasks', [taskId], { file }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('expected-array');
      expect(r.detail).toContain('add-subtask');
    }
    // Nothing written.
    expect(readText('task-list')).toBe(before);
  });

  it('per-record budget is ATOMIC — one over-budget description rejects the WHOLE batch', async () => {
    const taskId = '9954';
    await seedTask(taskId, 1);
    const before = readText('task-list');
    const batch = [
      { title: 'Ok one', description: 'Within budget.', details: '' },
      {
        title: 'Over budget',
        // subtask.description budget is 250 graphemes.
        description: 'x'.repeat(251),
        details: '',
      },
      { title: 'Ok three', description: 'Within budget.', details: '' },
    ];
    const file = join(dir, 'overbudget.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', [taskId], { file }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('budget-exceeded');
    // ATOMIC: not even the in-budget records were written.
    expect(readText('task-list')).toBe(before);
  });

  it('--force downgrades an over-budget record to a warning and writes the whole batch', async () => {
    const taskId = '9955';
    await seedTask(taskId, 1); // id 1 → next is 2
    const batch = [
      { title: 'Forced one', description: 'Within budget.', details: '' },
      { title: 'Forced two', description: 'y'.repeat(251), details: '' },
    ];
    const file = join(dir, 'forced.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', [taskId], { file, force: true }));
    expect(r.ok).toBe(true);
    const task = findTask(taskId);
    expect(task.subtasks).toHaveLength(3);
    expect(task.subtasks.slice(1).map((s: { id: number }) => s.id)).toEqual([
      2, 3,
    ]);
  });

  it('coerces dependencies to number[] per record and rejects non-positive-integer tokens', async () => {
    const taskId = '9956';
    await seedTask(taskId, 3); // ids 1..3 → next is 4
    const batch = [
      {
        title: 'Dep one',
        description: 'Sibling deps as strings.',
        details: '',
        dependencies: ['1', '2'],
      },
      {
        title: 'Dep two',
        description: 'Sibling deps numeric.',
        details: '',
        dependencies: [3],
      },
    ];
    const file = join(dir, 'deps.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', [taskId], { file }));
    expect(r.ok).toBe(true);
    const task = findTask(taskId);
    const added = task.subtasks.slice(3);
    expect(added[0].dependencies).toEqual([1, 2]);
    expect(added[1].dependencies).toEqual([3]);

    // A bad token rejects the WHOLE batch.
    const bad = [
      { title: 'Bad dep', description: 'x', details: '', dependencies: ['0'] },
    ];
    const badFile = join(dir, 'baddeps.json');
    writeFileSync(badFile, JSON.stringify(bad));
    const before = readText('task-list');
    const r2 = await run(args('add-subtasks', [taskId], { file: badFile }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('invalid-depends');
    expect(readText('task-list')).toBe(before);
  });

  it('records carrying an explicit id keep it; id-less records get sequential auto-ids around them', async () => {
    const taskId = '9957';
    await seedTask(taskId, 2); // ids 1..2 → auto-id counter starts at 3
    const batch = [
      { title: 'Auto first', description: 'No id.', details: '' },
      { id: 50, title: 'Explicit', description: 'Keeps id 50.', details: '' },
      { title: 'Auto second', description: 'No id.', details: '' },
    ];
    const file = join(dir, 'mixedids.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', [taskId], { file }));
    expect(r.ok).toBe(true);
    const task = findTask(taskId);
    const added = task.subtasks.slice(2);
    // Auto-id counter starts at nextId (3) and increments per auto-assignment;
    // the explicit-id record keeps 50 and does NOT consume a counter slot.
    expect(added[0].id).toBe(3);
    expect(added[1].id).toBe(50);
    expect(added[2].id).toBe(4);
  });

  it('coerces string --id-style body id to a number; rejects non-positive-integer', async () => {
    const taskId = '9958';
    await seedTask(taskId, 0);
    // Body id arrives as a string (e.g. authored JSON with "id":"12").
    const batch = [
      { id: '12', title: 'String id', description: 'Coerced.', details: '' },
    ];
    const file = join(dir, 'strid.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', [taskId], { file }));
    expect(r.ok).toBe(true);
    const task = findTask(taskId);
    expect(task.subtasks[0].id).toBe(12);

    const bad = [{ id: 'abc', title: 'Bad id', description: 'x', details: '' }];
    const badFile = join(dir, 'badid.json');
    writeFileSync(badFile, JSON.stringify(bad));
    const before = readText('task-list');
    const r2 = await run(args('add-subtasks', [taskId], { file: badFile }));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe('invalid-id');
    expect(readText('task-list')).toBe(before);
  });

  it('--dry-run writes nothing', async () => {
    const taskId = '9959';
    await seedTask(taskId, 1);
    const before = readText('task-list');
    const batch = [{ title: 'Dry', description: 'Not written.', details: '' }];
    const file = join(dir, 'dry.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', [taskId], { file, dryRun: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toMatchObject({ dryRun: true });
    expect(readText('task-list')).toBe(before);
  });

  it('rejects an unknown taskId before any write', async () => {
    const before = readText('task-list');
    const batch = [{ title: 'X', description: 'y', details: '' }];
    const file = join(dir, 'unknown.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', ['no-such-task'], { file }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-not-found');
    expect(readText('task-list')).toBe(before);
  });
});
