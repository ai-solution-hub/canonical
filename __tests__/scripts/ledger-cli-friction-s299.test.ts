/**
 * ledger-cli-friction-s299.test.ts — the S299 ledger-CLI usage-friction fixes
 * (docs/themes/canonical-pipeline/reference/ledger-cli-friction-s299.md):
 *
 *   F5 — disambiguate status-setting: `flip-task` is the canonical verb; the
 *        `update-task <id> status <value>` generic-editor path still works but
 *        emits a non-fatal hint pointing at flip-task, and both help texts name
 *        flip-task as canonical.
 *   F6 — the per-call `--no-regen-mirrors` reminder is ONE concise line (was a
 *        multi-line banner repeated on every op of a ~30-op batch).
 *   F7 — `update-*` field-value edits accept the VALUE via `--file <path>` /
 *        `--file -` (stdin), mirroring the record-creating commands; a
 *        shell-mis-parsed invocation (extra positionals) exits NON-ZERO with
 *        `unexpected-args` instead of silently truncating the write.
 *
 * Real-behaviour: drives the exported `run()` against TEMP COPIES of the three
 * real ledgers (never the live files — dogfooding hazard). The stdin (`--file
 * -`) case spawns the CLI as a subprocess and feeds the body on fd 0 (the only
 * faithful way to exercise the `readFileSync(0, …)` branch).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { run, subcommandHelp, type ParsedArgs } from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-friction-'));
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
function readBacklog() {
  return JSON.parse(readFileSync(join(dir, 'product-backlog.json'), 'utf8'));
}
function firstTaskId(): string {
  return readTask().tasks[0].id;
}
function firstTaskWithSubtask(): { taskId: string; subId: number } {
  for (const t of readTask().tasks) {
    if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
      return { taskId: t.id, subId: t.subtasks[0].id };
    }
  }
  throw new Error('no task with a subtask in fixture');
}

// ── F5 — flip-task is the canonical status verb ───────────────────────────────

describe('S299 F5 — status-setting disambiguation (flip-task canonical)', () => {
  it('update-task <id> status <value> emits a non-fatal hint pointing at flip-task', async () => {
    const taskId = firstTaskId();
    // ID-90.22 R1a: the flip-task canonical-verb HINT is a CLI-side advisory
    // computed in run() and threaded as commitMutation `extraWarnings`. It is
    // surfaced on the LOCAL write path; the SCOPED→server path's success
    // envelope threads only `resultPayload` (the K5 deep-equal parity contract
    // covers files + result + exit code "modulo retry warnings", NOT advisory
    // warnings — re-homing advisory warnings to the server is downstream of this
    // cutover). `--whole-file` keeps the write LOCAL under flag-ON (GAP-2a, a
    // path R1a deliberately does not migrate), so the still-live hint behaviour
    // is asserted there — the canonical in-repo observable for this advisory.
    const r = await run(
      args('update-task', [taskId, 'status', 'in_progress'], {
        dryRun: true,
        wholeFile: true,
      }),
    );
    // The edit still SUCCEEDS — the hint is advisory, never a rejection.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toBeDefined();
      expect(
        (r.warnings ?? []).some(
          (w) => w.includes('flip-task') && w.includes(taskId),
        ),
      ).toBe(true);
    }
  });

  it('update-task on a NON-status field emits no flip-task hint', async () => {
    const taskId = firstTaskId();
    // Asserted on the LOCAL `--whole-file` path (GAP-2a) where advisory warnings
    // ARE threaded — so the ABSENCE of the hint proves the field-discriminating
    // logic (status-only), not that the write path silently drops all warnings.
    const r = await run(
      args('update-task', [taskId, 'status_note', 'Edited.'], {
        dryRun: true,
        wholeFile: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.warnings ?? []).some((w) => w.includes('flip-task'))).toBe(
        false,
      );
    }
  });

  it('update-task still writes the status (the generic-editor path is preserved)', async () => {
    const taskId = firstTaskId();
    const r = await run(args('update-task', [taskId, 'status', 'in_progress']));
    expect(r.ok).toBe(true);
    const t = readTask().tasks.find((x: { id: string }) => x.id === taskId);
    expect(t.status).toBe('in_progress');
  });

  it('update-task --help names flip-task as the canonical status verb', () => {
    const help = subcommandHelp('update-task');
    expect(help).not.toBeNull();
    expect(help).toContain('flip-task');
    expect(help).toMatch(/canonical/i);
  });

  it('flip-task --help names itself as the canonical status verb', () => {
    const help = subcommandHelp('flip-task');
    expect(help).not.toBeNull();
    expect(help).toMatch(/canonical/i);
  });
});

// ── F6 — collapsed single-line suppressed-mirror reminder ─────────────────────
//
// ID-90.22 R1a: the `mirrorReminderFor` unit tests are RETIRED (R2 deletes the
// symbol; reminder PROSE composition moved upstream with server-side regen).
// The OPERATOR-FACING contract — a single concise stderr line carrying the
// actionable info when regen is suppressed — is now asserted END-TO-END over a
// REAL server-routed write (KH_LEDGER_SERVER unset → ON, ephemeral server for
// the scratch ledger dir): the prose goes to STDERR only (never stdout, inv 13)
// and stays one line.

describe('S299 F6 — suppressed-mirror reminder is one concise stderr line', () => {
  it('a --no-regen-mirrors write emits the one-line suppressed reminder on stderr only', () => {
    const taskId = firstTaskId();
    const cliPath = resolve(REPO, 'scripts/ledger-cli.ts');
    const proc = spawnSync(
      'bun',
      [
        cliPath,
        'flip-task',
        taskId,
        'in_progress',
        '--no-regen-mirrors',
        '--ledger-dir',
        dir,
      ],
      { encoding: 'utf8', cwd: REPO },
    );
    expect(proc.status).toBe(0);
    const stderr = proc.stderr ?? '';
    // The reminder line is present on stderr and carries the actionable info.
    const reminderLines = stderr
      .split('\n')
      .filter((l) => /mirror regen suppressed/i.test(l));
    expect(reminderLines).toHaveLength(1);
    const line = reminderLines[0];
    expect(line).toMatch(/regen-mirrors\.sh/);
    expect(line).toMatch(/--no-regen-mirrors/);
    // The machine-readable envelope is the SOLE stdout payload (no prose leak).
    expect(proc.stdout ?? '').not.toMatch(/mirror regen suppressed/i);
    const parsed = JSON.parse((proc.stdout ?? '').trim());
    expect(parsed.ok).toBe(true);
  });
});

// ── F7 — --file/stdin value input + no silent no-op on a mis-parse ────────────

describe('S299 F7 — field-edit value via --file / stdin', () => {
  it('update-task <field> --file <path> reads the value from the file', async () => {
    const taskId = firstTaskId();
    const file = join(dir, 'body.md');
    const body =
      'A long multi-clause description.\nLine two.\nLine three — with detail.';
    // Trailing newline (cat/editor artefact) must be stripped.
    writeFileSync(file, `${body}\n`, 'utf8');
    const r = await run(args('update-task', [taskId, 'description'], { file }));
    expect(r.ok).toBe(true);
    const t = readTask().tasks.find((x: { id: string }) => x.id === taskId);
    expect(t.description).toBe(body);
  });

  it('a file value coerces identically to the same value supplied inline', async () => {
    const taskId = firstTaskId();
    // Inline path.
    await run(args('update-task', [taskId, 'status_note', 'Parity check.']));
    const inlineVal = readTask().tasks.find(
      (x: { id: string }) => x.id === taskId,
    ).status_note;
    // Reset and repeat via --file (with a trailing newline).
    copyFileSync(REAL.task, join(dir, 'task-list.json'));
    const f = join(dir, 'sn.txt');
    writeFileSync(f, 'Parity check.\n', 'utf8');
    await run(args('update-task', [taskId, 'status_note'], { file: f }));
    const fileVal = readTask().tasks.find(
      (x: { id: string }) => x.id === taskId,
    ).status_note;
    expect(fileVal).toBe(inlineVal);
    expect(fileVal).toBe('Parity check.');
  });

  it('update-backlog notes --file reads the value from the file', async () => {
    const itemId = readBacklog().items[0].id;
    const f = join(dir, 'notes.txt');
    writeFileSync(f, 'File-supplied notes.\n', 'utf8');
    const r = await run(args('update-backlog', [itemId, 'notes'], { file: f }));
    expect(r.ok).toBe(true);
    const it = readBacklog().items.find((x: { id: string }) => x.id === itemId);
    expect(it.notes).toBe('File-supplied notes.');
  });

  it('update-subtask <field> --file reads the value from the file', async () => {
    const { taskId, subId } = firstTaskWithSubtask();
    const f = join(dir, 'sub.md');
    writeFileSync(f, 'Subtask body from file.\n', 'utf8');
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'description'], {
        file: f,
      }),
    );
    expect(r.ok).toBe(true);
    const sub = readTask()
      .tasks.find((x: { id: string }) => x.id === taskId)
      .subtasks.find((s: { id: number }) => s.id === subId);
    expect(sub.description).toBe('Subtask body from file.');
  });

  it('a JSON-typed field (dependencies) via --file still JSON-coerces', async () => {
    const tl = readTask();
    // A task whose subtask has a sibling so the superRefine passes.
    const task = tl.tasks.find(
      (t: { subtasks: unknown[] }) =>
        Array.isArray(t.subtasks) && t.subtasks.length >= 2,
    );
    if (!task) throw new Error('no task with >=2 subtasks');
    const target = task.subtasks[1];
    const sibling = task.subtasks[0];
    const f = join(dir, 'deps.json');
    writeFileSync(f, `[${sibling.id}]\n`, 'utf8');
    const r = await run(
      args('update-subtask', [`${task.id}.${target.id}`, 'dependencies'], {
        file: f,
      }),
    );
    expect(r.ok).toBe(true);
    const t2 = readTask().tasks.find((t: { id: string }) => t.id === task.id);
    const s2 = t2.subtasks.find((s: { id: number }) => s.id === target.id);
    expect(s2.dependencies).toEqual([sibling.id]);
    expect(typeof s2.dependencies[0]).toBe('number');
  });

  it('a missing --file exits NON-ZERO (input-read-failed), never a silent no-op', async () => {
    const taskId = firstTaskId();
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(
      args('update-task', [taskId, 'description'], {
        file: join(dir, 'does-not-exist.md'),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('input-read-failed');
    // Ledger untouched.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('stdin via `--file -` supplies the value (subprocess, body on fd 0)', () => {
    const taskId = firstTaskId();
    const cliPath = resolve(REPO, 'scripts/ledger-cli.ts');
    const body = 'Value piped on stdin.';
    const proc = spawnSync(
      'bun',
      [
        cliPath,
        'update-task',
        taskId,
        'status_note',
        '--file',
        '-',
        '--ledger-dir',
        dir,
        '--no-regen-mirrors',
      ],
      { encoding: 'utf8', input: body, cwd: REPO },
    );
    expect(proc.status).toBe(0);
    const t = readTask().tasks.find((x: { id: string }) => x.id === taskId);
    expect(t.status_note).toBe(body);
  });
});

describe('S299 F7 — a shell mis-parse exits non-zero (no silent truncation)', () => {
  it('update-task with EXTRA positionals → unexpected-args, ledger untouched', async () => {
    const taskId = firstTaskId();
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    // Simulates a shell that mis-split an unquoted multi-word value: the old
    // code used only p[2] ("first") and silently dropped "word"/"dropped".
    const r = await run(
      args('update-task', [taskId, 'status_note', 'first', 'word', 'dropped']),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('unexpected-args');
      // The detail names the dropped tokens so the operator sees what was lost.
      expect(r.detail).toContain('word');
      expect(r.detail).toContain('--file');
    }
    // Nothing written.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('update-backlog with EXTRA positionals → unexpected-args', async () => {
    const itemId = readBacklog().items[0].id;
    const r = await run(
      args('update-backlog', [itemId, 'notes', 'one', 'two']),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unexpected-args');
  });

  it('a positional value ALONGSIDE --file is rejected (ambiguous → unexpected-args)', async () => {
    const taskId = firstTaskId();
    const f = join(dir, 'b.md');
    writeFileSync(f, 'from file\n', 'utf8');
    // id + field + a stray positional value, AND --file → arity max is 2.
    const r = await run(
      args('update-task', [taskId, 'description', 'stray-positional'], {
        file: f,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unexpected-args');
  });

  it('the canonical 3-positional form is still accepted (no false positive)', async () => {
    const taskId = firstTaskId();
    const r = await run(
      args('update-task', [taskId, 'status_note', 'A single quoted value.']),
    );
    expect(r.ok).toBe(true);
    const t = readTask().tasks.find((x: { id: string }) => x.id === taskId);
    expect(t.status_note).toBe('A single quoted value.');
  });
});
