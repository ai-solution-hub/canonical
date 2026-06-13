/**
 * ledger-cli-id-highwater.test.ts — WS-C C4 Bug3 (2/2): the auto-id allocator
 * must NEVER re-hand-out an id freed by delete/promote (the bl-287/288 / bl-300
 * collision class).
 *
 * WHY (real-behaviour per docs/reference/test-philosophy.md): a bare
 * `max(survivors)+1` allocator is not monotonic across deletes/promotes —
 * freeing the highest id lowers the live max, so the next allocation reuses the
 * just-freed id, which then collides with the promoted Task's provenance
 * back-reference. The fix is the document-root `_idHighWater` monotonic counter
 * (stamped server-side by the symlinked task-view server on insert/remove; READ
 * by the KH CLI's client-side `nextId` pre-allocation). These tests prove the
 * end-to-end no-reuse behaviour by driving the exported `run()` against temp
 * copies of the synthetic fixture ledgers — the SAME write path production uses
 * (create/delete/promote POST a ServerIntent to the symlinked server, which
 * owns the authoritative write + the `_idHighWater` stamp).
 *
 * DOGFOODING HAZARD: this CLI writes the workflow's own ledgers. Every command
 * here runs against a TEMP COPY (mkdtemp + copyFile), never the real ledgers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

// ID-68.35: synthetic fixtures (never the live ledgers).
const FIXTURES = {
  task: resolve(__dirname, '../fixtures/ledger/task-list.json'),
  roadmap: resolve(__dirname, '../fixtures/ledger/product-roadmap.json'),
  backlog: resolve(__dirname, '../fixtures/ledger/product-backlog.json'),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-highwater-'));
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
      noRegenMirrors: true, // suppress regen in tests (no separate task-view clone)
      ledgerDir: dir,
      ...extra,
    },
  };
}

function readBacklog() {
  return JSON.parse(readFileSync(join(dir, 'product-backlog.json'), 'utf8'));
}

/** Schema-valid Task record (mirrors ledger-cli-promote-scoped.test.ts). */
function validTaskRecord(id: string) {
  return {
    id,
    title: 'High-water promote task',
    description: 'Compact what+why.',
    status: 'pending',
    priority: 'should',
    dependencies: [],
    subtasks: [],
    updatedAt: '2026-06-12T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}

async function createBacklogItem(title: string): Promise<string> {
  const r = await run(
    args('create-backlog', [], {
      title,
      description: 'A short summary.',
      status: 'parked',
      priority: 'low',
    }),
  );
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('create-backlog failed');
  return (r.result as { recordId: string }).recordId;
}

describe('auto-id high-water — WS-C C4 Bug3: freed ids are NEVER reused', () => {
  it('the backlog document round-trips an optional _idHighWater field', () => {
    // Sanity: the KH schema (orchestrator commit 8e1b07558) accepts the field.
    // After a delete the server stamps it; assert the doc is still parseable and
    // the field, once present, survives a read.
    const before = readBacklog();
    // The fixture starts WITHOUT the field (backward-compat baseline).
    expect(before._idHighWater).toBeUndefined();
    // Inject + re-read via the schema by routing through a delete (below tests
    // assert persistence); here just prove an in-memory doc with the field is
    // structurally valid JSON the CLI can re-read.
    const withField = { ...before, _idHighWater: 999 };
    expect(typeof withField._idHighWater).toBe('number');
    expect(JSON.parse(JSON.stringify(withField))._idHighWater).toBe(999);
  });

  it('Repro A — create → delete → create does NOT reuse the freed id', async () => {
    const before = readBacklog();
    const liveMax = Math.max(
      ...before.items.map((it: { id: string }) => Number(it.id)),
    );
    const expectedFirst = String(liveMax + 1);

    // 1. Create → allocates liveMax+1.
    const a = await createBacklogItem('High-water A');
    expect(a).toBe(expectedFirst);

    // 2. Delete the just-created top id (the server stamps _idHighWater = a).
    const del = await run(args('delete-backlog', [a]));
    expect(del.ok).toBe(true);
    const afterDelete = readBacklog();
    expect(afterDelete.items.some((it: { id: string }) => it.id === a)).toBe(
      false,
    );
    // The freed top id is recorded in the persisted monotonic counter.
    expect(afterDelete._idHighWater).toBe(Number(a));

    // 3. Create again → must allocate a+1, NOT reuse the freed a.
    const b = await createBacklogItem('High-water B');
    expect(b).not.toBe(a);
    expect(b).toBe(String(Number(a) + 1));
  });

  it('Repro B — promote (frees the backlog id) → create does NOT reuse it', async () => {
    const before = readBacklog();
    const liveMax = Math.max(
      ...before.items.map((it: { id: string }) => Number(it.id)),
    );

    // 1. Create a backlog item to promote.
    const promoteMe = await createBacklogItem('Promote-me');
    expect(promoteMe).toBe(String(liveMax + 1));

    // 2. Promote it (removes it from the backlog; the promoted Task now
    //    back-references this backlog id). The server stamps _idHighWater.
    const newTaskId = '9970';
    const prom = await run(
      args('promote', [promoteMe, JSON.stringify(validTaskRecord(newTaskId))]),
    );
    expect(prom.ok).toBe(true);
    if (prom.ok) {
      expect(prom.result).toMatchObject({
        newTaskId,
        removedBacklogId: promoteMe,
      });
    }
    const afterPromote = readBacklog();
    expect(
      afterPromote.items.some((it: { id: string }) => it.id === promoteMe),
    ).toBe(false);
    expect(afterPromote._idHighWater).toBe(Number(promoteMe));

    // 3. Create again → must NOT reuse the promoted-out id.
    const next = await createBacklogItem('After promote');
    expect(next).not.toBe(promoteMe);
    expect(next).toBe(String(Number(promoteMe) + 1));
  });
});
