/**
 * ledger-cli-integration.test.ts — full round-trip dogfood (ID-35.10 /
 * PRODUCT §4 self-bootstrap). Proves the vendored primitives wire end-to-end
 * through the CLI: open a Task → flip a subtask → append a journal block →
 * show, on a temp-copied ledger, asserting each step's effect persists into
 * the next (each `run()` re-reads the file from disk, so this exercises the
 * read → mutate → atomic-write → re-read cycle for real).
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-int-'));
  copyFileSync(FIXTURES.task, join(dir, 'task-list.json'));
  copyFileSync(FIXTURES.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(FIXTURES.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function args(subcommand: string, positionals: string[]): ParsedArgs {
  return {
    subcommand,
    positionals,
    flags: {
      dryRun: false,
      pretty: false,
      regenMirrors: false,
      // ID-35.18: regen is now DEFAULT-ON; suppress it in tests so they never
      // shell out to scripts/regen-mirrors.sh (which clones task-view).
      noRegenMirrors: true,
      ledgerDir: dir,
    },
  };
}
function read() {
  return JSON.parse(readFileSync(join(dir, 'task-list.json'), 'utf8'));
}

const NEW_ID = '9990';
const NEW_TASK = {
  id: NEW_ID,
  title: 'Round-trip dogfood task',
  description: 'Compact what+why.',
  status: 'pending',
  priority: 'should',
  dependencies: [],
  subtasks: [
    {
      id: '1',
      title: 'First subtask',
      description: 'A short summary.',
      details: 'Initial brief.',
      status: 'pending',
      dependencies: [],
      testStrategy: 'n/a',
    },
  ],
  updatedAt: '2026-05-26T00:00:00.000Z',
  effort_estimate: null,
  owner: null,
  priority_note: null,
  status_note: null,
  cross_doc_links: [],
  session_refs: [],
  commit_refs: [],
};

describe('ledger-cli — round-trip dogfood (ID-35.10 / PRODUCT §4)', () => {
  it('open-task → flip-subtask → append-journal → show persists each step', async () => {
    // 1. open-task
    const opened = await run(args('open-task', [JSON.stringify(NEW_TASK)]));
    expect(opened.ok).toBe(true);
    expect(read().tasks.some((t: { id: string }) => t.id === NEW_ID)).toBe(
      true,
    );

    // 2. flip-subtask 9990.1 → in_progress (re-reads from disk)
    const flipped = await run(
      args('flip-subtask', [NEW_ID, '1', 'in_progress']),
    );
    expect(flipped.ok).toBe(true);
    const afterFlip = read().tasks.find((t: { id: string }) => t.id === NEW_ID);
    expect(afterFlip.subtasks[0].status).toBe('in_progress');

    // 3. append-journal to 9990.1 — preserves the "Initial brief." prefix
    const journalled = await run(
      args('append-journal', [NEW_ID, '1', 'Dogfood: round-trip complete.']),
    );
    expect(journalled.ok).toBe(true);
    const details = read().tasks.find((t: { id: string }) => t.id === NEW_ID)
      .subtasks[0].details as string;
    expect(details.startsWith('Initial brief.')).toBe(true);
    expect(details).toContain('Dogfood: round-trip complete.');
    expect(details).toMatch(/<info added on .+Z>/);

    // 4. show reflects the cumulative state, read-only
    const shown = await run(args('show', ['task', NEW_ID]));
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      const rec = shown.result as { subtasks: { status: string }[] };
      expect(rec.subtasks[0].status).toBe('in_progress');
    }
  });
});
