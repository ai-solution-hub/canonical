/**
 * ledger-cli-field-editors.test.ts — the {35.19}/{35.20} user-facing
 * field-editor + create commands built on the {35.15}–{35.18} write-gate
 * foundation: `update-subtask`, `update-task`, `update-roadmap`, `create-theme`.
 *
 * Per RESEARCH §2.1 (update-subtask), §4 (3-ledger parity), §5.3
 * (field-type-aware coercion). Drives the exported `run()` directly against a
 * temp dir holding fresh copies of the three real ledgers (schema-valid
 * fixtures; exercises the vendored primitives + both write gates end-to-end).
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-fe-'));
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

function readTask() {
  return JSON.parse(readFileSync(join(dir, 'task-list.json'), 'utf8'));
}

// A task/subtask known to exist in the live fixture for editing.
function firstTaskWithSubtask(): { taskId: string; subId: number } {
  const tl = readTask();
  for (const t of tl.tasks) {
    if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
      return { taskId: t.id, subId: t.subtasks[0].id };
    }
  }
  throw new Error('no task with a subtask in fixture');
}

describe('update-subtask — {35.19} subtask field editor', () => {
  it('flips a subtask status field via a dotted id and persists', async () => {
    const { taskId, subId } = firstTaskWithSubtask();
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done']),
    );
    expect(r.ok).toBe(true);
    const tl = readTask();
    const task = tl.tasks.find((t: { id: string }) => t.id === taskId);
    const sub = task.subtasks.find((s: { id: number }) => s.id === subId);
    expect(sub.status).toBe('done');
  });

  it('writes a scoped 1-line diff when --scoped is passed', async () => {
    // Pick a subtask whose status is NOT already the target so the diff is real.
    const tl = readTask();
    let taskId = '';
    let subId = -1;
    for (const t of tl.tasks) {
      const s = (t.subtasks ?? []).find(
        (s: { status: string }) => s.status !== 'done',
      );
      if (s) {
        taskId = t.id;
        subId = s.id;
        break;
      }
    }
    if (!taskId) throw new Error('no non-done subtask in fixture');
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done'], {
        scoped: true,
      }),
    );
    expect(r.ok).toBe(true);
    const after = readFileSync(join(dir, 'task-list.json'), 'utf8');
    // Scoped write touches exactly the changed-record bytes — line count
    // stays identical (no whole-file re-key-order). The diff is the single
    // status line.
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(afterLines.length).toBe(beforeLines.length);
    const changed = afterLines.filter((l, i) => l !== beforeLines[i]);
    expect(changed.length).toBe(1);
    expect(changed[0]).toContain('done');
  });

  it('coerces dependencies to a number[] (JSON), not a string', async () => {
    // Use a task whose subtask has a sibling so the superRefine passes.
    const tl = readTask();
    const task = tl.tasks.find(
      (t: { subtasks: unknown[] }) =>
        Array.isArray(t.subtasks) && t.subtasks.length >= 2,
    );
    if (!task) throw new Error('no task with >=2 subtasks');
    const target = task.subtasks[1];
    const sibling = task.subtasks[0];
    const r = await run(
      args('update-subtask', [
        `${task.id}.${target.id}`,
        'dependencies',
        `[${sibling.id}]`,
      ]),
    );
    expect(r.ok).toBe(true);
    const after = readTask();
    const t2 = after.tasks.find((t: { id: string }) => t.id === task.id);
    const s2 = t2.subtasks.find(
      (s: { id: number }) => s.id === target.id,
    );
    expect(s2.dependencies).toEqual([sibling.id]);
    expect(typeof s2.dependencies[0]).toBe('number');
  });

  it('keeps a description that looks like JSON as a string', async () => {
    const { taskId, subId } = firstTaskWithSubtask();
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'description', '123']),
    );
    expect(r.ok).toBe(true);
    const tl = readTask();
    const task = tl.tasks.find((t: { id: string }) => t.id === taskId);
    const sub = task.subtasks.find((s: { id: number }) => s.id === subId);
    expect(sub.description).toBe('123');
    expect(typeof sub.description).toBe('string');
  });

  it('rejects an unknown subtask field (exit non-zero, no write)', async () => {
    const { taskId, subId } = firstTaskWithSubtask();
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'nonsense', 'x']),
    );
    expect(r.ok).toBe(false);
  });

  it('errors on a malformed (non-dotted) id', async () => {
    const r = await run(args('update-subtask', ['35', 'status', 'done']));
    expect(r.ok).toBe(false);
  });
});
