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
function readRoadmap() {
  return JSON.parse(readFileSync(join(dir, 'product-roadmap.json'), 'utf8'));
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
    const s2 = t2.subtasks.find((s: { id: number }) => s.id === target.id);
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

describe('update-task — {35.20} task field editor', () => {
  it('edits a task field (status_note) and persists', async () => {
    const tl = readTask();
    const taskId = tl.tasks[0].id;
    const r = await run(
      args('update-task', [taskId, 'status_note', 'Edited by test.']),
    );
    expect(r.ok).toBe(true);
    const after = readTask();
    const task = after.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.status_note).toBe('Edited by test.');
  });

  it('rejects an unknown task field', async () => {
    const tl = readTask();
    const taskId = tl.tasks[0].id;
    const r = await run(args('update-task', [taskId, 'nonsense', 'x']));
    expect(r.ok).toBe(false);
  });

  // ── {35.40} regression guard: `update-task --scoped` minimal diff on
  //    `status_note`. {35.40}'s editor was shipped in ID-35.11/35.20 (it already
  //    threads `scoped` + `scopedWrite` into commitMutation, mirroring
  //    update-subtask). The line-86 test above guards update-subtask --scoped;
  //    these two cases close the testStrategy gap for the update-task status_note
  //    path specifically — the S276 scenario being an edit of an EXISTING note.
  it('writes a scoped minimal diff when editing an existing status_note (S276 case)', async () => {
    // Pick a task whose status_note is a non-empty string WITHOUT an em-dash, so
    // the edit is a real value→value change (the S276 scenario) and overwriting
    // it cannot itself perturb the file-wide em-dash escape count — that count
    // must stay invariant purely because untouched records are byte-preserved.
    const tl = readTask();
    const target = tl.tasks.find(
      (t: { status_note: unknown }) =>
        typeof t.status_note === 'string' &&
        (t.status_note as string).length > 0 &&
        !(t.status_note as string).includes('—'),
    );
    if (!target) {
      throw new Error('no task with a non-empty em-dash-free status_note');
    }

    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    // Sanity: the on-disk serialiser ASCII-escapes non-ASCII, so em-dashes from
    // "S58 —" status_note prefixes appear as the escape sequence `—`. We
    // assert these escapes survive the scoped write byte-for-byte (no whole-file
    // UTF-8↔escape re-encode sweep).
    const emDashEscapesBefore = (before.match(/\\u2014/g) ?? []).length;
    expect(emDashEscapesBefore).toBeGreaterThan(0);

    const r = await run(
      args('update-task', [target.id, 'status_note', 'Edited by the test.'], {
        scoped: true,
      }),
    );
    expect(r.ok).toBe(true);

    const after = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');

    // No whole-file re-key-order / re-escape: total line count is unchanged.
    expect(afterLines.length).toBe(beforeLines.length);

    // The diff is exactly the status_note line(s) — a single-line scalar value
    // is one changed line. Allow ≤3 to tolerate fixtures where a long note
    // wrapped across lines, but the canonical case is 1.
    const changed = afterLines.filter((l, i) => l !== beforeLines[i]);
    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.length).toBeLessThanOrEqual(3);
    // Every changed line belongs to the status_note edit.
    for (const line of changed) {
      expect(line).toMatch(/status_note|Edited by the test\./);
    }

    // Em-dash escaping elsewhere in the file is untouched (no UTF-8↔\uXXXX
    // re-encode sweep on the whole file): the `—` escape count is unchanged.
    const emDashEscapesAfter = (after.match(/\\u2014/g) ?? []).length;
    expect(emDashEscapesAfter).toBe(emDashEscapesBefore);

    // The mutated record reads back correctly; the JSON still parses.
    const parsed = JSON.parse(after);
    const t2 = parsed.tasks.find((t: { id: string }) => t.id === target.id);
    expect(t2.status_note).toBe('Edited by the test.');
  });

  it('writes a scoped minimal diff when setting status_note from null', async () => {
    // The null→value case: a task whose status_note is currently null.
    const tl = readTask();
    const target = tl.tasks.find(
      (t: { status_note: unknown }) => t.status_note === null,
    );
    if (!target) throw new Error('no task with a null status_note');

    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(
      args('update-task', [target.id, 'status_note', 'Now has a note.'], {
        scoped: true,
      }),
    );
    expect(r.ok).toBe(true);

    const after = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');

    // Replacing `null` with a quoted string is a one-for-one line replacement —
    // line count unchanged, exactly the status_note line differs.
    expect(afterLines.length).toBe(beforeLines.length);
    const changed = afterLines.filter((l, i) => l !== beforeLines[i]);
    expect(changed.length).toBe(1);
    expect(changed[0]).toContain('status_note');
    expect(changed[0]).toContain('Now has a note.');

    const parsed = JSON.parse(after);
    const t2 = parsed.tasks.find((t: { id: string }) => t.id === target.id);
    expect(t2.status_note).toBe('Now has a note.');
  });
});

describe('update-roadmap — {35.20} theme field editor (gap: no editor today)', () => {
  it('edits a theme field (notes) and persists', async () => {
    const rm = readRoadmap();
    const themeId = rm.themes[0].id;
    const r = await run(
      args('update-roadmap', [themeId, 'notes', 'Edited theme note.']),
    );
    expect(r.ok).toBe(true);
    const after = readRoadmap();
    const theme = after.themes.find((t: { id: string }) => t.id === themeId);
    expect(theme.notes).toBe('Edited theme note.');
  });

  it('rejects an unknown theme field', async () => {
    const rm = readRoadmap();
    const themeId = rm.themes[0].id;
    const r = await run(args('update-roadmap', [themeId, 'nonsense', 'x']));
    expect(r.ok).toBe(false);
  });
});

describe('create-theme — {35.20} roadmap record create', () => {
  const NEW_THEME = {
    id: '9991',
    title: 'Test theme',
    description: 'A theme created by the test.',
    time_horizon: 'later',
    status: 'pending',
    linked_tasks: [],
    linked_backlog: [],
    session_refs: [],
    commit_refs: [],
    cross_doc_links: [],
    notes: null,
  };

  it('inserts a new theme and persists', async () => {
    const r = await run(args('create-theme', [JSON.stringify(NEW_THEME)]));
    expect(r.ok).toBe(true);
    const after = readRoadmap();
    expect(after.themes.some((t: { id: string }) => t.id === '9991')).toBe(
      true,
    );
  });

  it('rejects an unknown field on the new theme', async () => {
    const bad = { ...NEW_THEME, id: '9992', nonsense: true };
    const r = await run(args('create-theme', [JSON.stringify(bad)]));
    expect(r.ok).toBe(false);
  });
});
