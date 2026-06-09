/**
 * ledger-cli-umbrella.test.ts — `update-umbrella` subcommand (ID-35.41).
 *
 * `docs/reference/umbrellas.json` previously had NO CLI write support;
 * `task_ids[]` maintenance required a hand-written `escapeSerialise` node
 * script. This subcommand adds three guarded operations on a named umbrella's
 * `task_ids[]`:
 *   - `--add-tasks <csv>`    — idempotent append (present ids skipped, order
 *                              preserved, new ids appended in given order).
 *   - `--remove-tasks <csv>` — remove named ids (absent ids = no-op).
 *   - `--reorder <csv>`      — replace task_ids with a permutation of the set
 *                              (reject if it adds/drops any id).
 *
 * Guards mirror the {35.16} record-set pattern, derived from the BYTES ABOUT
 * TO BE WRITTEN: (a) the umbrella id-set is unchanged, (b) the edited
 * umbrella's resulting task_ids set equals the pre-write set with the
 * requested delta applied.
 *
 * NOTE on byte-format (post-ID-90.16): umbrellas.json is now normalised to
 * the same `\uXXXX`-escaped convention as the three core ledgers (inv 51-52).
 * `serialiseUmbrellas` delegates to `escapeSerialise`; the live file was
 * normalised in the same commit that introduced this flip.
 *
 * Tests use a CUSTOM TEMP FIXTURE (an umbrella missing the add ids), never the
 * live `docs/reference/umbrellas.json` — the live `canonical-pipeline` umbrella
 * already contains 28,49,52,53,54,55 so the brief's literal example is a no-op
 * against live data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';
import { escapeSerialise } from '@/lib/ledger/scoped-serialise';

let dir: string;

/** A throwaway umbrellas.json with one umbrella missing the add-test ids. */
function fixture(): unknown {
  return {
    document_name: 'umbrellas',
    document_purpose:
      'Throwaway test fixture — em-dash here exercises raw-UTF-8 byte fidelity: — do not escape.',
    last_updated: 'kh-main-S279 — umbrella CLI test fixture',
    related_documents: ['docs/reference/task-list.json'],
    umbrellas: [
      {
        id: 'test-umbrella',
        title: 'Test Umbrella',
        substrate_doc: 'docs/tracks/test.md',
        task_ids: ['10', '11'],
        status: 'in_progress',
        phase: 'Phase 1',
      },
      {
        id: 'sibling-umbrella',
        title: 'Sibling Umbrella',
        substrate_doc: 'docs/tracks/sibling.md',
        task_ids: ['99'],
        status: 'proposed',
        phase: 'Phase 1',
      },
    ],
  };
}

/** Serialise a fixture object exactly as the on-disk umbrellas.json format
 * (post-ID-90.16: \uXXXX-escaped non-ASCII, matching escapeSerialise). */
function serialiseFixture(obj: unknown): string {
  return escapeSerialise(obj);
}

function writeFixture(obj: unknown = fixture()): string {
  const path = join(dir, 'umbrellas.json');
  writeFileSync(path, serialiseFixture(obj), 'utf8');
  return path;
}

function rawFile(): string {
  return readFileSync(join(dir, 'umbrellas.json'), 'utf8');
}

function readDoc(): {
  umbrellas: Array<{ id: string; task_ids: string[] }>;
} {
  return JSON.parse(rawFile());
}

function taskIdsOf(id: string): string[] | undefined {
  return readDoc().umbrellas.find((u) => u.id === id)?.task_ids;
}

function args(
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
): ParsedArgs {
  return {
    subcommand: 'update-umbrella',
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
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-umb-'));
  writeFixture();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('update-umbrella --add-tasks (ID-35.41)', () => {
  it('appends all 6 not-yet-present ids in given order, no dupes', async () => {
    const r = await run(
      args(['test-umbrella'], { addTasks: '28,49,52,53,54,55' }),
    );
    expect(r.ok).toBe(true);
    expect(taskIdsOf('test-umbrella')).toEqual([
      '10',
      '11',
      '28',
      '49',
      '52',
      '53',
      '54',
      '55',
    ]);
  });

  it('idempotent: present ids are skipped, not duplicated, order preserved', async () => {
    const r = await run(args(['test-umbrella'], { addTasks: '11,28,10' }));
    expect(r.ok).toBe(true);
    // 11 and 10 already present (skipped); 28 appended.
    expect(taskIdsOf('test-umbrella')).toEqual(['10', '11', '28']);
  });

  it('re-running the SAME add is a byte-level no-op (exit 0, file unchanged)', async () => {
    await run(args(['test-umbrella'], { addTasks: '28,49' }));
    const after1 = rawFile();
    const r = await run(args(['test-umbrella'], { addTasks: '28,49' }));
    expect(r.ok).toBe(true);
    expect(rawFile()).toBe(after1);
  });

  it('leaves sibling umbrellas untouched', async () => {
    await run(args(['test-umbrella'], { addTasks: '28' }));
    expect(taskIdsOf('sibling-umbrella')).toEqual(['99']);
  });
});

describe('update-umbrella --remove-tasks (ID-35.41)', () => {
  it('removes exactly the named ids, siblings within array untouched', async () => {
    writeFixture({
      ...(fixture() as object),
      umbrellas: [
        {
          id: 'test-umbrella',
          title: 'Test Umbrella',
          substrate_doc: 'docs/tracks/test.md',
          task_ids: ['10', '11', '12', '13'],
          status: 'in_progress',
          phase: 'Phase 1',
        },
      ],
    });
    const r = await run(args(['test-umbrella'], { removeTasks: '11,13' }));
    expect(r.ok).toBe(true);
    expect(taskIdsOf('test-umbrella')).toEqual(['10', '12']);
  });

  it('removing an absent id is a no-op, not an error', async () => {
    const r = await run(args(['test-umbrella'], { removeTasks: '999' }));
    expect(r.ok).toBe(true);
    expect(taskIdsOf('test-umbrella')).toEqual(['10', '11']);
  });

  it('removing only absent ids is a byte-level no-op', async () => {
    const before = rawFile();
    const r = await run(args(['test-umbrella'], { removeTasks: '999,888' }));
    expect(r.ok).toBe(true);
    expect(rawFile()).toBe(before);
  });
});

describe('update-umbrella --reorder (ID-35.41)', () => {
  it('permutes task_ids to the given order', async () => {
    writeFixture({
      ...(fixture() as object),
      umbrellas: [
        {
          id: 'test-umbrella',
          title: 'Test Umbrella',
          substrate_doc: 'docs/tracks/test.md',
          task_ids: ['10', '11', '12'],
          status: 'in_progress',
          phase: 'Phase 1',
        },
      ],
    });
    const r = await run(args(['test-umbrella'], { reorder: '12,10,11' }));
    expect(r.ok).toBe(true);
    expect(taskIdsOf('test-umbrella')).toEqual(['12', '10', '11']);
  });

  it('rejects a reorder that drops an id (not a permutation)', async () => {
    const before = rawFile();
    const r = await run(args(['test-umbrella'], { reorder: '10' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('reorder-not-permutation');
    // nothing written (state + byte-level)
    expect(taskIdsOf('test-umbrella')).toEqual(['10', '11']);
    expect(rawFile()).toBe(before);
  });

  it('rejects a reorder that adds an id (not a permutation)', async () => {
    const before = rawFile();
    const r = await run(args(['test-umbrella'], { reorder: '10,11,12' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('reorder-not-permutation');
    expect(taskIdsOf('test-umbrella')).toEqual(['10', '11']);
    expect(rawFile()).toBe(before);
  });

  it('rejects a reorder that duplicates an id', async () => {
    const before = rawFile();
    const r = await run(args(['test-umbrella'], { reorder: '10,10' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('reorder-not-permutation');
    expect(rawFile()).toBe(before);
  });
});

describe('update-umbrella rejections (ID-35.41)', () => {
  it('rejects an unknown umbrella id, nothing written', async () => {
    const before = rawFile();
    const r = await run(args(['no-such-umbrella'], { addTasks: '28' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('unknown-umbrella');
    expect(rawFile()).toBe(before);
  });

  it('rejects a malformed (non-bare-digit) task id', async () => {
    const before = rawFile();
    const r = await run(args(['test-umbrella'], { addTasks: '28,foo' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('malformed-task-id');
    expect(rawFile()).toBe(before);
  });

  it('rejects when no op-flag is supplied', async () => {
    const r = await run(args(['test-umbrella']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('missing-args');
  });

  it('rejects when no umbrella id positional is supplied', async () => {
    const r = await run(args([], { addTasks: '28' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('missing-args');
  });

  it('rejects combining --reorder with --add-tasks', async () => {
    const r = await run(
      args(['test-umbrella'], { reorder: '11,10', addTasks: '28' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('conflicting-ops');
  });

  it('rejects combining --reorder with --remove-tasks, nothing written', async () => {
    const before = rawFile();
    // reorder is a valid permutation of [10,11]; removeTasks names an existing
    // id — the guard rejects on the op-flag combination, before any mutation.
    const r = await run(
      args(['test-umbrella'], { reorder: '11,10', removeTasks: '10' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('conflicting-ops');
    expect(rawFile()).toBe(before);
  });

  it('rejects an id present in BOTH --add-tasks and --remove-tasks', async () => {
    const r = await run(
      args(['test-umbrella'], { addTasks: '28', removeTasks: '28' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('conflicting-ops');
  });
});

describe('update-umbrella --add-tasks + --remove-tasks combined (ID-35.41)', () => {
  it('applies add-then-remove in one call', async () => {
    const r = await run(
      args(['test-umbrella'], { addTasks: '28,49', removeTasks: '10' }),
    );
    expect(r.ok).toBe(true);
    // add 28,49 → [10,11,28,49]; remove 10 → [11,28,49]
    expect(taskIdsOf('test-umbrella')).toEqual(['11', '28', '49']);
  });
});

describe('update-umbrella --dry-run (ID-35.41)', () => {
  it('reports the delta without writing, bounded output', async () => {
    const before = rawFile();
    const r = await run(
      args(['test-umbrella'], { addTasks: '28,49', dryRun: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // file unchanged
    expect(rawFile()).toBe(before);
    // bounded payload tagged dryRun (NOT a full-document dump)
    const result = r.result as { dryRun?: boolean; added?: string[] };
    expect(result.dryRun).toBe(true);
    expect(result.added).toEqual(['28', '49']);
    // bounded: no full umbrellas array in the payload
    expect(JSON.stringify(r.result)).not.toContain('document_purpose');
  });
});

describe('update-umbrella stdout-purity envelope (ID-35.41)', () => {
  it('success result is the {ok:true,subcommand,result} envelope shape', async () => {
    const r = await run(args(['test-umbrella'], { addTasks: '28' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subcommand).toBe('update-umbrella');
    expect(r).toHaveProperty('result');
  });
});

describe('update-umbrella byte-format fidelity (ID-35.41, inv 51-52)', () => {
  it('escapes non-ASCII to \\uXXXX (em-dash escaped, not raw)', async () => {
    await run(args(['test-umbrella'], { addTasks: '28' }));
    const raw = rawFile();
    // em-dash escaped to \u2014 (inv 51-52 normalisation)
    expect(raw).toContain('\\u2014');
    expect(raw).not.toContain('\u2014');
    // 2-space indent + single trailing newline
    expect(raw.endsWith('}\n')).toBe(true);
    expect(raw).toContain('\n  "document_name"');
  });
});
