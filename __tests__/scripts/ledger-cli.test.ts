/**
 * ledger-cli.test.ts — per-subcommand unit tests for scripts/ledger-cli.ts
 * (ID-35.6–35.9). Drives the exported `run()` directly against a temp dir
 * holding fresh copies of the three real ledgers (guarantees schema-valid
 * fixtures, exercises the vendored primitives end-to-end).
 *
 * Covers PRODUCT inv 1,2,4,5,6,7,8,9,10,11,12,13.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  copyFileSync,
  rmSync,
  readFileSync,
  statSync,
} from 'node:fs';
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-'));
  copyFileSync(REAL.task, join(dir, 'task-list.json'));
  copyFileSync(REAL.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(REAL.backlog, join(dir, 'product-backlog.json'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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
      ledgerDir: dir,
      ...extra,
    },
  };
}

function read(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

function firstTaskId(): string {
  return read('task-list').tasks[0].id;
}
function firstBacklogId(): string {
  return read('product-backlog').items[0].id;
}

describe('ledger-cli — show (inv 12)', () => {
  it('prints an existing task record, read-only', async () => {
    const id = firstTaskId();
    const before = statSync(join(dir, 'task-list.json')).mtimeMs;
    const r = await run(args('show', ['task', id]));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.result as { id: string }).id).toBe(id);
    expect(statSync(join(dir, 'task-list.json')).mtimeMs).toBe(before);
  });

  it('record-not-found for a missing id', async () => {
    const r = await run(args('show', ['task', '99999']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-not-found');
  });

  it('bad-ledger for an unknown ledger name', async () => {
    const r = await run(args('show', ['nope', '1']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-ledger');
  });
});

describe('ledger-cli — flip-subtask / flip-task (inv 6, 13)', () => {
  it('sets a subtask status and re-parses', async () => {
    const taskId = firstTaskId();
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(args('flip-subtask', [taskId, subId, 'done']));
    expect(r.ok).toBe(true);
    const after = read('task-list').tasks.find(
      (t: { id: string }) => t.id === taskId,
    );
    expect(after.subtasks[0].status).toBe('done');
    // task-list mutation surfaces ID-34 discipline warnings (the live ledger is over budget)
    if (r.ok) expect(r.warnings && r.warnings.length).toBeGreaterThan(0);
    // inv 14: a successful write flags mirrors stale (operator must regen)
    if (r.ok) expect(r.mirrorStale).toBe(true);
  });

  it('rejects an invalid status with schema-error and writes nothing (inv 2)', async () => {
    const taskId = firstTaskId();
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(args('flip-task', [taskId, 'not-a-real-status']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('schema-error');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('--dry-run writes nothing (inv 5)', async () => {
    const taskId = firstTaskId();
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { dryRun: true }),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('missing args → missing-args', async () => {
    const r = await run(args('flip-task', []));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing-args');
  });
});

describe('ledger-cli — append-journal (inv 7)', () => {
  it('appends an <info added on …> block, preserving prior details', async () => {
    const taskId = firstTaskId();
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const prior = read('task-list').tasks[0].subtasks[0].details ?? '';
    const r = await run(
      args('append-journal', [taskId, subId, 'S267 test note.']),
    );
    expect(r.ok).toBe(true);
    const after = read('task-list').tasks[0].subtasks[0].details as string;
    expect(after).toContain('S267 test note.');
    expect(after).toMatch(/<info added on .+Z>/);
    if (prior) expect(after.startsWith(prior)).toBe(true);
  });
});

describe('ledger-cli — add-subtask (inv 8)', () => {
  it('appends a valid subtask', async () => {
    const taskId = firstTaskId();
    const count = read('task-list').tasks[0].subtasks.length;
    const newSub = {
      id: 999,
      title: 'CLI-added subtask',
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

  it('rejects a subtask with a cross-sibling dependency (superRefine, inv 8)', async () => {
    const taskId = firstTaskId();
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const badSub = {
      id: 998,
      title: 'Bad dep subtask',
      description: 'Has a non-sibling dep.',
      details: '',
      status: 'pending',
      dependencies: [12345],
      testStrategy: 'n/a',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(badSub)]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('schema-error');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });
});

describe('ledger-cli — open-task / create-backlog / delete-backlog (inv 9, 10, 2)', () => {
  it('rejects a malformed open-task with schema-error, file unchanged (inv 2)', async () => {
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(args('open-task', [JSON.stringify({ id: '9998' })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('schema-error');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('rejects a duplicate id (inv 9)', async () => {
    const existing = firstTaskId();
    const r = await run(args('open-task', [JSON.stringify({ id: existing })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('duplicate-id');
  });

  it('delete-backlog removes an existing item (inv 10)', async () => {
    const id = firstBacklogId();
    const r = await run(args('delete-backlog', [id]));
    expect(r.ok).toBe(true);
    const present = read('product-backlog').items.some(
      (it: { id: string }) => it.id === id,
    );
    expect(present).toBe(false);
  });

  it('delete-backlog absent id → record-not-found, file unchanged', async () => {
    const before = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(args('delete-backlog', ['nonexistent-99999']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-not-found');
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      before,
    );
  });
});

describe('ledger-cli — promote (inv 11)', () => {
  it('schema-invalid taskJson leaves BOTH ledgers unchanged', async () => {
    const backlogId = firstBacklogId();
    const tlBefore = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const blBefore = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(
      args('promote', [backlogId, JSON.stringify({ id: '9997' })]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('schema-error');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(tlBefore);
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      blBefore,
    );
  });

  it('promote absent backlog id → backlog-item-not-found, both unchanged', async () => {
    const tlBefore = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const blBefore = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const task = validTaskRecord('9996');
    const r = await run(
      args('promote', ['nonexistent-1', JSON.stringify(task)]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('backlog-item-not-found');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(tlBefore);
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      blBefore,
    );
  });

  it('successful promote removes the backlog item and inserts the Task', async () => {
    const backlogId = firstBacklogId();
    const task = validTaskRecord('9995');
    const r = await run(args('promote', [backlogId, JSON.stringify(task)]));
    expect(r.ok).toBe(true);
    expect(
      read('task-list').tasks.some((t: { id: string }) => t.id === '9995'),
    ).toBe(true);
    expect(
      read('product-backlog').items.some(
        (it: { id: string }) => it.id === backlogId,
      ),
    ).toBe(false);
  });
});

describe('ledger-cli — dispatch (inv 1, 4)', () => {
  it('unknown subcommand → unknown-subcommand', async () => {
    const r = await run(args('frobnicate', []));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unknown-subcommand');
  });
});

// ── ID-35.11 scoped-write mode ────────────────────────────────────────────────────
//
// --scoped re-emits ONLY the mutated record into the original on-disk text,
// preserving every untouched record byte-for-byte (incl. its \uXXXX escapes).
// Built from an ASCII-only source to dodge high-char mangling.
const RAW_NON_ASCII = new RegExp('[\\u0080-\\uffff]');

function changedLineIndices(before: string, after: string): number[] {
  const b = before.split('\n');
  const a = after.split('\n');
  expect(a.length).toBe(b.length);
  return b
    .map((line, i) => (line === a[i] ? null : i))
    .filter((i): i is number => i !== null);
}

describe('ledger-cli — --scoped write mode (ID-35.11)', () => {
  it('flip-task --scoped changes ONLY the mutated record status line', async () => {
    const taskId = firstTaskId();
    const path = join(dir, 'task-list.json');
    const before = readFileSync(path, 'utf8');
    const current = read('task-list').tasks.find(
      (t: { id: string; status: string }) => t.id === taskId,
    ).status;
    const newStatus = current === 'done' ? 'pending' : 'done';
    const r = await run(args('flip-task', [taskId, newStatus], { scoped: true }));
    expect(r.ok).toBe(true);
    const after = readFileSync(path, 'utf8');
    // Exactly one line differs across the whole 1.4MB file.
    expect(changedLineIndices(before, after)).toHaveLength(1);
  });

  it('flip-subtask --scoped introduces no raw non-ASCII; escapes survive', async () => {
    const taskId = firstTaskId();
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const path = join(dir, 'task-list.json');
    const before = readFileSync(path, 'utf8');
    // Precondition: the real ledger uses escaped em-dashes, never raw ones.
    expect(RAW_NON_ASCII.test(before)).toBe(false);
    expect(before).toContain('\\u2014');
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { scoped: true }),
    );
    expect(r.ok).toBe(true);
    const after = readFileSync(path, 'utf8');
    expect(RAW_NON_ASCII.test(after)).toBe(false);
    expect(after).toContain('\\u2014');
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('done');
  });

  it('append-journal --scoped touches only the mutated subtask details', async () => {
    const taskId = firstTaskId();
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const path = join(dir, 'task-list.json');
    const before = readFileSync(path, 'utf8');
    const r = await run(
      args('append-journal', [taskId, subId, 'Scoped note.'], {
        scoped: true,
      }),
    );
    expect(r.ok).toBe(true);
    const after = readFileSync(path, 'utf8');
    expect(after).not.toBe(before);
    expect(RAW_NON_ASCII.test(after)).toBe(false);
    const detailsAfter = read('task-list').tasks[0].subtasks[0]
      .details as string;
    expect(detailsAfter).toContain('Scoped note.');
    expect(detailsAfter).toMatch(/<info added on .+Z>/);
    // The mutated details is one record; the change is bounded to its block —
    // every line OUTSIDE the first task's subtask[0] details remains stable.
    // Assert the second task's record block survives verbatim.
    const tasks = read('task-list').tasks as { id: string }[];
    if (tasks.length > 1) {
      const secondId = tasks[1].id;
      const idx = before.indexOf(`"id": "${secondId}"`);
      const block = before.slice(idx, idx + 200);
      expect(after).toContain(block);
    }
  });

  it('the scoped result re-parses (detectSchema succeeds)', async () => {
    const taskId = firstTaskId();
    const r = await run(args('flip-task', [taskId, 'in_progress'], { scoped: true }));
    expect(r.ok).toBe(true);
    // read() throws on invalid JSON; detectSchema is exercised inside the CLI
    // before write, and the file remains a valid task-list.
    expect(read('task-list').document_name).toBe('Knowledge Hub Task List');
  });

  it('non-scoped flip-task still uses the whole-file path (unchanged behaviour)', async () => {
    const taskId = firstTaskId();
    const path = join(dir, 'task-list.json');
    const r = await run(args('flip-task', [taskId, 'in_progress']));
    expect(r.ok).toBe(true);
    // Whole-file path normalises (raw UTF-8 + key reorder), so it touches many
    // lines — the diff is NOT bounded to one line. This documents the contrast
    // the --scoped flag exists to avoid.
    const after = readFileSync(path, 'utf8');
    expect(RAW_NON_ASCII.test(after)).toBe(true); // raw em-dashes now present
  });

  it('--scoped --dry-run writes nothing', async () => {
    const taskId = firstTaskId();
    const path = join(dir, 'task-list.json');
    const before = readFileSync(path, 'utf8');
    const r = await run(
      args('flip-task', [taskId, 'done'], { scoped: true, dryRun: true }),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe(before);
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
