/**
 * ledger-cli-promote-input.test.ts — ID-65.7 (friction #6). End-to-end
 * coverage that `promote` resolves its task body through the {35.15}
 * `readRecordInput` resolver — positional JSON | --file <path> | stdin
 * (`--file -`) | named flags — instead of the old positional-JSON-only
 * `parseJsonArg` path. `backlogId` stays positional.
 *
 * Real-behaviour: drives the exported `run()` against TEMP COPIES of the three
 * real ledgers (never the live files — dogfooding hazard). The stdin (`--file
 * -`) case spawns the CLI as a subprocess and feeds the body on fd 0, the only
 * faithful way to exercise the `readFileSync(0, …)` branch.
 *
 * Acceptance (per the {65.7} ledger record):
 *   - `promote <backlogId> --file task.json` works.
 *   - `cat task.json | promote <backlogId> --file -` works.
 *   - positional JSON still works (back-compat).
 *   - named flags resolve (the resolution path is reached).
 *   - `--capability-theme` still binds via the new resolution path.
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
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

// ID-68.35: repointed from docs/reference/ live ledgers to synthetic fixtures.
const REPO = resolve(__dirname, '../..');
const FIXTURES = {
  task: resolve(__dirname, '../fixtures/ledger/task-list.json'),
  roadmap: resolve(__dirname, '../fixtures/ledger/product-roadmap.json'),
  backlog: resolve(__dirname, '../fixtures/ledger/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-promote-input-'));
  copyFileSync(FIXTURES.task, join(dir, 'task-list.json'));
  copyFileSync(FIXTURES.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(FIXTURES.backlog, join(dir, 'product-backlog.json'));
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
      // Suppress the default-on mirror regen so tests never shell out.
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}

function read(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}
function firstBacklogId(): string {
  return read('product-backlog').items[0].id;
}
function firstThemeId(): string {
  return read('product-roadmap').themes[0].id;
}

/** Schema-valid, COMPLETE Task record (promote applies no auto-id/defaults). */
function validTaskRecord(id: string) {
  return {
    id,
    title: 'Promoted task',
    description: 'Compact what+why.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks: [],
    updatedAt: '2026-05-29T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}

/** Assert a Task with `id` is present in task-list and `backlogId` removed. */
function expectPromoted(id: string, backlogId: string) {
  expect(read('task-list').tasks.some((t: { id: string }) => t.id === id)).toBe(
    true,
  );
  expect(
    read('product-backlog').items.some(
      (it: { id: string }) => it.id === backlogId,
    ),
  ).toBe(false);
}

describe('ledger-cli — promote input modes (ID-65.7)', () => {
  it('positional JSON still promotes (back-compat — unchanged surface)', async () => {
    const backlogId = firstBacklogId();
    const r = await run(
      args('promote', [backlogId, JSON.stringify(validTaskRecord('9971'))]),
    );
    expect(r.ok).toBe(true);
    expectPromoted('9971', backlogId);
  });

  it('--file <path> promotes the same Task (body read from a file)', async () => {
    const backlogId = firstBacklogId();
    const file = join(dir, 'task.json');
    writeFileSync(file, JSON.stringify(validTaskRecord('9972')), 'utf8');
    // backlogId stays positional; the body comes from --file.
    const r = await run(args('promote', [backlogId], { file }));
    expect(r.ok).toBe(true);
    expectPromoted('9972', backlogId);
  });

  it('--file and positional JSON produce an equivalent promoted Task', async () => {
    // Two fresh temp dirs (one per beforeEach is shared; use distinct backlog
    // ids by promoting the same backlog item in independent runs is not
    // possible, so compare the inserted Task records field-by-field instead).
    const backlogId = firstBacklogId();
    const file = join(dir, 'task.json');
    writeFileSync(file, JSON.stringify(validTaskRecord('9973')), 'utf8');
    const r = await run(args('promote', [backlogId], { file }));
    expect(r.ok).toBe(true);
    const fromFile = read('task-list').tasks.find(
      (t: { id: string }) => t.id === '9973',
    );
    // The inserted record equals the supplied (complete) body verbatim. S299
    // F1 runs withCreateDefaults on promote, but defaults only fill ABSENT keys
    // — a COMPLETE body keeps every supplied value (and there is no auto-id, so
    // task.id is the body's id). See the dedicated F1 block below.
    expect(fromFile).toEqual(validTaskRecord('9973'));
  });

  it('stdin via `--file -` promotes (subprocess, body on fd 0)', () => {
    const backlogId = firstBacklogId();
    const cliPath = resolve(REPO, 'scripts/ledger-cli.ts');
    const body = JSON.stringify(validTaskRecord('9974'));
    const proc = spawnSync(
      'bun',
      [
        cliPath,
        'promote',
        backlogId,
        '--file',
        '-',
        '--ledger-dir',
        dir,
        '--no-regen-mirrors',
      ],
      { encoding: 'utf8', input: body, cwd: REPO },
    );
    expect(proc.status).toBe(0);
    expectPromoted('9974', backlogId);
  });

  it('--file - (stdin) and --file <path> yield the same inserted Task', () => {
    // Run --file - in a subprocess, then read the inserted record and compare
    // to the canonical body — proving the stdin path resolves identically.
    const backlogId = firstBacklogId();
    const cliPath = resolve(REPO, 'scripts/ledger-cli.ts');
    const body = JSON.stringify(validTaskRecord('9975'));
    const proc = spawnSync(
      'bun',
      [
        cliPath,
        'promote',
        backlogId,
        '--file',
        '-',
        '--ledger-dir',
        dir,
        '--no-regen-mirrors',
      ],
      { encoding: 'utf8', input: body, cwd: REPO },
    );
    expect(proc.status).toBe(0);
    const inserted = read('task-list').tasks.find(
      (t: { id: string }) => t.id === '9975',
    );
    expect(inserted).toEqual(validTaskRecord('9975'));
  });

  it('named flags reach the resolution path (sparse body → schema-error, not crash)', async () => {
    // Named flags resolve into a record per {35.15}. S299 F1 runs
    // withCreateDefaults on promote (filling the optional structural fields),
    // but promote has NO auto-id — so this scalar-only named-flags body is still
    // incomplete (no task.id) and the insertRecord Zod parse rejects it. The
    // point under test: the named-flags INPUT MODE is reached (we get a
    // structured schema-error envelope, never a missing-args/crash), proving
    // promote routes through readRecordInput.
    const backlogId = firstBacklogId();
    const r = await run(
      args('promote', [backlogId], {
        title: 'A named-flags task',
        description: 'Built from flags.',
        status: 'pending',
        priority: 'should',
      }),
    );
    expect(r.ok).toBe(false);
    // A scalar-only named-flags body is structurally incomplete; insertRecord's
    // gate rejects it with a structured envelope (schema-error for a typed-field
    // mismatch, or invalid-body for a shape that fails the pre-Zod guard). The
    // point is the named-flags INPUT MODE was reached and resolved — not a
    // missing-args/crash — so promote routed through readRecordInput.
    if (!r.ok) expect(['schema-error', 'invalid-body']).toContain(r.error);
    // Nothing written — both ledgers pristine.
    expect(
      read('product-backlog').items.some(
        (it: { id: string }) => it.id === backlogId,
      ),
    ).toBe(true);
  });

  it('missing body (only backlogId, no positional/--file/flags) → resolver missing-args with the input-mode hint', async () => {
    const backlogId = firstBacklogId();
    const r = await run(args('promote', [backlogId]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('missing-args');
      // The detail is the RESOLVER's (lists --file/stdin/named flags) — proving
      // the no-body case flows through readRecordInput, not the dispatch's bare
      // backlogId guard.
      expect(r.detail).toContain('--file');
    }
  });

  it('missing backlogId still → missing-args (positional contract preserved)', async () => {
    const r = await run(args('promote', []));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing-args');
  });

  it('malformed positional JSON → invalid-json-arg (back-compat error surface)', async () => {
    const backlogId = firstBacklogId();
    const r = await run(args('promote', [backlogId, '{ not json']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid-json-arg');
  });
});

// ── S299 friction F1 — promote auto-fills the optional Task fields ────────────
// Before F1 the caller had to hand-supply updatedAt + owner/priority_note/
// status_note (null) + cross_doc_links/session_refs/commit_refs ([]) or promote
// rejected with schema-error. F1 reaches parity with `open-task` (which already
// runs withCreateDefaults): the caller supplies ONLY the meaningful fields and
// promote fills the rest + auto-stamps updatedAt. A COMPLETE body still
// round-trips verbatim (defaults fill ABSENT keys only).

/** ONLY the meaningful fields — the F1 minimal promote body. */
function meaningfulOnlyTask(id: string) {
  return {
    id,
    title: 'F1 minimal promote',
    description: 'Only the meaningful fields supplied.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks: [],
  };
}

describe('ledger-cli — promote auto-fills optional fields (S299 F1)', () => {
  it('promote --dry-run succeeds with ONLY the meaningful fields (was schema-error pre-F1)', async () => {
    const backlogId = firstBacklogId();
    const r = await run(
      args('promote', [backlogId, JSON.stringify(meaningfulOnlyTask('9961'))], {
        dryRun: true,
      }),
    );
    // The exact F1 acceptance: a minimal body that previously needed the 7
    // hand-supplied fields now validates and reports the dry-run delta.
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result).toMatchObject({
        dryRun: true,
        newTaskId: '9961',
        removedBacklogId: backlogId,
      });
    }
  });

  it('a real promote with ONLY the meaningful fields fills nullable→null, array→[], and stamps updatedAt', async () => {
    const backlogId = firstBacklogId();
    const r = await run(
      args('promote', [backlogId, JSON.stringify(meaningfulOnlyTask('9962'))]),
    );
    expect(r.ok).toBe(true);
    const t = read('task-list').tasks.find(
      (x: { id: string }) => x.id === '9962',
    );
    expect(t).toBeDefined();
    // nullable→null
    expect(t.owner).toBeNull();
    expect(t.priority_note).toBeNull();
    expect(t.status_note).toBeNull();
    expect(t.effort_estimate).toBeNull();
    // array→[]
    expect(t.cross_doc_links).toEqual([]);
    expect(t.session_refs).toEqual([]);
    expect(t.commit_refs).toEqual([]);
    // updatedAt auto-stamped to a non-empty ISO string
    expect(typeof t.updatedAt).toBe('string');
    expect(t.updatedAt.length).toBeGreaterThan(0);
    expect(() => new Date(t.updatedAt).toISOString()).not.toThrow();
    // The meaningful fields are preserved verbatim.
    expect(t.title).toBe('F1 minimal promote');
    expect(t.priority).toBe('should');
  });

  it('a COMPLETE body still round-trips verbatim (defaults only fill absent keys)', async () => {
    const backlogId = firstBacklogId();
    const complete = validTaskRecord('9963');
    const r = await run(args('promote', [backlogId, JSON.stringify(complete)]));
    expect(r.ok).toBe(true);
    const t = read('task-list').tasks.find(
      (x: { id: string }) => x.id === '9963',
    );
    // Deep-equality (order-insensitive): the supplied complete body is unchanged
    // — auto-fill never overwrites a supplied value, including updatedAt.
    expect(t).toEqual(complete);
    expect(t.updatedAt).toBe('2026-05-29T00:00:00.000Z');
  });

  it('caller-supplied updatedAt is NOT overwritten by the auto-stamp', async () => {
    const backlogId = firstBacklogId();
    const body = {
      ...meaningfulOnlyTask('9964'),
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
    const r = await run(args('promote', [backlogId, JSON.stringify(body)]));
    expect(r.ok).toBe(true);
    const t = read('task-list').tasks.find(
      (x: { id: string }) => x.id === '9964',
    );
    expect(t.updatedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('still rejects a body missing a meaningful required field (no validation hole)', async () => {
    // Auto-fill covers the OPTIONAL structural fields only; a body missing a
    // required scalar (priority) is still a schema-error, and no id auto-fill
    // means a body missing id also fails. Both ledgers stay pristine.
    const backlogId = firstBacklogId();
    const tlBefore = read('task-list');
    const { priority: _omit, ...noPriority } = meaningfulOnlyTask('9965');
    const r = await run(
      args('promote', [backlogId, JSON.stringify(noPriority)]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('schema-error');
    // Source item not removed; no Task added.
    expect(
      read('product-backlog').items.some(
        (it: { id: string }) => it.id === backlogId,
      ),
    ).toBe(true);
    expect(read('task-list').tasks.length).toBe(tlBefore.tasks.length);
  });
});

describe('ledger-cli — promote --capability-theme via the new resolver path (ID-65.7)', () => {
  it('--capability-theme binds when the body comes from --file', async () => {
    const backlogId = firstBacklogId();
    const themeId = firstThemeId();
    const newId = '9976';
    const file = join(dir, 'task.json');
    writeFileSync(file, JSON.stringify(validTaskRecord(newId)), 'utf8');
    const r = await run(
      args('promote', [backlogId], { file, capabilityTheme: themeId }),
    );
    expect(r.ok).toBe(true);
    const newTask = read('task-list').tasks.find(
      (t: { id: string }) => t.id === newId,
    );
    // The capability-theme patch still mutates the resolved record.
    expect(newTask.capability_theme).toBe(themeId);
    const theme = read('product-roadmap').themes.find(
      (t: { id: string }) => t.id === themeId,
    );
    expect(theme.linked_tasks).toContain(newId);
  });

  it('--capability-theme binds when the body comes from positional JSON (back-compat)', async () => {
    const backlogId = firstBacklogId();
    const themeId = firstThemeId();
    const newId = '9977';
    const r = await run(
      args('promote', [backlogId, JSON.stringify(validTaskRecord(newId))], {
        capabilityTheme: themeId,
      }),
    );
    expect(r.ok).toBe(true);
    const newTask = read('task-list').tasks.find(
      (t: { id: string }) => t.id === newId,
    );
    expect(newTask.capability_theme).toBe(themeId);
  });
});
