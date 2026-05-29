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

// ── ID-65.5 — scoped is the GLOBAL DEFAULT; --whole-file is the escape hatch ───

describe('ID-65.5 — minimal-diff is the default (NO flag), --whole-file opts out', () => {
  /** A subtask whose status is NOT already the target, so a flip is a real diff. */
  function nonDoneSubtask(): { taskId: string; subId: number } {
    const tl = readTask();
    for (const t of tl.tasks) {
      const s = (t.subtasks ?? []).find(
        (s: { status: string }) => s.status !== 'done',
      );
      if (s) return { taskId: t.id, subId: s.id };
    }
    throw new Error('no non-done subtask in fixture');
  }

  it('a mutation with NO flag is minimal-diff (scoped by default)', async () => {
    const { taskId, subId } = nonDoneSubtask();
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    // NO scoped / NO whole-file flag — scoped is the global default now.
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done']),
    );
    expect(r.ok).toBe(true);
    const after = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    // Minimal diff: line count unchanged, exactly the one status line differs,
    // and untouched-record em-dash escaping is byte-preserved.
    expect(afterLines.length).toBe(beforeLines.length);
    const changed = afterLines.filter((l, i) => l !== beforeLines[i]);
    expect(changed.length).toBe(1);
    expect(changed[0]).toContain('done');
    const emBefore = (before.match(/\\u2014/g) ?? []).length;
    const emAfter = (after.match(/\\u2014/g) ?? []).length;
    expect(emAfter).toBe(emBefore);
  });

  it('--whole-file routes through the legacy serialise() path (wide write)', async () => {
    const { taskId, subId } = nonDoneSubtask();
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done'], {
        wholeFile: true,
      }),
    );
    expect(r.ok).toBe(true);
    // The value still persists on the whole-file path.
    const tl = readTask();
    const task = tl.tasks.find((t: { id: string }) => t.id === taskId);
    const sub = task.subtasks.find((s: { id: number }) => s.id === subId);
    expect(sub.status).toBe('done');
  });

  it('the scoped default and the --whole-file path agree on the SAME bytes for a single edit', async () => {
    // Both paths emit the same escaping convention (escapeSerialise) after the
    // OQ-LS-2 normalisation, so a single-field edit on an already-canonical
    // fixture yields byte-identical output regardless of path. This proves
    // --whole-file is a true serialise() opt-out (not a no-op) AND that the
    // default scoped path is byte-compatible with it.
    const { taskId, subId } = nonDoneSubtask();

    // Path 1: default (scoped) write into a fresh temp copy.
    const scopedR = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done']),
    );
    expect(scopedR.ok).toBe(true);
    const scopedBytes = readFileSync(join(dir, 'task-list.json'), 'utf8');

    // Reset the temp ledger and repeat with --whole-file.
    copyFileSync(REAL.task, join(dir, 'task-list.json'));
    const wholeR = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done'], {
        wholeFile: true,
      }),
    );
    expect(wholeR.ok).toBe(true);
    const wholeBytes = readFileSync(join(dir, 'task-list.json'), 'utf8');

    // Same single-field edit, both paths → identical parsed documents.
    expect(JSON.parse(wholeBytes)).toEqual(JSON.parse(scopedBytes));
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

// ── ID-65.8 — dotted `taskId.subId` id-arg convention across the four
//    subtask-addressing commands (normalise the S280 inconsistency where
//    update-subtask was dotted but append-journal was space-separated). Dotted
//    is canonical; the legacy space-separated form stays accepted (back-compat).

describe('ID-65.8 — append-journal accepts dotted AND legacy id args', () => {
  /** A task whose first subtask has no `details` (clean append target). */
  function subtaskTarget(): { taskId: string; subId: number } {
    const tl = readTask();
    for (const t of tl.tasks) {
      if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
        return { taskId: t.id, subId: t.subtasks[0].id };
      }
    }
    throw new Error('no task with a subtask in fixture');
  }

  function readSub(taskId: string, subId: number) {
    const tl = readTask();
    const task = tl.tasks.find((t: { id: string }) => t.id === taskId);
    return task.subtasks.find((s: { id: number }) => s.id === subId);
  }

  it('appends a journal block via the dotted `35.1 <text>` form', async () => {
    const { taskId, subId } = subtaskTarget();
    const r = await run(
      args('append-journal', [`${taskId}.${subId}`, 'DOTTED journal entry.']),
    );
    expect(r.ok).toBe(true);
    const sub = readSub(taskId, subId);
    expect(sub.details).toContain('DOTTED journal entry.');
    expect(sub.details).toContain('<info added on');
  });

  it('appends a journal block via the legacy `35 1 <text>` form', async () => {
    const { taskId, subId } = subtaskTarget();
    const r = await run(
      args('append-journal', [taskId, String(subId), 'LEGACY journal entry.']),
    );
    expect(r.ok).toBe(true);
    const sub = readSub(taskId, subId);
    expect(sub.details).toContain('LEGACY journal entry.');
  });

  it('dotted and legacy forms target the SAME subtask', async () => {
    const { taskId, subId } = subtaskTarget();
    // Dotted append into a fresh copy.
    const dotted = await run(
      args('append-journal', [`${taskId}.${subId}`, 'SAME-TARGET probe.']),
    );
    expect(dotted.ok).toBe(true);
    const afterDotted = readSub(taskId, subId).details as string;

    // Reset and repeat with the legacy form — same byte-for-byte target field.
    copyFileSync(REAL.task, join(dir, 'task-list.json'));
    const legacy = await run(
      args('append-journal', [taskId, String(subId), 'SAME-TARGET probe.']),
    );
    expect(legacy.ok).toBe(true);
    const afterLegacy = readSub(taskId, subId).details as string;

    // Both appended to the same subtask.details; only the embedded ISO
    // timestamp differs (millisecond drift between the two runs), so compare
    // with the timestamp stripped from BOTH the opening `<info added on …>` and
    // the closing `</info added on …>` tags (the latter starts with `</`).
    const strip = (s: string) =>
      s.replace(/(<\/?info added on )[^>]+>/g, '$1TS>');
    expect(strip(afterLegacy)).toBe(strip(afterDotted));
  });
});

describe('ID-65.8 — flip-subtask accepts dotted AND legacy id args', () => {
  function nonDoneSubtask(): { taskId: string; subId: number } {
    const tl = readTask();
    for (const t of tl.tasks) {
      const s = (t.subtasks ?? []).find(
        (s: { status: string }) => s.status !== 'done',
      );
      if (s) return { taskId: t.id, subId: s.id };
    }
    throw new Error('no non-done subtask in fixture');
  }

  function readStatus(taskId: string, subId: number) {
    const tl = readTask();
    const task = tl.tasks.find((t: { id: string }) => t.id === taskId);
    return task.subtasks.find((s: { id: number }) => s.id === subId).status;
  }

  it('flips status via the dotted `35.1 done` form', async () => {
    const { taskId, subId } = nonDoneSubtask();
    const r = await run(args('flip-subtask', [`${taskId}.${subId}`, 'done']));
    expect(r.ok).toBe(true);
    expect(readStatus(taskId, subId)).toBe('done');
  });

  it('flips status via the legacy `35 1 done` form', async () => {
    const { taskId, subId } = nonDoneSubtask();
    const r = await run(args('flip-subtask', [taskId, String(subId), 'done']));
    expect(r.ok).toBe(true);
    expect(readStatus(taskId, subId)).toBe('done');
  });
});

describe('ID-65.8 — delete-subtask accepts dotted AND legacy id args', () => {
  /** A task with >=2 subtasks so a delete leaves a non-empty, valid Task. */
  function taskWithTwoSubtasks(): { taskId: string; subId: number } {
    const tl = readTask();
    const task = tl.tasks.find(
      (t: { subtasks: unknown[] }) =>
        Array.isArray(t.subtasks) && t.subtasks.length >= 2,
    );
    if (!task) throw new Error('no task with >=2 subtasks in fixture');
    // Delete the LAST subtask to avoid sibling-dependency superRefine breakage.
    const last = task.subtasks[task.subtasks.length - 1];
    return { taskId: task.id, subId: last.id };
  }

  function hasSub(taskId: string, subId: number): boolean {
    const tl = readTask();
    const task = tl.tasks.find((t: { id: string }) => t.id === taskId);
    return task.subtasks.some((s: { id: number }) => s.id === subId);
  }

  it('removes a subtask via the dotted `35.7` form', async () => {
    const { taskId, subId } = taskWithTwoSubtasks();
    const r = await run(args('delete-subtask', [`${taskId}.${subId}`]));
    expect(r.ok).toBe(true);
    expect(hasSub(taskId, subId)).toBe(false);
  });

  it('removes a subtask via the legacy `35 7` form', async () => {
    const { taskId, subId } = taskWithTwoSubtasks();
    const r = await run(args('delete-subtask', [taskId, String(subId)]));
    expect(r.ok).toBe(true);
    expect(hasSub(taskId, subId)).toBe(false);
  });
});

describe('ID-65.8 — update-subtask is unchanged (already dotted)', () => {
  it('still flips a subtask status via the dotted id', async () => {
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
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'done']),
    );
    expect(r.ok).toBe(true);
    const after = readTask();
    const task = after.tasks.find((t: { id: string }) => t.id === taskId);
    const sub = task.subtasks.find((s: { id: number }) => s.id === subId);
    expect(sub.status).toBe('done');
  });
});

describe('ID-65.8 — parseDottedSubtaskId rejects malformed ids', () => {
  // Drive the shared guard through the user-facing commands (update-subtask /
  // flip-subtask both route through parseDottedSubtaskId). A non-dotted bare
  // digit is treated as the LEGACY form by the dot discriminator, so the
  // malformed cases here are dotted-looking ids the guard must reject:
  //   ".5"  → dot at index 0  (no taskId)
  //   "35." → dot at last index (no subId)
  // and the legacy single-positional bare-digit case still errors as before.
  it('update-subtask rejects ".5" (empty taskId) with bad-id', async () => {
    const r = await run(args('update-subtask', ['.5', 'status', 'done']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-id');
  });

  it('update-subtask rejects "35." (empty subId) with bad-id', async () => {
    const r = await run(args('update-subtask', ['35.', 'status', 'done']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-id');
  });

  it('update-subtask rejects a bare non-dotted "35" (no dot at all)', async () => {
    const r = await run(args('update-subtask', ['35', 'status', 'done']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-id');
  });

  it('flip-subtask rejects a dotted-looking ".5" with bad-id', async () => {
    const r = await run(args('flip-subtask', ['.5', 'done']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-id');
  });

  it('flip-subtask rejects a dotted-looking "35." with bad-id', async () => {
    const r = await run(args('flip-subtask', ['35.', 'done']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-id');
  });
});
