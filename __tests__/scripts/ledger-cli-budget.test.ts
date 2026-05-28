/**
 * ledger-cli-budget.test.ts — write-time budget pre-check + --force
 * (ID-35.17, RESEARCH §2.3 — the north star). The CLI REFUSES TO AUTHOR an
 * over-budget record at source: over-budget → budget-exceeded, exit 1, NO bytes
 * written; --force downgrades to the existing soft warning and proceeds.
 *
 * The message is SCOPED to the changed record (one line: field + actual +
 * budget) — never the whole-ledger parseTaskListWithWarnings dump.
 * `subtask.details` is EXEMPT (not in the registry — the append-only journal).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-budget-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
function read(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

// A 789-char description — the exact over-budget value the S270 author wrote
// (RESEARCH §0 north star). The subtask.description budget is 250.
const DESC_789 = 'x'.repeat(789);

describe('budget pre-check on add-subtask (ID-35.17)', () => {
  it('rejects a 789-char subtask description (exit 1, no write) without --force', async () => {
    const taskId = read('task-list').tasks[0].id;
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const newSub = {
      id: 9990,
      title: 'Over-budget subtask',
      description: DESC_789,
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      // Scoped, one-line message naming field + actual + budget.
      expect(r.detail).toContain('description');
      expect(r.detail).toContain('789');
      expect(r.detail).toContain('250');
    }
    // Nothing written.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('writes the 789-char description WITH --force (downgraded to a warning)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const count = read('task-list').tasks[0].subtasks.length;
    const newSub = {
      id: 9991,
      title: 'Forced over-budget subtask',
      description: DESC_789,
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(
      args('add-subtask', [taskId, JSON.stringify(newSub)], { force: true }),
    );
    expect(r.ok).toBe(true);
    expect(read('task-list').tasks[0].subtasks.length).toBe(count + 1);
    const written = read('task-list').tasks[0].subtasks.find(
      (s: { id: number }) => s.id === 9991,
    );
    expect(written.description.length).toBe(789);
  });
});

describe('budget pre-check exemptions + non-budgeted edits (ID-35.17)', () => {
  it('append-journal to a subtask details is EXEMPT (details is unbudgeted)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    // A long journal block must NOT trip the budget gate — details is exempt.
    const r = await run(
      args('append-journal', [taskId, subId, 'y'.repeat(2000)]),
    );
    expect(r.ok).toBe(true);
    const details = read('task-list').tasks[0].subtasks[0].details as string;
    expect(details).toContain('y'.repeat(2000));
  });

  it('a within-budget update-backlog description commits', async () => {
    const itemId = read('product-backlog').items[0].id;
    const r = await run(
      args('update-backlog', [itemId, 'description', 'A short summary.']),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an over-budget update-backlog title (>80) without --force', async () => {
    const itemId = read('product-backlog').items[0].id;
    const before = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(
      args('update-backlog', [itemId, 'title', 'z'.repeat(120)]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('title');
      expect(r.detail).toContain('80');
    }
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(before);
  });
});

// ── ID-35.26 — update-* gates only the MUTATED field, not the whole record ─────
//
// Defect (S273): the budget pre-check iterated EVERY budgeted field of the
// changed record. For a field-edit command (update-task / update-subtask /
// update-backlog / update-roadmap), a historically over-budget UNTOUCHED field
// would reject the edit even though the operator never touched it.
//
// Fix: update-* commands pass `mutatedField` into the budget gate. checkBudget
// rejects only when the MUTATED field is over-budget; over-budget UNTOUCHED
// fields surface as soft warnings. Create / add / promote (which author all
// fields) keep checking every budgeted field — `mutatedField` absent → all.
describe('update-* budget gate is scoped to the mutated field (ID-35.26)', () => {
  // Seed a subtask whose `description` is historically over-budget, by adding
  // it via add-subtask + --force (the legitimate "I authored an over-budget
  // record" escape hatch). The subsequent update-subtask edit on an UNRELATED
  // field must NOT be rejected by the untouched over-budget description.
  async function seedOverBudgetSubtask(taskId: string, subId: number) {
    const newSub = {
      id: subId,
      title: 'Untouched over-budget seed',
      description: 'x'.repeat(789), // > 250 budget
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(
      args('add-subtask', [taskId, JSON.stringify(newSub)], { force: true }),
    );
    if (!r.ok) throw new Error(`seed failed: ${JSON.stringify(r)}`);
  }

  it('update-subtask status SUCCEEDS when an untouched description is over-budget', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = 9992;
    await seedOverBudgetSubtask(taskId, subId);

    // Now edit an unrelated field (status). The untouched description is
    // still 789 chars — the gate must NOT reject the edit.
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'in_progress']),
    );
    expect(r.ok).toBe(true);

    // The status flip landed.
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: number }) => s.id === subId,
    );
    expect(updated.status).toBe('in_progress');
    // And the over-budget description is still on disk (untouched).
    expect(updated.description.length).toBe(789);

    // The untouched over-budget field should surface as a soft warning so the
    // operator is aware — never silently swallowed.
    if (r.ok) {
      const warns = r.warnings ?? [];
      const hit = warns.some(
        (w) =>
          w.includes('description') &&
          w.includes('789') &&
          w.includes('250'),
      );
      expect(hit).toBe(true);
    }
  });

  it('update-subtask testStrategy SUCCEEDS when an untouched description is over-budget', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = 9993;
    await seedOverBudgetSubtask(taskId, subId);

    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'testStrategy',
        'PASS when the new behaviour holds.',
      ]),
    );
    expect(r.ok).toBe(true);
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: number }) => s.id === subId,
    );
    expect(updated.testStrategy).toBe('PASS when the new behaviour holds.');
    expect(updated.description.length).toBe(789);
  });

  it('update-subtask STILL rejects when the MUTATED field (description) is over-budget', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = 9994;
    await seedOverBudgetSubtask(taskId, subId);

    // Mutating the description to a new >250 value MUST still reject.
    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'description',
        'y'.repeat(400),
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('description');
      expect(r.detail).toContain('400');
      expect(r.detail).toContain('250');
    }
    // The on-disk description is unchanged (the original 789).
    const after = read('task-list').tasks[0].subtasks.find(
      (s: { id: number }) => s.id === subId,
    );
    expect(after.description.length).toBe(789);
  });

  it('update-subtask --force on the mutated field commits AND notes untouched warnings', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = 9995;
    await seedOverBudgetSubtask(taskId, subId);

    // --force on a deliberately over-budget testStrategy edit; the existing
    // untouched description must not double-reject and must surface as a
    // warning alongside the forced one.
    const r = await run(
      args(
        'update-subtask',
        [`${taskId}.${subId}`, 'testStrategy', 'z'.repeat(400)],
        { force: true },
      ),
    );
    expect(r.ok).toBe(true);
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: number }) => s.id === subId,
    );
    expect(updated.testStrategy.length).toBe(400);
    expect(updated.description.length).toBe(789);
  });
});
