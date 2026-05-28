/**
 * ledger-cli-autoid-coercion.test.ts — {35.21}: wire the max+1 auto-id helper
 * into all record-creating commands, and replace update-backlog's silent
 * JSON.parse heuristic with field-type-aware coercion.
 *
 * Per RESEARCH §2.2 (auto-id) + §5.3 (field-type-aware coercion); PLAN.md
 * {35.21}. Drives the exported `run()` against a temp dir holding fresh copies
 * of the three real ledgers.
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-aic-'));
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
function readRoadmap() {
  return JSON.parse(readFileSync(join(dir, 'product-roadmap.json'), 'utf8'));
}

describe('auto-id — {35.21} max+1 on record-creating commands', () => {
  it('add-subtask 35 --title X assigns max(existing subId)+1 (number)', async () => {
    const tl = readTask();
    const task35 = tl.tasks.find((t: { id: string }) => t.id === '35');
    if (!task35) throw new Error('task 35 missing in fixture');
    const expected =
      Math.max(...task35.subtasks.map((s: { id: number }) => s.id)) + 1;
    const r = await run(
      args('add-subtask', ['35'], {
        title: 'Auto-id subtask',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    expect(r.ok).toBe(true);
    const after = readTask();
    const t = after.tasks.find((x: { id: string }) => x.id === '35');
    const added = t.subtasks.find(
      (s: { title: string }) => s.title === 'Auto-id subtask',
    );
    expect(added).toBeDefined();
    expect(added.id).toBe(expected);
    expect(typeof added.id).toBe('number');
  });

  it('create-backlog --title Y assigns max(existing item id)+1 (string)', async () => {
    const before = readBacklog();
    const expected = String(
      Math.max(...before.items.map((it: { id: string }) => Number(it.id))) + 1,
    );
    const r = await run(
      args('create-backlog', [], {
        title: 'Auto-id item',
        description: 'A short summary.',
        status: 'parked',
        priority: 'low',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.result as { recordId: string }).recordId).toBe(expected);
    const after = readBacklog();
    expect(after.items.some((it: { id: string }) => it.id === expected)).toBe(
      true,
    );
  });

  it('honours an explicit --id when supplied (no auto-id)', async () => {
    const r = await run(
      args('create-backlog', [], {
        id: '9001',
        title: 'Explicit id item',
        description: 'A short summary.',
        status: 'parked',
        priority: 'low',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.result as { recordId: string }).recordId).toBe('9001');
  });

  it('create-theme --title Z assigns max(existing theme id)+1 (string) ({35.24})', async () => {
    // The theme auto-id path was only proven at the `nextId` helper level; this
    // exercises it end-to-end through `create-theme` (the {35.20} roadmap
    // creator), so the wiring of nextId(themes) → withCreateDefaults → insert is
    // covered for the roadmap ledger the same way it is for backlog above.
    const before = readRoadmap();
    const expected = String(
      Math.max(...before.themes.map((t: { id: string }) => Number(t.id))) + 1,
    );
    const r = await run(
      args('create-theme', [], {
        title: 'Auto-id theme',
        description: 'A theme created without an explicit id.',
        status: 'pending',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.result as { recordId: string }).recordId).toBe(expected);
    expect(typeof (r.result as { recordId: string }).recordId).toBe('string');
    const after = readRoadmap();
    const added = after.themes.find(
      (t: { title: string }) => t.title === 'Auto-id theme',
    );
    expect(added).toBeDefined();
    expect(added.id).toBe(expected);
  });

  it('add-subtask --id N (numeric string) coerces to NUMBER to match subtask.id schema ({35.28})', async () => {
    // RESEARCH: the named-flag parser used to set `record.id = flags.id`
    // verbatim, which left subtask.id as a STRING and tripped schema-error
    // ("subtask.id expected number, received string"). The workaround was to
    // omit --id and rely on auto-id. Per {35.28} the --id flag site now mirrors
    // nextId() policy — number for subtasks, string for tasks/items/themes —
    // so an explicit `--id 27` lands as the integer 27 on the subtask.
    const r = await run(
      args('add-subtask', ['35'], {
        id: '777',
        title: 'Explicit numeric --id subtask',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    expect(r.ok).toBe(true);
    const after = readTask();
    const t = after.tasks.find((x: { id: string }) => x.id === '35');
    const added = t.subtasks.find(
      (s: { title: string }) => s.title === 'Explicit numeric --id subtask',
    );
    expect(added).toBeDefined();
    expect(added.id).toBe(777);
    expect(typeof added.id).toBe('number');
  });

  it('add-subtask --id abc (non-coercible) rejects with a clear error ({35.28})', async () => {
    // The reject-with-warning branch — `--id` is present but not a numeric
    // string in a SUBTASK context, so we surface a structured error envelope
    // rather than passing the wrong type to the schema (the old behaviour
    // produced a confusing downstream schema-error on subtask.id).
    const r = await run(
      args('add-subtask', ['35'], {
        id: 'abc',
        title: 'Non-coercible --id',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid-id');
    expect(r.subcommand).toBe('add-subtask');
    // The detail mentions the bad value so the caller can self-correct.
    expect(r.detail).toMatch(/abc/);
  });

  it('add-subtask --id -1 (negative integer) rejects with invalid-id, not schema-error ({35.28} fix-up)', async () => {
    // Guard text promises "not a positive integer"; behaviour must match.
    // Previously `-1` parsed to integer -1 and slipped through the guard,
    // surfacing as `schema-error` from SubtaskSchema (z.number().int().min(1))
    // instead of the friendlier `invalid-id` envelope.
    const r = await run(
      args('add-subtask', ['35'], {
        id: '-1',
        title: 'Negative --id',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid-id');
    expect(r.subcommand).toBe('add-subtask');
    expect(r.detail).toMatch(/-1/);
  });

  it('add-subtask --id 0 (zero) rejects with invalid-id, not schema-error ({35.28} fix-up)', async () => {
    // Same fix-up: `0` parses to integer 0 and used to fall through to the
    // schema; the guard now matches its own "positive integer" promise.
    const r = await run(
      args('add-subtask', ['35'], {
        id: '0',
        title: 'Zero --id',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid-id');
    expect(r.subcommand).toBe('add-subtask');
    expect(r.detail).toMatch(/0/);
  });

  it('open-task --id N (numeric string) keeps id a STRING to match task.id schema ({35.28})', async () => {
    // The other half of the policy: task / theme / item ids stay bare-digit
    // STRINGS. `--id 9002` on `open-task` must NOT be coerced to a number.
    const r = await run(
      args('open-task', [], {
        id: '9002',
        title: 'Explicit string --id task',
        description: 'A short summary.',
        status: 'pending',
        priority: 'medium',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = readTask();
    const added = after.tasks.find(
      (x: { title: string }) => x.title === 'Explicit string --id task',
    );
    expect(added).toBeDefined();
    expect(added.id).toBe('9002');
    expect(typeof added.id).toBe('string');
  });

  it('positional JSON without an id gets an auto-id injected', async () => {
    const before = readBacklog();
    const expected = String(
      Math.max(...before.items.map((it: { id: string }) => Number(it.id))) + 1,
    );
    const body = {
      description: 'Positional body without id.',
      type: 'feature',
      status: 'parked',
      effort_estimate: null,
      priority: 'low',
      track: 'platform',
      dependencies: [],
      session_refs: [],
      commit_refs: [],
      cross_doc_links: [],
      notes: null,
    };
    const r = await run(args('create-backlog', [JSON.stringify(body)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.result as { recordId: string }).recordId).toBe(expected);
  });
});

describe('update-backlog — {35.21} field-type-aware coercion (RESEARCH §5.3)', () => {
  function firstItemId(): string {
    return readBacklog().items[0].id;
  }

  it('keeps a description that looks like a number a string ("123")', async () => {
    const id = firstItemId();
    const r = await run(args('update-backlog', [id, 'description', '123']));
    expect(r.ok).toBe(true);
    const after = readBacklog();
    const item = after.items.find((it: { id: string }) => it.id === id);
    expect(item.description).toBe('123');
    expect(typeof item.description).toBe('string');
  });

  it('coerces dependencies to a string[] (JSON), not a bare string', async () => {
    const id = firstItemId();
    const r = await run(args('update-backlog', [id, 'dependencies', '["17"]']));
    expect(r.ok).toBe(true);
    const after = readBacklog();
    const item = after.items.find((it: { id: string }) => it.id === id);
    expect(item.dependencies).toEqual(['17']);
  });
});

describe('--depends flag — {35.29} per-record-kind type discrimination', () => {
  // RESEARCH §3 (and TaskSchema/SubtaskSchema/BacklogItemSchema in lib/validation/*):
  //   - task.dependencies     : string[]   (open-task)
  //   - subtask.dependencies  : number[]   (add-subtask) — Taskmaster mandate
  //   - item.dependencies     : string[]   (create-backlog)
  // The {35.15} named-flag parser used to Number()-coerce digit-only tokens of
  // `--depends 6,7` to numbers, which silently broke `open-task` /
  // `create-backlog` with a confusing `schema-error` ("expected string, received
  // number") and only happened to work for `add-subtask`. {35.29} mirrors the
  // {35.28} --id pattern: emit string[] from the parser; coerce to number[] at
  // the `add-subtask` call site only.

  it('open-task --depends 6,7 lands as string[] on task.dependencies', async () => {
    const r = await run(
      args('open-task', [], {
        title: 'Deps-string task',
        description: 'A short summary.',
        status: 'pending',
        priority: 'medium',
        depends: '6,7',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = readTask();
    const added = after.tasks.find(
      (t: { title: string }) => t.title === 'Deps-string task',
    );
    expect(added).toBeDefined();
    expect(added.dependencies).toEqual(['6', '7']);
    for (const d of added.dependencies) expect(typeof d).toBe('string');
  });

  it('add-subtask --depends 1,2 lands as number[] on subtask.dependencies (regression)', async () => {
    // The {35.29} fix MUST NOT regress {35.28}'s subtask behaviour: subtask.id
    // is a number, subtask.dependencies is number[], so the add-subtask call
    // site coerces the parsed string[] back to number[] before insertion.
    const r = await run(
      args('add-subtask', ['35'], {
        title: 'Deps-number subtask',
        description: 'A short summary.',
        status: 'pending',
        depends: '1,2',
      }),
    );
    expect(r.ok).toBe(true);
    const after = readTask();
    const t = after.tasks.find((x: { id: string }) => x.id === '35');
    const added = t.subtasks.find(
      (s: { title: string }) => s.title === 'Deps-number subtask',
    );
    expect(added).toBeDefined();
    expect(added.dependencies).toEqual([1, 2]);
    for (const d of added.dependencies) expect(typeof d).toBe('number');
  });

  it('create-backlog --depends 17,18 lands as string[] on item.dependencies', async () => {
    const r = await run(
      args('create-backlog', [], {
        title: 'Deps-string item',
        description: 'A short summary.',
        status: 'parked',
        priority: 'low',
        depends: '17,18',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const recordId = (r.result as { recordId: string }).recordId;
    const after = readBacklog();
    const added = after.items.find((it: { id: string }) => it.id === recordId);
    expect(added).toBeDefined();
    expect(added.dependencies).toEqual(['17', '18']);
    for (const d of added.dependencies) expect(typeof d).toBe('string');
  });

  it('add-subtask --depends with non-numeric token rejects with invalid-depends', async () => {
    // Mirrors the {35.28} --id reject path: a non-coercible token in a context
    // requiring number[] is surfaced as a structured envelope rather than
    // passed to the schema as a confusing `schema-error`.
    const r = await run(
      args('add-subtask', ['35'], {
        title: 'Bad-deps subtask',
        description: 'A short summary.',
        status: 'pending',
        depends: '1,abc',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid-depends');
    expect(r.subcommand).toBe('add-subtask');
    expect(r.detail).toMatch(/abc/);
  });
});
