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

const REPO = resolve(__dirname, '../..');
const REAL = {
  task: join(REPO, 'docs/reference/task-list.json'),
  roadmap: join(REPO, 'docs/reference/product-roadmap.json'),
  backlog: join(REPO, 'docs/reference/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-promote-input-'));
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
    // The inserted record equals the supplied (complete) body verbatim — the
    // resolver does not mutate it (no withCreateDefaults/auto-id).
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
    // Named flags resolve into a record per {35.15}; promote applies NO
    // withCreateDefaults/auto-id (its contract: caller supplies a COMPLETE
    // record), so a scalar-only named-flags body is incomplete and the
    // insertRecord Zod parse rejects it. The point under test: the named-flags
    // INPUT MODE is reached (we get a structured schema-error envelope, never
    // a missing-args/crash), proving promote routes through readRecordInput.
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
