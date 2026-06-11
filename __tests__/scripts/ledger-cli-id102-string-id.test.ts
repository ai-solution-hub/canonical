/**
 * ledger-cli-id102-string-id.test.ts — ID-102.6 post-flip-contract canaries.
 *
 * Subtask ids and subtask `dependencies[]` are digit-STRINGS (PRODUCT inv 1-9;
 * TECH §P2-§P5, §P3b). These canaries pin the observable post-flip behaviour of
 * the five seam edits in `scripts/ledger-cli.ts`. Per the FLAG-DAY-ONLY
 * constraint (TECH §Concurrency gate, inv 10) the CLI emits string ids against
 * a schema that does NOT flip until the {102.8} atomic flag-day commit, so:
 *
 *   - PURE canaries (no server, no ledger load) — `nextId` auto-id semantics —
 *     run green AT THIS BRANCH HEAD when the scratch-P1 schema is applied
 *     (subtask id/deps → digit-string), and exercise REAL behaviour, not the
 *     implementation (test-philosophy.md).
 *   - WRITE-PATH canaries (add/delete-subtask round-trip over the transport)
 *     are documented to fail-AT-SERVER against the v0.4.0 task-view server
 *     (its vendored schema still expects number ids — that flip is {102.7}'s
 *     job). They are tagged so the run matrix in the {102.6} journal is precise.
 *     They are NOT weakened to pass against v0.4.0 — they assert the post-flip
 *     contract and go green at the flag-day.
 *
 * Per test-philosophy.md: the canaries exercise the exported `nextId` helper and
 * the `run()` CLI surface against synthetic STRING-id fixtures (not the live,
 * un-migrated number-id ledger, which the scratch-P1 string schema fail-loudly
 * rejects at load — inv 15), so they prove the digit-string contract without
 * waiting for the flag-day data migration (P6).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, nextId, type ParsedArgs } from '@/scripts/ledger-cli';
import { TaskListSchema } from '@/lib/validation/task-list-schema';

let dir: string;

/** A minimal schema-valid Subtask with a digit-STRING id (ID-102). */
function subtask(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Subtask ${id}`,
    description: 'A short one-sentence summary.',
    details: '',
    status: 'pending',
    dependencies: [],
    testStrategy: null,
    ...overrides,
  };
}

/** A minimal schema-valid Task carrying the supplied subtasks. */
function task(id: string, subtasks: ReturnType<typeof subtask>[]) {
  return {
    id,
    title: `Task ${id}`,
    description: 'Compact what+why.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks,
    updatedAt: '2026-06-11T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}

function taskListDoc(tasks: ReturnType<typeof task>[]) {
  return {
    document_name: 'Knowledge Hub Task List',
    document_purpose: 'Synthetic string-id fixture for ID-102 canaries.',
    related_documents: [],
    tasks,
  };
}

/** A `{ kind, data }` KnownDetected value built from the canonical Zod schema —
 * the permanent source of truth (never vendored/deleted). Under scratch-P1 the
 * schema enforces digit-string ids, so a string-id fixture parses cleanly. */
function detectedTaskList(doc: unknown) {
  return { kind: 'task-list', data: TaskListSchema.parse(doc) } as const;
}

function writeFixture(doc: unknown) {
  writeFileSync(join(dir, 'task-list.json'), JSON.stringify(doc, null, 2));
}

function readTaskList(): {
  tasks: { id: string; subtasks: { id: string }[] }[];
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
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-id102-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── PURE canaries: nextId auto-id semantics (no server) ──────────────────────
// These run green AT BRANCH HEAD with scratch-P1 applied — they exercise only
// the exported `nextId` helper against a synthetic string-id fixture.

describe('ID-102 auto-id (nextId) — digit-string, monotonic, non-gap-filling', () => {
  it('(b) single auto-id into ["1","2"] returns the string "3"', () => {
    const d = detectedTaskList(
      taskListDoc([task('70', [subtask('1'), subtask('2')])]),
    );
    const id = nextId(d, 'subtasks', '70');
    expect(typeof id).toBe('string');
    expect(id).toBe('3');
  });

  it('(b) single auto-id into an empty subtask list returns the string "1"', () => {
    const d = detectedTaskList(taskListDoc([task('71', [])]));
    const id = nextId(d, 'subtasks', '71');
    expect(id).toBe('1');
  });

  it('(d) gap fixture ["2","10"] returns "11" (max+1 NUMERIC, not lexical "3")', () => {
    // The §Risks "Math.max over string ids" canary: nextId must map(Number)
    // before Math.max, else "2"/"10" mis-orders. max+1 = 11, non-gap-filling.
    const d = detectedTaskList(
      taskListDoc([task('72', [subtask('2'), subtask('10')])]),
    );
    const id = nextId(d, 'subtasks', '72');
    expect(id).toBe('11');
  });
});

// ── WRITE-PATH canaries: add/delete-subtask round-trip over the transport ────
// FLAG-DAY-ONLY: these commit through the ephemeral v0.4.0 task-view server,
// whose vendored schema still expects number ids, so under scratch-P1 they
// fail-AT-SERVER (the string-id payload is rejected server-side — {102.7}'s
// flip lands the server seam). They assert the post-flip contract and go green
// at the flag-day; they are NOT weakened to pass against v0.4.0.

describe('ID-102 admission (add-subtask) — stores the digit-string id [FLAG-DAY: fail-at-server until {102.7}]', () => {
  it('(a) --id 15 and --id "15" both store the string "15"', async () => {
    writeFixture(taskListDoc([task('73', [])]));
    const r = await run(
      args('add-subtask', ['73'], {
        id: '15',
        title: 'Explicit id subtask',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    // Post-flag-day: r.ok === true and the stored id is the string "15".
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = readTaskList().tasks[0].subtasks.find(
      (s) => (s as { title?: string }).title === 'Explicit id subtask',
    );
    expect(stored?.id).toBe('15');
    expect(typeof stored?.id).toBe('string');
  });

  it('(c) bulk-of-3 into existing ["5"] stores "6","7","8" — NOT "6","61","611"', async () => {
    writeFixture(taskListDoc([task('74', [subtask('5')])]));
    const batch = [
      { title: 'Bulk one', description: 'First.', details: '' },
      { title: 'Bulk two', description: 'Second.', details: '' },
      { title: 'Bulk three', description: 'Third.', details: '' },
    ];
    const file = join(dir, 'batch.json');
    writeFileSync(file, JSON.stringify(batch));
    const r = await run(args('add-subtasks', ['74'], { file }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = readTaskList().tasks[0].subtasks.map((s) => s.id);
    // The string-concat regression P3b prevents: counter increments NUMERICALLY.
    expect(ids).toEqual(['5', '6', '7', '8']);
  });
});

describe('ID-102 round-trip (add → delete) — server-side record-set gate [FLAG-DAY: fail-at-server until {102.7}]', () => {
  it('(e) add-subtask then delete-subtask completes with no record-set-violation', async () => {
    writeFixture(taskListDoc([task('75', [subtask('1')])]));
    const added = await run(
      args('add-subtask', ['75'], {
        id: '2',
        title: 'To be deleted',
        description: 'A short summary.',
        status: 'pending',
      }),
    );
    expect(added.ok).toBe(true);
    const removed = await run(args('delete-subtask', ['75', '2']));
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      // The co-change canary: a numeric/string mismatch on the record-set delta
      // would surface here as a record-set-violation.
      expect(removed.error).not.toBe('record-set-violation');
      return;
    }
    expect(removed.result).toMatchObject({ taskId: '75', subId: '2' });
    const surviving = readTaskList().tasks[0].subtasks.map((s) => s.id);
    expect(surviving).toEqual(['1']);
  });
});

// ── dotted-subcommand canaries: subId carried as a STRING throughout ─────────
// FLAG-DAY-ONLY (flip/update/append/delete commit through the transport).

describe('ID-102 dotted subcommands — subId resolves as a string, payloads carry no numbers [FLAG-DAY: fail-at-server until {102.7}]', () => {
  it('(f) flip / update / append / delete resolve subtask "15" of task "73"', async () => {
    writeFixture(
      taskListDoc([
        task('73', [subtask('15', { status: 'pending', details: '' })]),
      ]),
    );

    const flip = await run(args('flip-subtask', ['73.15', 'in_progress']));
    expect(flip.ok).toBe(true);
    if (flip.ok) {
      expect(flip.result).toMatchObject({
        taskId: '73',
        subId: '15',
        status: 'in_progress',
      });
    }

    const upd = await run(
      args('update-subtask', ['73.15', 'title', 'Renamed subtask']),
    );
    expect(upd.ok).toBe(true);
    if (upd.ok) {
      expect(upd.result).toMatchObject({ taskId: '73', subId: '15' });
    }

    const journal = await run(args('append-journal', ['73.15', 'A note.']));
    expect(journal.ok).toBe(true);
    if (journal.ok) {
      expect(journal.result).toMatchObject({ taskId: '73', subId: '15' });
    }

    const del = await run(args('delete-subtask', ['73.15']));
    expect(del.ok).toBe(true);
    if (del.ok) {
      const payload = del.result as { taskId: unknown; subId: unknown };
      expect(payload).toMatchObject({ taskId: '73', subId: '15' });
      // The id-bearing payload fields are strings — no number addressing the
      // record (subtaskCount is a legitimate numeric count, not an id).
      expect(typeof payload.taskId).toBe('string');
      expect(typeof payload.subId).toBe('string');
    }
  });
});
