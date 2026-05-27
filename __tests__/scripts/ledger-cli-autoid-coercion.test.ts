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

describe('auto-id — {35.21} max+1 on record-creating commands', () => {
  it('add-subtask 35 --title X assigns max(existing subId)+1 (number)', async () => {
    const tl = readTask();
    const task35 = tl.tasks.find((t: { id: string }) => t.id === '35');
    if (!task35) throw new Error('task 35 missing in fixture');
    const expected = Math.max(...task35.subtasks.map((s: { id: number }) => s.id)) + 1;
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
    const r = await run(
      args('update-backlog', [id, 'dependencies', '["17"]']),
    );
    expect(r.ok).toBe(true);
    const after = readBacklog();
    const item = after.items.find((it: { id: string }) => it.id === id);
    expect(item.dependencies).toEqual(['17']);
  });
});
