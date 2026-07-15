/**
 * ledger-cli-budget.test.ts — write-time budget pre-check + --force
 * (ID-35.17, RESEARCH §2.3 — the north star). The CLI REFUSES TO AUTHOR an
 * over-budget record at source: over-budget → budget-exceeded, exit 1, NO bytes
 * written; --force downgrades to the existing soft warning and proceeds.
 *
 * The message is SCOPED to the changed record (one line: field + actual +
 * budget) — never the whole-ledger parseTaskListWithWarnings dump.
 * `subtask.details` is EXEMPT (not in the registry — the append-only journal).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

// ID-68.35: repointed from docs/reference/ live ledgers to synthetic fixtures.
const FIXTURES = {
  task: resolve(__dirname, '../fixtures/ledger/task-list.json'),
  roadmap: resolve(__dirname, '../fixtures/ledger/product-roadmap.json'),
  backlog: resolve(__dirname, '../fixtures/ledger/product-backlog.json'),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-budget-'));
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
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}
function read(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

// A 789-char description — the exact over-budget value the S270 author wrote
// (RESEARCH §0 north star). The subtask.description budget is 250.
const DESC_789 = 'x'.repeat(789);

describe('budget pre-check on add-subtask (ID-35.17)', () => {
  it('rejects a 789-char subtask description (exit 1, no write) without --force', async () => {
    const taskId = read('task-list').tasks[0].id;
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const newSub = {
      id: '9990',
      title: 'Over-budget subtask',
      description: DESC_789,
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      // Scoped, one-line message naming field + actual + budget.
      expect(r.detail).toContain('description');
      expect(r.detail).toContain('789');
      expect(r.detail).toContain('250');
    }
    // Nothing written.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });

  it('writes the 789-char description WITH --force (downgraded to a warning)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const count = read('task-list').tasks[0].subtasks.length;
    const newSub = {
      id: '9991',
      title: 'Forced over-budget subtask',
      description: DESC_789,
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(
      args('add-subtask', [taskId, JSON.stringify(newSub)], { force: true }),
    );
    expect(r.ok).toBe(true);
    expect(read('task-list').tasks[0].subtasks.length).toBe(count + 1);
    const written = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === '9991',
    );
    expect(written.description.length).toBe(789);
  });
});

describe('budget pre-check exemptions + non-budgeted edits (ID-35.17)', () => {
  it('append-journal to a subtask details is EXEMPT (details is unbudgeted)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    // A long journal block must NOT trip the budget gate — details is exempt.
    const r = await run(
      args('append-journal', [taskId, subId, 'y'.repeat(2000)]),
    );
    expect(r.ok).toBe(true);
    const details = read('task-list').tasks[0].subtasks[0].details as string;
    expect(details).toContain('y'.repeat(2000));
  });

  it('a within-budget update-backlog description commits', async () => {
    const itemId = read('product-backlog').items[0].id;
    const r = await run(
      args('update-backlog', [itemId, 'description', 'A short summary.']),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an over-budget update-backlog title (>80) without --force', async () => {
    const itemId = read('product-backlog').items[0].id;
    const before = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(
      args('update-backlog', [itemId, 'title', 'z'.repeat(120)]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('title');
      expect(r.detail).toContain('80');
    }
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      before,
    );
  });
});

// ── ID-35.26 — update-* gates only the MUTATED field, not the whole record ─────
//
// Defect (S273): the budget pre-check iterated EVERY budgeted field of the
// changed record. For a field-edit command (update-task / update-subtask /
// update-backlog / update-roadmap), a historically over-budget UNTOUCHED field
// would reject the edit even though the operator never touched it.
//
// Fix: update-* commands pass `mutatedField` into the budget gate. checkBudget
// rejects only when the MUTATED field is over-budget; over-budget UNTOUCHED
// fields surface as soft warnings. Create / add / promote (which author all
// fields) keep checking every budgeted field — `mutatedField` absent → all.
describe('update-* budget gate is scoped to the mutated field (ID-35.26)', () => {
  // Seed a subtask whose `description` is historically over-budget, by adding
  // it via add-subtask + --force (the legitimate "I authored an over-budget
  // record" escape hatch). The subsequent update-subtask edit on an UNRELATED
  // field must NOT be rejected by the untouched over-budget description.
  async function seedOverBudgetSubtask(taskId: string, subId: string) {
    const newSub = {
      id: subId,
      title: 'Untouched over-budget seed',
      description: 'x'.repeat(789), // > 250 budget
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(
      args('add-subtask', [taskId, JSON.stringify(newSub)], { force: true }),
    );
    if (!r.ok) throw new Error(`seed failed: ${JSON.stringify(r)}`);
  }

  it('update-subtask status SUCCEEDS when an untouched description is over-budget', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = '9992';
    await seedOverBudgetSubtask(taskId, subId);

    // Now edit an unrelated field (status). The untouched description is
    // still 789 chars — the gate must NOT reject the edit.
    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'in_progress']),
    );
    expect(r.ok).toBe(true);

    // The status flip landed.
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === subId,
    );
    expect(updated.status).toBe('in_progress');
    // And the over-budget description is still on disk (untouched).
    expect(updated.description.length).toBe(789);

    // The untouched over-budget field should surface as a soft warning so the
    // operator is aware — never silently swallowed.
    if (r.ok) {
      const warns = r.warnings ?? [];
      const hit = warns.some(
        (w) =>
          w.includes('description') && w.includes('789') && w.includes('250'),
      );
      expect(hit).toBe(true);
    }
  });

  it('update-subtask testStrategy SUCCEEDS when an untouched description is over-budget', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = '9993';
    await seedOverBudgetSubtask(taskId, subId);

    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'testStrategy',
        'PASS when the new behaviour holds.',
      ]),
    );
    expect(r.ok).toBe(true);
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === subId,
    );
    expect(updated.testStrategy).toBe('PASS when the new behaviour holds.');
    expect(updated.description.length).toBe(789);
  });

  it('update-subtask STILL rejects when the MUTATED field (description) is over-budget', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = '9994';
    await seedOverBudgetSubtask(taskId, subId);

    // Mutating the description to a new >250 value MUST still reject.
    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'description',
        'y'.repeat(400),
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('description');
      expect(r.detail).toContain('400');
      expect(r.detail).toContain('250');
    }
    // The on-disk description is unchanged (the original 789).
    const after = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === subId,
    );
    expect(after.description.length).toBe(789);
  });

  // ── ID-35.31 — grapheme-aware char counting + over-by delta ──────────────────
  //
  // Defect (S275): `checkBudget` used JavaScript `string.length`, which counts
  // UTF-16 code units, not user-perceived characters (graphemes). When an
  // operator pasted text containing arrow glyphs (→), section marks (§), emoji,
  // or combining marks, the measured length diverged from what the operator
  // saw, making trim attempts undershoot. Worse: the error message reported
  // only the raw count and budget, with no "over by N" delta — the operator
  // had to do the arithmetic to know how much to trim.
  //
  // Fix:
  //   1. Switch the gate to grapheme counting via `Intl.Segmenter` so the
  //      measured length matches what the operator visually sees.
  //   2. Surface an `(over by N)` delta in the error detail so the operator
  //      can trim with precision.
  //
  // ASCII regression is preserved: graphemes == code units == bytes for
  // pure-ASCII, so existing budget violations still trip on the same threshold.

  // Grapheme counter that matches checkBudget's implementation — used by tests
  // to compute expected over-by deltas without duplicating UTF-16 math.
  function graphemeCount(s: string): number {
    return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)]
      .length;
  }

  it('update-subtask description rejection message includes "(over by N)" delta', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = '9996';
    await seedOverBudgetSubtask(taskId, subId);

    // 400 graphemes (pure ASCII) on a 250 budget → over by 150.
    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'description',
        'q'.repeat(400),
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('description');
      expect(r.detail).toContain('400');
      expect(r.detail).toContain('250');
      // The over-by delta — what 35.31 surfaces so the operator can trim.
      expect(r.detail).toContain('over by 150');
    }
  });

  it('counts user-perceived graphemes (→, §, emoji), not UTF-16 code units', async () => {
    // Build a 260-grapheme description from multibyte symbols: 252 ASCII +
    // 4 arrows + 4 section marks → 260 user-perceived chars.
    // In UTF-16 code units these symbols are each 1 code unit (BMP), so
    // string.length here equals grapheme count. But the test ALSO covers an
    // emoji case below where UTF-16 disagrees with graphemes.
    const desc260 = 'a'.repeat(252) + '→→→→' + '§§§§';
    expect(graphemeCount(desc260)).toBe(260);

    const taskId = read('task-list').tasks[0].id;
    const subId = '9997';
    await seedOverBudgetSubtask(taskId, subId);

    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'description', desc260]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      // 260 graphemes, 250 budget → over by 10.
      expect(r.detail).toContain('260');
      expect(r.detail).toContain('250');
      expect(r.detail).toContain('over by 10');
    }
  });

  it('emoji (surrogate-pair) graphemes count as 1, not 2', async () => {
    // 🎯 is a single grapheme but two UTF-16 code units (surrogate pair).
    // If the gate used .length (code units), 130 darts would measure 260 and
    // trip the 250 budget. If it uses graphemes, 130 darts measure 130 and
    // stay under-budget. We pick 130 darts to make the distinction sharp.
    const desc130Darts = '🎯'.repeat(130);
    expect(desc130Darts.length).toBeGreaterThan(250); // 260 UTF-16 code units
    expect(graphemeCount(desc130Darts)).toBe(130); // 130 graphemes — UNDER 250

    const taskId = read('task-list').tasks[0].id;
    const subId = '9998';
    await seedOverBudgetSubtask(taskId, subId);

    // 130 graphemes is UNDER the 250 budget — the edit must succeed.
    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'description',
        desc130Darts,
      ]),
    );
    expect(r.ok).toBe(true);
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === subId,
    );
    expect(graphemeCount(updated.description)).toBe(130);
  });

  it('ZWJ-joined family sequence counts as 1 grapheme per cluster (regression guard)', async () => {
    // 👨‍👩‍👧‍👦 is a single user-perceived character — a man + woman + girl + boy
    // joined by zero-width joiners (U+200D). UTF-16: 11 code units. Graphemes: 1.
    // A 130-cluster description is 1430 UTF-16 code units but only 130 graphemes.
    // This guards future regressions where someone might "optimise" the gate
    // back to a simpler counter (Array.from / spread on the raw string) that
    // splits ZWJ sequences into their component code points (4 emoji + 3 ZWJs
    // = 7 elements per cluster instead of 1).
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(graphemeCount(family)).toBe(1);
    expect(family.length).toBeGreaterThan(1); // 11 UTF-16 code units

    const desc130Families = family.repeat(130);
    expect(desc130Families.length).toBeGreaterThan(250); // 1430 code units
    expect(graphemeCount(desc130Families)).toBe(130); // 130 graphemes — UNDER 250

    const taskId = read('task-list').tasks[0].id;
    const subId = '9988';
    await seedOverBudgetSubtask(taskId, subId);

    // 130 ZWJ-clusters is UNDER the 250 budget — the edit must succeed.
    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'description',
        desc130Families,
      ]),
    );
    expect(r.ok).toBe(true);
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === subId,
    );
    expect(graphemeCount(updated.description)).toBe(130);
  });

  it('pure-ASCII over-budget violations still trip (regression guard)', async () => {
    // The 789-char ASCII case from the original ID-35.17 north star must still
    // reject — graphemes == code units for pure ASCII. Belt-and-braces against
    // a refactor that accidentally exempts ASCII over-budget records.
    const taskId = read('task-list').tasks[0].id;
    const newSub = {
      id: '9999',
      title: 'Regression — ASCII over-budget still rejects',
      description: 'r'.repeat(789),
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('description');
      expect(r.detail).toContain('789');
      expect(r.detail).toContain('250');
      expect(r.detail).toContain('over by 539');
    }
  });

  it('update-subtask --force on the mutated field commits AND notes untouched warnings', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = '9995';
    await seedOverBudgetSubtask(taskId, subId);

    // --force on a deliberately over-budget testStrategy edit; the existing
    // untouched description must not double-reject and must surface as a
    // warning alongside the forced one.
    const r = await run(
      args(
        'update-subtask',
        [`${taskId}.${subId}`, 'testStrategy', 'z'.repeat(400)],
        { force: true },
      ),
    );
    expect(r.ok).toBe(true);
    const updated = read('task-list').tasks[0].subtasks.find(
      (s: { id: string }) => s.id === subId,
    );
    expect(updated.testStrategy.length).toBe(400);
    expect(updated.description.length).toBe(789);
  });
});

// ID-35.30: discipline-warnings sweep is now SCOPED to the touched record.
//
// The bug (S275 sub-orchestrator brief): add-subtask success stdout was a
// 34-67 KB warnings dump — every over-budget field across the WHOLE ledger,
// per call — because disciplineWarnings returned the unfiltered output of
// parseTaskListWithWarnings. JSON-stdin parsing of `emit()`'s stderr envelope
// broke for orchestrators that buffer-consume it.
//
// Fix: callers thread a WarningScope into commitMutation/promote so the soft
// warnings on the success envelope name ONLY the just-mutated record. This
// matches the prevent-at-source budget gate (RESEARCH §2.3 "scoped to the
// changed record").
describe('discipline warnings are scoped to the touched record (ID-35.30)', () => {
  // Seed an over-budget subtask description under a separate task to act as
  // unrelated noise. Then mutate a DIFFERENT subtask under a DIFFERENT task,
  // and assert the noise does NOT bleed into the new success envelope.
  async function seedOverBudgetSubtask(taskId: string, subId: string) {
    const newSub = {
      id: subId,
      title: 'Untouched over-budget seed',
      description: 'x'.repeat(789), // > 250 budget — same shape as DESC_789
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(
      args('add-subtask', [taskId, JSON.stringify(newSub)], { force: true }),
    );
    if (!r.ok) throw new Error(`seed failed: ${JSON.stringify(r)}`);
  }

  it('add-subtask success warnings do NOT contain unrelated over-budget fields elsewhere in the ledger', async () => {
    // The live ledger already carries plenty of historical over-budget records
    // (the very reason 35.30 exists). Take the FIRST task as the mutation
    // target — its own budget is fine, so any returned warnings must NOT name
    // any other task.
    const taskId = read('task-list').tasks[0].id;
    const newSub = {
      id: '7991',
      title: 'Clean small subtask',
      description: 'within budget',
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'short',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(true);
    if (r.ok && r.warnings) {
      for (const w of r.warnings) {
        // Every entry must reference EITHER the touched parent task header
        // (Task "<taskId>") OR the just-added subtask compound id. Anything
        // else is the bug regressing.
        const compoundId = `${taskId}.7991`;
        const taskHeader = `Task "${taskId}"`;
        const inScope =
          w.startsWith(`Subtask ${compoundId} `) || w.includes(taskHeader);
        expect(inScope).toBe(true);
      }
    }
  });

  it('add-subtask success envelope warnings DOES surface a peer-field over-budget warning when the just-touched task has one', async () => {
    // Seed an over-budget subtask under task[0]. Then add ANOTHER subtask
    // under the same task. The new commit's discipline-warnings sweep must
    // surface the seeded subtask's over-budget description (it is in scope
    // — same parent task), so the operator still sees mistakes on the record
    // they touched. This preserves the safety value of the discipline
    // sweep while killing the unrelated-record noise.
    const taskId = read('task-list').tasks[0].id;
    await seedOverBudgetSubtask(taskId, '7992');
    const newSub = {
      id: '7993',
      title: 'Second clean subtask',
      description: 'within budget',
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'short',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(true);
    if (r.ok && r.warnings) {
      // The seeded peer (7992) is in scope (parent task matches). Look for
      // its over-budget signature: the message embeds "7992" and "789".
      const peerHit = r.warnings.some(
        (w) => w.startsWith(`Subtask ${taskId}.7992 `) && w.includes('789'),
      );
      expect(peerHit).toBe(true);

      // Cross-check: no warning names a DIFFERENT task. Pick any other task
      // id with known over-budget fields and assert it never appears.
      const otherTasks = (read('task-list').tasks as { id: string }[])
        .filter((t) => t.id !== taskId)
        .map((t) => `Task "${t.id}"`);
      for (const w of r.warnings) {
        for (const header of otherTasks) {
          expect(w.startsWith(header)).toBe(false);
        }
      }
    }
  });

  it('flip-subtask returns no warnings about sibling-subtask over-budget fields under the SAME task', async () => {
    // Seed an over-budget subtask under task[0]. Then flip a DIFFERENT
    // subtask under the same task. The flip's scope is (taskId, otherSubId)
    // — sibling subtask's warnings must not bleed in. (Task-level warnings
    // ARE in scope if the parent task itself is over-budget; the sibling
    // peer is not.)
    const taskId = read('task-list').tasks[0].id;
    await seedOverBudgetSubtask(taskId, '7994');
    // Add a second, clean subtask, then flip its status.
    const cleanSub = {
      id: '7995',
      title: 'Clean sibling',
      description: 'within budget',
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'short',
    };
    const add = await run(
      args('add-subtask', [taskId, JSON.stringify(cleanSub)]),
    );
    expect(add.ok).toBe(true);
    const r = await run(args('flip-subtask', [taskId, '7995', 'in_progress']));
    expect(r.ok).toBe(true);
    if (r.ok && r.warnings) {
      // The seeded sibling (7994) is OUT of scope for this flip (subId-scoped).
      const siblingNoise = r.warnings.some((w) =>
        w.startsWith(`Subtask ${taskId}.7994 `),
      );
      expect(siblingNoise).toBe(false);
      // And every entry must name THIS subtask or the parent task header.
      const compoundId = `${taskId}.7995`;
      const taskHeader = `Task "${taskId}"`;
      for (const w of r.warnings) {
        const inScope =
          w.startsWith(`Subtask ${compoundId} `) || w.includes(taskHeader);
        expect(inScope).toBe(true);
      }
    }
  });

  it('promote success envelope warnings name only the newly-promoted task', async () => {
    // promote inlines its own disciplineWarnings call (it lives outside the
    // shared commitMutation path because it writes two ledgers atomically).
    // The fix at the inline site must also scope to the new Task's id.
    //
    // Pick a fresh task id and a known backlog item. Assert the success
    // envelope's warnings name only the newly-promoted task — no pre-existing
    // (and historically over-budget) task headers may bleed in.
    const itemId = read('product-backlog').items[0].id;
    const newTaskId = '9988';
    const taskJson = JSON.stringify({
      id: newTaskId,
      title: 'Promoted clean task',
      description: 'Compact what+why.',
      status: 'pending',
      priority: 'should',
      dependencies: [],
      subtasks: [],
      updatedAt: '2026-05-28T00:00:00.000Z',
      effort_estimate: null,
      owner: null,
      priority_note: null,
      status_note: null,
      cross_doc_links: [],
      session_refs: [],
      commit_refs: [],
    });
    const r = await run(args('promote', [itemId, taskJson]));
    expect(r.ok).toBe(true);
    if (r.ok && r.warnings) {
      // Every warning must reference EITHER the new task's compound subtask
      // form OR its task header line. Anything else is an unrelated-record
      // leak — the bug regressing.
      const newHeader = `Task "${newTaskId}"`;
      for (const w of r.warnings) {
        const inScope =
          w.includes(newHeader) || w.startsWith(`Subtask ${newTaskId}.`);
        expect(inScope).toBe(true);
      }
      // Cross-check: known pre-existing over-budget task headers must NOT
      // appear in the envelope.
      const otherTasks = (read('task-list').tasks as { id: string }[])
        .filter((t) => t.id !== newTaskId)
        .map((t) => `Task "${t.id}"`);
      for (const w of r.warnings) {
        for (const header of otherTasks) {
          expect(w.startsWith(header)).toBe(false);
        }
      }
    }
  });
});

// ── ID-35.27 — budget-exceeded subject discrimination by recordKind ─────────────
//
// Defect: the budget-exceeded detail line read `... on ${gate.ledger}
// ${gate.recordId}`. For subtasks `gate.ledger` is the task-list ledger
// (`"task"`) and `gate.recordId` is the bare subtask number (e.g. `6`), so
// an operator over-budgeting subtask 49.6 saw "description is N chars on
// task 6" — a misleading reference to a non-existent record (or worse, to
// the WRONG task with id 6). The fix discriminates on `recordKind`:
//   task    → `task <recordId>`           (e.g. `task 49`)
//   subtask → `subtask <parentId>.<recordId>` (e.g. `subtask 49.6`)
//   theme   → `theme <recordId>`
//   item    → `item <recordId>`
// add-subtask / update-subtask now pass `parentId: taskId` into the gate so
// the subject is fully qualified.
describe('budget-exceeded subject is recordKind-discriminated (ID-35.27)', () => {
  it('add-subtask over-budget detail reads `subtask <taskId>.<subId>` (not `task <subId>`)', async () => {
    const taskId = read('task-list').tasks[0].id;
    const newSub = {
      id: '9970',
      title: 'Mislabel regression — subtask',
      description: DESC_789,
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const r = await run(args('add-subtask', [taskId, JSON.stringify(newSub)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      // The new, correctly-discriminated subject.
      expect(r.detail).toContain(`subtask ${taskId}.9970`);
      // And NEVER the old `task <subId>` mislabel (would be `task 9970`).
      expect(r.detail).not.toContain('task 9970');
    }
  });

  it('update-subtask over-budget detail reads `subtask <taskId>.<subId>`', async () => {
    const taskId = read('task-list').tasks[0].id;
    // Seed an under-budget subtask we can then push over via update-subtask.
    const subId = '9971';
    const seed = {
      id: subId,
      title: 'Seed',
      description: 'short',
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const seeded = await run(
      args('add-subtask', [taskId, JSON.stringify(seed)]),
    );
    expect(seeded.ok).toBe(true);

    const r = await run(
      args('update-subtask', [
        `${taskId}.${subId}`,
        'description',
        'q'.repeat(400),
      ]),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain(`subtask ${taskId}.${subId}`);
      expect(r.detail).not.toContain(`task ${subId}`);
    }
  });

  it('open-task over-budget detail reads `task <taskId>` (unchanged behaviour)', async () => {
    // TaskSchema is .strict() — details/testStrategy live on Subtask, not
    // Task. Structural defaults from CREATE_DEFAULTS.task fill the required
    // nullable/array fields.
    const newTask = {
      id: '9999',
      title: 'Mislabel regression — task',
      description: 'x'.repeat(2000), // > 1500 budget
      priority: 'medium',
    };
    const r = await run(args('open-task', [JSON.stringify(newTask)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('task 9999');
      // Not `subtask` (this is a task, not a subtask).
      expect(r.detail).not.toContain('subtask');
    }
  });

  // ID-148.8: `create-theme` over-budget coverage retired alongside the verb
  // (TECH §3.4, INV-7) — `create-theme` now returns `retired-verb` before any
  // budget check runs; see `ledger-cli-retired-verbs.test.ts`.

  it('create-backlog over-budget detail reads `item <itemId>` (unchanged behaviour)', async () => {
    // BacklogItemSchema enums status to {blocked|spec_needed|needs_research
    // |parked|ready} and requires priority. CREATE_DEFAULTS.item fills the
    // arrays + nullable scalars; supply a parked status + a valid priority.
    const newItem = {
      id: '9997',
      title: 'z'.repeat(120), // > 80 budget
      description: 'A short summary.',
      status: 'parked',
      priority: 'medium',
    };
    const r = await run(args('create-backlog', [JSON.stringify(newItem)]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('budget-exceeded');
      expect(r.detail).toContain('item 9997');
      expect(r.detail).not.toContain('backlog 9997');
    }
  });

  it('update-subtask UNTOUCHED-field warning is also subject-discriminated (ID-35.26 interaction)', async () => {
    // Seed an over-budget description, then edit an unrelated field. The
    // untouched-field SOFT WARNING must carry the new `subtask <taskId>.<subId>`
    // subject too — otherwise the ID-35.26 warning channel still mislabels.
    const taskId = read('task-list').tasks[0].id;
    const subId = '9972';
    const seed = {
      id: subId,
      title: 'Untouched-warning subject test',
      description: 'x'.repeat(789),
      details: '',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    };
    const seeded = await run(
      args('add-subtask', [taskId, JSON.stringify(seed)], { force: true }),
    );
    expect(seeded.ok).toBe(true);

    const r = await run(
      args('update-subtask', [`${taskId}.${subId}`, 'status', 'in_progress']),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const warns = r.warnings ?? [];
      const hit = warns.some(
        (w) =>
          w.includes('description') &&
          w.includes('789') &&
          w.includes(`subtask ${taskId}.${subId}`),
      );
      expect(hit).toBe(true);
      // And no `task <subId>` mislabel in any budget warning.
      const mislabel = warns.some(
        (w) =>
          w.includes('budget') &&
          w.includes(`task ${subId}`) &&
          !w.includes(`subtask ${taskId}.${subId}`),
      );
      expect(mislabel).toBe(false);
    }
  });
});
