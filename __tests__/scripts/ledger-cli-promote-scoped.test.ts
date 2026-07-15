/**
 * ledger-cli-promote-scoped.test.ts — byte-minimal-diff proof for `promote`
 * routed through the {65.2} scoped splice + field-patch primitives (ID-65.4).
 *
 * WHY this test exists (real-behaviour per docs/reference/test-philosophy.md):
 * before {65.4}, `promote()` derived its two staged-write content strings via
 * two whole-file `serialise()` re-emits — `serialise(ins.detected)` (task-list),
 * `serialise(rem.detected)` (backlog). Each is a WIDE diff (the entire
 * `tasks[]` / `items[]` array re-printed) that collides on a cmux-fleet
 * cherry-pick. After {65.4} the WRITTEN bytes come from the scoped primitives
 * so a promote yields:
 *   - task-list diff = ONLY the new Task's lines (every other Task byte-identical),
 *   - backlog diff = ONLY the removed item's lines (every other item byte-identical).
 * (ID-148.8, TECH §3.4 INV-7: the third leg — a roadmap diff when
 * `--capability-theme` was set — is RETIRED; the flag now returns
 * `retired-flag` before the roadmap ledger is even read, so there is no
 * roadmap diff left to prove.)
 *
 * The proof is a LINE-DIFF assertion on the real before/after file bytes (copies
 * of the live ledgers in a temp dir).
 *
 * ID-90.22 R1a: `promote` is NOT server-wired in R1a (its routing to the server
 * transaction endpoint is R1b — like updateUmbrella, it still runs the DIRECT
 * staged-write path via stageAtomicWrite/commitStagedWrite, bypassing
 * serverEnabled()). So the byte-minimal-diff line-diff proofs below remain valid
 * over the DIRECT path. BUT the two serialise-side gate-induction tests (which
 * stubbed `scopedSpliceSerialise` from @/lib/ledger/scoped-serialise to inject a
 * record drop / a scoped {ok:false}) are RETIRED: that module is deleted by R2,
 * so the import is banned by the R1a hygiene gate (zero `@/lib/ledger/` hits in
 * __tests__/scripts/). The record-set gate + scoped-fail behaviour they covered
 * moves UPSTREAM with promote's R1b transaction-endpoint routing (covered by
 * task-view's own suite, U11; byte-parity locked by the K5 differential-parity
 * harness in the interim). The fixture-seeding use of `escapeSerialise` is
 * inlined below as a local byte-faithful serialiser (the format is a stable
 * 2-space-pretty + \uXXXX-escaped-non-ASCII + trailing-newline contract).
 *
 * DOGFOODING HAZARD: this CLI writes the workflow's own ledgers. Every command
 * here runs against a TEMP COPY (mkdtemp + copyFile), never the real ledgers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-promote-scoped-'));
  copyFileSync(FIXTURES.task, join(dir, 'task-list.json'));
  copyFileSync(FIXTURES.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(FIXTURES.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
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
      noRegenMirrors: true, // suppress regen in tests (no task-view clone)
      ledgerDir: dir,
      ...extra,
    },
  };
}
function path(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return join(dir, `${name}.json`);
}
function readText(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return readFileSync(path(name), 'utf8');
}
function readJson(name: 'task-list' | 'product-roadmap' | 'product-backlog') {
  return JSON.parse(readText(name));
}
function firstBacklogId(): string {
  return readJson('product-backlog').items[0].id;
}

/** Schema-valid Task record (mirrors helper in ledger-cli-capability-bundle.test.ts). */
function validTaskRecord(id: string) {
  return {
    id,
    title: 'Promote-scoped dogfood task',
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
  };
}

/**
 * Multiset line-diff oracle (same shape as ledger-cli-scoped-create.test.ts):
 * returns the lines that disappeared (`removed`) and appeared (`added`) between
 * before/after, computed as a multiset difference so duplicate lines (e.g.
 * `      ],`) are handled correctly. A whole-file array re-emit produces many
 * removed+added lines; a minimal record-sized splice produces only the touched
 * record's lines plus at most one prior-last-record line that gained a comma.
 */
function lineDiff(before: string, after: string) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const counts = new Map<string, number>();
  for (const l of beforeLines) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const l of afterLines) counts.set(l, (counts.get(l) ?? 0) - 1);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [line, delta] of counts) {
    for (let i = 0; i < delta; i++) removed.push(line);
    for (let i = 0; i < -delta; i++) added.push(line);
  }
  return { removed, added };
}

describe('promote — scoped splice produces record-sized diffs (ID-65.4)', () => {
  it('task-list diff is ONLY the new Task lines; backlog diff is ONLY the removed item lines (no --capability-theme)', async () => {
    const backlogId = firstBacklogId();
    const newId = '9971';

    // Snapshot the removed item's distinctive content so we can prove it
    // disappears (and only it) from the backlog.
    const removedItem = readJson('product-backlog').items.find(
      (it: { id: string }) => it.id === backlogId,
    );
    const removedTitle: string = removedItem.title;
    const otherBacklogTitles: string[] = readJson('product-backlog')
      .items.filter((it: { id: string }) => it.id !== backlogId)
      .map((it: { title: string }) => it.title);
    const allTaskTitles: string[] = readJson('task-list').tasks.map(
      (t: { title: string }) => t.title,
    );

    const tlBefore = readText('task-list');
    const blBefore = readText('product-backlog');

    const r = await run(
      args('promote', [backlogId, JSON.stringify(validTaskRecord(newId))]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Success envelope shape unchanged: { newTaskId, removedBacklogId } (no theme).
      expect(r.result).toMatchObject({
        newTaskId: newId,
        removedBacklogId: backlogId,
      });
      expect(
        (r.result as { boundCapabilityTheme?: string }).boundCapabilityTheme,
      ).toBeUndefined();
    }

    // ── task-list: only the new Task's lines were added; no existing Task
    //    title appears in the diff (no whole-array re-emit) ───────────────────
    const tlAfter = readText('task-list');
    const tlDiff = lineDiff(tlBefore, tlAfter);
    // The added lines carry the new Task's distinctive title.
    expect(
      tlDiff.added.some((l) => l.includes('Promote-scoped dogfood task')),
    ).toBe(true);
    // Not one pre-existing Task title is re-emitted (added or removed).
    for (const title of allTaskTitles) {
      const needle = JSON.stringify(title).slice(1, -1); // escaped inner text
      expect(tlDiff.removed.some((l) => l.includes(needle))).toBe(false);
    }
    // At most one prior line changed (the prior-last Task's `}` gained a comma).
    expect(tlDiff.removed.length).toBeLessThanOrEqual(1);

    // ── backlog: only the removed item's lines disappeared; every other item
    //    byte-identical ────────────────────────────────────────────────────
    const blAfter = readText('product-backlog');
    const blDiff = lineDiff(blBefore, blAfter);
    // The removed item's distinctive title is in the removed set.
    expect(
      blDiff.removed.some((l) =>
        l.includes(JSON.stringify(removedTitle).slice(1, -1)),
      ),
    ).toBe(true);
    // No OTHER item's title appears in either side of the diff.
    for (const title of otherBacklogTitles) {
      const needle = JSON.stringify(title).slice(1, -1);
      expect(blDiff.removed.some((l) => l.includes(needle))).toBe(false);
      expect(blDiff.added.some((l) => l.includes(needle))).toBe(false);
    }
    // The removed item is genuinely gone.
    expect(
      readJson('product-backlog').items.some(
        (it: { id: string }) => it.id === backlogId,
      ),
    ).toBe(false);
    // The new Task landed.
    expect(
      readJson('task-list').tasks.some((t: { id: string }) => t.id === newId),
    ).toBe(true);
  });

  // ID-148.8 (TECH §3.4, INV-7): `--capability-theme` is a RETIRED flag —
  // `promote` returns `retired-flag` before ever loading the roadmap ledger,
  // so the byte-minimal-diff proofs this file exists for (roadmap
  // linked_tasks[] scoped-patch, dry-run-with-theme, already-linked
  // idempotent no-op) no longer have anything to exercise. Positive
  // retired-flag coverage lives in `ledger-cli-retired-verbs.test.ts` and
  // `ledger-cli-promote-input.test.ts`; this file keeps only the proof that
  // the roadmap ledger is left COMPLETELY untouched (not even read).
  it('--capability-theme: retired-flag, and the roadmap ledger is never even read', async () => {
    const backlogId = firstBacklogId();
    const rmBefore = readText('product-roadmap');
    const r = await run(
      args('promote', [backlogId, JSON.stringify(validTaskRecord('9972'))], {
        capabilityTheme: 'any-theme-id',
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('retired-flag');
    expect(readText('product-roadmap')).toBe(rmBefore);
    // Nothing promoted either — the retirement check fires before any ledger
    // load (task-list included).
    expect(
      readJson('task-list').tasks.some((t: { id: string }) => t.id === '9972'),
    ).toBe(false);
  });
});

// ID-90.22 R1a: the two scoped-path gate-induction tests (record-set-violation
// via a `scopedSpliceSerialise` drop stub; scoped-* fail via a stubbed
// {ok:false}) are RETIRED. Both stubbed `@/lib/ledger/scoped-serialise` — a
// module R2 deletes, banned by the R1a import-hygiene gate. promote's
// staged-write gate + scoped-fail behaviour moves UPSTREAM with its R1b routing
// to the server transaction endpoint (covered by task-view's own suite, U11);
// the OFF-vs-ON byte-parity that would surface any serialiser drop is locked by
// the K5 differential-parity harness in the interim. The byte-minimal-diff
// line-diff proofs above (the real value of this suite) remain over the DIRECT
// path that R1a does not migrate.
