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
