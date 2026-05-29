/**
 * ledger-cli-delete-subtask.test.ts — the `delete-subtask <taskId> <subId>`
 * subcommand (ID-35.43).
 *
 * `delete-subtask` is the inverse of `add-subtask` (a −1 delta on one Task's
 * nested `subtasks[]`) and the sibling of `delete-backlog` (a −1 delta on a
 * top-level collection). It is guarded by the {35.16} record-set drop-guard:
 * the post-write subtask id-set MUST equal the pre-write set minus the removed
 * id — any silently dropped or duplicated sibling rejects with
 * `record-set-violation` and writes NOTHING.
 *
 * Coverage:
 *   - happy: remove one subtask from a multi-subtask task; siblings untouched
 *     (surviving id-set == original minus the removed id).
 *   - not-found: unknown taskId AND unknown subId both → `record-not-found`.
 *   - last-subtask: removing the only subtask SUCCEEDS, leaving `subtasks: []`
 *     (TaskSchema.subtasks allows an empty array — see task-list-schema.ts).
 *   - invalid-id: a non-numeric subId → `invalid-id` (subtask ids are numbers).
 *   - missing-args: missing either positional → `missing-args`.
 *   - --dry-run: reports the delta, writes nothing, BOUNDED output (no full doc).
 *   - record-set gate: a serialise-side sibling drop is rejected with
 *     `record-set-violation`, exit 1, NO bytes written.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

let dir: string;

/** A minimal schema-valid Subtask record. */
function subtask(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Subtask ${id}`,
    description: 'A short one-sentence summary.',
    details: '',
    status: 'pending',
    dependencies: [],
    testStrategy: 'n/a',
    ...overrides,
  };
}

/** A minimal schema-valid Task record carrying the supplied subtasks. */
function task(id: string, subtasks: ReturnType<typeof subtask>[]) {
  return {
    id,
    title: `Task ${id}`,
    description: 'Compact what+why.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks,
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

/** A minimal schema-valid task-list document. */
function taskListDoc(tasks: ReturnType<typeof task>[]) {
  return {
    document_name: 'Knowledge Hub Task List',
    document_purpose: 'A throwaway fixture for delete-subtask tests.',
    related_documents: [],
    tasks,
  };
}

function writeFixture(doc: unknown) {
  writeFileSync(join(dir, 'task-list.json'), JSON.stringify(doc, null, 2));
}

function readTaskList(): {
  tasks: { id: string; subtasks: { id: number }[] }[];
} {
  return JSON.parse(readFileSync(join(dir, 'task-list.json'), 'utf8'));
}

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
      noRegenMirrors: true, // suppress regen in tests (no task-view clone)
      ledgerDir: dir,
      ...extra,
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-del-sub-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('delete-subtask — happy path (ID-35.43)', () => {
  it('removes exactly the named subtask; siblings untouched', async () => {
    writeFixture(
      taskListDoc([task('42', [subtask(1), subtask(2), subtask(3)])]),
    );
    const r = await run(args('delete-subtask', ['42', '2']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toMatchObject({ taskId: '42', subId: 2 });

    const surviving = readTaskList().tasks[0].subtasks.map((s) => s.id);
    // surviving id-set == original {1,2,3} minus removed {2} == {1,3}
    expect(new Set(surviving)).toEqual(new Set([1, 3]));
    expect(surviving).not.toContain(2);
  });

  it('does not touch sibling subtasks of OTHER tasks', async () => {
    writeFixture(
      taskListDoc([
        task('42', [subtask(1), subtask(2)]),
        task('43', [subtask(1), subtask(2), subtask(3)]),
      ]),
    );
    const r = await run(args('delete-subtask', ['42', '1']));
    expect(r.ok).toBe(true);
    const doc = readTaskList();
    expect(doc.tasks[0].subtasks.map((s) => s.id)).toEqual([2]);
    // The other task's subtasks are byte-for-byte preserved.
    expect(doc.tasks[1].subtasks.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe('delete-subtask — not-found (ID-35.43)', () => {
  it('unknown taskId → record-not-found, nothing written', async () => {
    writeFixture(taskListDoc([task('42', [subtask(1), subtask(2)])]));
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(args('delete-subtask', ['999', '1']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('record-not-found');
      expect(String(r.detail)).toContain('999');
    }
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('unknown subId → record-not-found, nothing written', async () => {
    writeFixture(taskListDoc([task('42', [subtask(1), subtask(2)])]));
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(args('delete-subtask', ['42', '99']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('record-not-found');
      // detail names the addressed subtask as taskId.subId
      expect(String(r.detail)).toContain('42.99');
    }
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });
});

describe('delete-subtask — last-subtask (ID-35.43)', () => {
  it('removing the only subtask SUCCEEDS, leaving subtasks: []', async () => {
    // TaskSchema.subtasks is z.array(SubtaskSchema) with no .min(1) — an empty
    // array is explicitly allowed (atomic Tasks). So removing the last subtask
    // is a legal −1 delta to {}.
    writeFixture(taskListDoc([task('42', [subtask(1)])]));
    const r = await run(args('delete-subtask', ['42', '1']));
    expect(r.ok).toBe(true);
    expect(readTaskList().tasks[0].subtasks).toEqual([]);
  });
});

describe('delete-subtask — invalid-id (ID-35.43)', () => {
  it('non-numeric subId → invalid-id, nothing written', async () => {
    writeFixture(taskListDoc([task('42', [subtask(1), subtask(2)])]));
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(args('delete-subtask', ['42', 'abc']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid-id');
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('zero / negative subId → invalid-id (positive integer required)', async () => {
    writeFixture(taskListDoc([task('42', [subtask(1), subtask(2)])]));
    const zero = await run(args('delete-subtask', ['42', '0']));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toBe('invalid-id');
    const neg = await run(args('delete-subtask', ['42', '-1']));
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.error).toBe('invalid-id');
  });
});

describe('delete-subtask — missing-args (ID-35.43)', () => {
  it('missing both positionals → missing-args', async () => {
    writeFixture(taskListDoc([task('42', [subtask(1)])]));
    const r = await run(args('delete-subtask', []));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing-args');
  });

  it('missing the subId positional → missing-args', async () => {
    writeFixture(taskListDoc([task('42', [subtask(1)])]));
    const r = await run(args('delete-subtask', ['42']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing-args');
  });
});

describe('delete-subtask — --dry-run (ID-35.43, honours {35.44})', () => {
  it('reports the delta, writes nothing, bounded output', async () => {
    writeFixture(
      taskListDoc([task('42', [subtask(1), subtask(2), subtask(3)])]),
    );
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(args('delete-subtask', ['42', '2'], { dryRun: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Bounded envelope: the dry-run tag + the same resultPayload the live write
    // emits — never a full-document dump.
    expect(r.result).toMatchObject({
      dryRun: true,
      taskId: '42',
      subId: 2,
    });
    // No `tasks` array (the whole document) leaked into the result.
    expect(r.result).not.toHaveProperty('tasks');
    // File untouched.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });
});

describe('delete-subtask — record-set drop-guard ({35.16})', () => {
  it('rejects a serialised-output sibling drop with record-set-violation, NO bytes written', async () => {
    // The whole-file serialise path runs through escapeSerialise (the
    // namespace-spy-interceptable seam — mirrors ledger-cli-record-set.test.ts).
    // Stub escapeSerialise to ALSO drop a sibling subtask from the addressed
    // task; the gate parses the bytes-about-to-be-written and MUST catch the
    // extra drop before atomicWriteFile lands anything. Use a self-authored
    // fixture with NO inter-subtask dependencies so the legitimate delete
    // itself never trips TaskSchema's sibling-dependency superRefine — the only
    // failure under test is the gate catching the injected sibling drop.
    writeFixture(
      taskListDoc([task('42', [subtask(1), subtask(2), subtask(3)])]),
    );
    const targetTaskId = '42';
    const targetSubId = 1; // the one we ask to delete (legitimate −1)
    const siblingSubId = 3; // the one the stub silently drops on top

    const mod = await import('@/lib/ledger/scoped-serialise');
    const real = mod.escapeSerialise;
    const spy = vi
      .spyOn(mod, 'escapeSerialise')
      .mockImplementation((parsedValue: unknown) => {
        const v = parsedValue as {
          tasks?: { id: string; subtasks: { id: number }[] }[];
        };
        if (Array.isArray(v.tasks)) {
          const t = v.tasks.find((x) => x.id === targetTaskId);
          if (t && t.subtasks.length >= 1) {
            // Silently drop a SECOND subtask (the sibling) on top of the
            // legitimate −1 delete — a record loss the gate must catch.
            const clone = {
              ...v,
              tasks: v.tasks.map((x) =>
                x.id === targetTaskId
                  ? {
                      ...x,
                      subtasks: x.subtasks.filter((s) => s.id !== siblingSubId),
                    }
                  : x,
              ),
            };
            return real(clone);
          }
        }
        return real(parsedValue);
      });

    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const r = await run(
      args('delete-subtask', [targetTaskId, String(targetSubId)]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-set-violation');
    // Nothing written — the original file is byte-identical.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
    spy.mockRestore();
  });
});
