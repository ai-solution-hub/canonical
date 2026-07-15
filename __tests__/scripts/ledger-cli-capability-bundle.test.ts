/**
 * ledger-cli-capability-bundle.test.ts — ID-35.39 capability bundle:
 *
 *   Item A — `promote --capability-theme <themeId>`. ID-148.8 (TECH §3.4,
 *            INV-7): RETIRED — returns `retired-flag` immediately, nothing
 *            bound, nothing written. Positive-path coverage lives in
 *            `ledger-cli-retired-verbs.test.ts`; this file keeps only the
 *            regression proof that the flag no longer does anything.
 *
 *   Item C — `update-backlog notes --append` concatenates the incoming value
 *            onto the existing notes value (newline-joined) instead of
 *            overwriting. Other fields reject with `append-unsupported-field`.
 *            The pre-{35.39} overwrite behaviour is preserved when --append
 *            is absent. (The sibling `update-roadmap notes --append` coverage
 *            retired alongside the verb, ID-148.8.)
 *
 * (Item B / update-umbrella was deferred then retired outright — ID-148.8.)
 *
 * Drives the exported `run()` directly against a temp dir holding fresh
 * copies of the task-list + backlog ledgers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

// ID-68.35: repointed from docs/reference/ live ledgers to synthetic fixtures.
const FIXTURES = {
  task: resolve(__dirname, '../fixtures/ledger/task-list.json'),
  backlog: resolve(__dirname, '../fixtures/ledger/product-backlog.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-cap-'));
  copyFileSync(FIXTURES.task, join(dir, 'task-list.json'));
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

function readTask() {
  return JSON.parse(readFileSync(join(dir, 'task-list.json'), 'utf8'));
}
function readBacklog() {
  return JSON.parse(readFileSync(join(dir, 'product-backlog.json'), 'utf8'));
}

function firstBacklogId(): string {
  return readBacklog().items[0].id;
}

/** Schema-valid Task record (mirrors helper in ledger-cli.test.ts). */
function validTaskRecord(id: string) {
  return {
    id,
    title: 'Capability-bundle dogfood task',
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

// ── Item A — promote --capability-theme (ID-148.8: retired) ─────────────────

describe('ID-148.8 — promote --capability-theme is retired (was ID-35.39 Item A)', () => {
  it('returns retired-flag; nothing bound, nothing written', async () => {
    const backlogId = firstBacklogId();
    const tlBefore = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const blBefore = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(
      args('promote', [backlogId, JSON.stringify(validTaskRecord('9981'))], {
        capabilityTheme: 'any-theme-id',
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('retired-flag');
      expect(r.detail).toContain('ID-148');
    }
    // Neither ledger touched.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(tlBefore);
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      blBefore,
    );
  });

  it('without --capability-theme, promote still behaves like the plain 2-ledger promote', async () => {
    const backlogId = firstBacklogId();
    const r = await run(
      args('promote', [backlogId, JSON.stringify(validTaskRecord('9983'))]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(
        (r.result as { boundCapabilityTheme?: string }).boundCapabilityTheme,
      ).toBeUndefined();
    }
    const newTask = readTask().tasks.find(
      (t: { id: string }) => t.id === '9983',
    );
    // capability_theme field absent (or null) — no implicit binding.
    expect(newTask.capability_theme == null).toBe(true);
  });
});

// ── Item C — update-backlog notes --append ───────────────────────────────────

describe('ID-35.39 Item C — update-backlog notes --append', () => {
  it('appends to a backlog item with existing notes (newline-joined)', async () => {
    // Find a backlog item whose notes is already a non-empty string.
    const item = readBacklog().items.find(
      (it: { notes: unknown }) =>
        typeof it.notes === 'string' && it.notes.length > 0,
    );
    if (!item) {
      // No fixture item has prose notes — seed one via a non-append write first.
      const seedId = readBacklog().items[0].id;
      const seed = await run(
        args('update-backlog', [seedId, 'notes', 'initial line']),
      );
      expect(seed.ok).toBe(true);
      const r = await run(
        args('update-backlog', [seedId, 'notes', 'second line'], {
          append: true,
        }),
      );
      expect(r.ok).toBe(true);
      const after = readBacklog().items.find(
        (it: { id: string }) => it.id === seedId,
      );
      expect(after.notes).toBe('initial line\nsecond line');
      return;
    }
    const existing = item.notes;
    const r = await run(
      args('update-backlog', [item.id, 'notes', 'appended line'], {
        append: true,
      }),
    );
    expect(r.ok).toBe(true);
    const after = readBacklog().items.find(
      (it: { id: string }) => it.id === item.id,
    );
    expect(after.notes).toBe(`${existing}\nappended line`);
  });

  it('append onto a null/empty notes field writes the bare new value (no leading newline)', async () => {
    // Find an item whose notes is null.
    const itemWithNull = readBacklog().items.find(
      (it: { notes: unknown }) => it.notes === null,
    );
    expect(itemWithNull).toBeDefined();
    const r = await run(
      args('update-backlog', [itemWithNull.id, 'notes', 'fresh content'], {
        append: true,
      }),
    );
    expect(r.ok).toBe(true);
    const after = readBacklog().items.find(
      (it: { id: string }) => it.id === itemWithNull.id,
    );
    expect(after.notes).toBe('fresh content');
  });

  it('rejects --append on a non-notes field with `append-unsupported-field`', async () => {
    const itemId = firstBacklogId();
    const before = readFileSync(join(dir, 'product-backlog.json'), 'utf8');
    const r = await run(
      args('update-backlog', [itemId, 'description', 'something new'], {
        append: true,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('append-unsupported-field');
      expect(r.detail).toContain('description');
    }
    // Backlog unchanged.
    expect(readFileSync(join(dir, 'product-backlog.json'), 'utf8')).toBe(
      before,
    );
  });

  it('regression — without --append, a notes write OVERWRITES (preserves pre-{35.39} default)', async () => {
    const itemId = firstBacklogId();
    // Seed an initial value.
    const seed = await run(args('update-backlog', [itemId, 'notes', 'first']));
    expect(seed.ok).toBe(true);
    expect(
      readBacklog().items.find((it: { id: string }) => it.id === itemId).notes,
    ).toBe('first');
    // Overwrite WITHOUT --append.
    const r = await run(args('update-backlog', [itemId, 'notes', 'second']));
    expect(r.ok).toBe(true);
    expect(
      readBacklog().items.find((it: { id: string }) => it.id === itemId).notes,
    ).toBe('second');
  });
});

// ID-148.8: `update-roadmap notes --append` retired alongside the verb
// (TECH §3.4, INV-7) — coverage moved to `ledger-cli-retired-verbs.test.ts`.
