/**
 * ledger-cli-read-path.test.ts — unit tests for the S447 read-path upgrade:
 *   1. `show` 48KB journal-stub safety valve + --full / --summary / --no-journals
 *      / --fields shaping.
 *   2. `get task <taskId>.<subId> [field]` subtask paths.
 *   3. `journal <taskId.subId>` thread (chronological order, archive-pointer
 *      resolution, --last supersession warning) + `journal <taskId>` index.
 *   4. `list task` derived `subtasks` done/total roll-up lives in
 *      ledger-cli-list.test.ts; this file covers the read-only journal surface.
 *
 * Drives the exported `run()` against temp ledgers built by deep-cloning the
 * schema-valid fixture records and inflating a subtask's `details` with
 * journal blocks + an archive-pointer stub (plus a matching archive markdown).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

const FIXTURE_DIR = resolve(__dirname, '../fixtures/ledger');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const readFixture = (file: string) =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'));

/** Build a canonical journal block with an explicit timestamp. */
const jb = (ts: string, text: string) =>
  `<info added on ${ts}>\n${text}\n</info added on ${ts}>`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-read-'));

  const tasks = readFixture('task-list.json');

  // ── task 1 — a live journal thread (1.1) + an archive-pointer stub (1.2). ──
  const t1 = tasks.tasks[0]; // id '1', 2 pending subtasks
  t1.subtasks[0].details =
    'Original brief prose for 1.1 — keep me.\n' +
    jb('2026-06-15T10:00:00.000Z', 'FIRST entry.') +
    '\n\n' +
    jb('2026-06-15T11:00:00.000Z', 'SECOND entry supersedes the first.') +
    '\n\n' +
    jb('2026-06-16T09:00:00.000Z', 'THIRD entry — final word.');
  t1.subtasks[1].details =
    'Journal archived 2026-06-12 (WS-B3 compaction) -> ' +
    'ledgers/archive/ID-1-journals.md section 1.2 (original 500 chars).';

  // ── task 900 — a subtask whose single journal block trips the 48KB valve;
  //    stubbing the journal alone brings it back under (STAGE 1). ──
  const big = clone(t1);
  big.id = '900';
  big.title = 'Valve fixture task (stage 1: stub fits)';
  const bigSub = clone(t1.subtasks[0]);
  bigSub.id = '1';
  bigSub.details =
    'Keep this prose.\n' + jb('2026-06-20T00:00:00.000Z', 'X'.repeat(60000));
  big.subtasks = [bigSub];
  tasks.tasks.push(big);

  // ── task 901 — prose-heavy: 10 subtasks each 6KB non-journal prose + a 3KB
  //    journal block. Stubbing the journals is NOT enough (60KB of prose
  //    remains), so the valve degrades to the --summary shape (STAGE 2). ──
  const prose = clone(t1);
  prose.id = '901';
  prose.title = 'Valve fixture task (stage 2: degrade to summary)';
  prose.subtasks = Array.from({ length: 10 }, (_, i) => {
    const s = clone(t1.subtasks[0]);
    s.id = String(i + 1);
    s.details =
      'P'.repeat(6000) +
      '\n' +
      jb('2026-06-20T00:00:00.000Z', 'J'.repeat(3000));
    return s;
  });
  tasks.tasks.push(prose);

  // ── task 902 — a 60KB top-level `description` (schema has no .max()). Even the
  //    summary keeps the description, so the valve falls through to the identity
  //    projection (STAGE 3). ──
  const desc = clone(t1);
  desc.id = '902';
  desc.title = 'Valve fixture task (stage 3: identity projection)';
  desc.description = 'D'.repeat(60000);
  desc.subtasks = [clone(t1.subtasks[0]), clone(t1.subtasks[1])];
  desc.subtasks[0].id = '1';
  desc.subtasks[0].details = 'small';
  desc.subtasks[1].id = '2';
  desc.subtasks[1].details = 'small';
  tasks.tasks.push(desc);

  writeFileSync(join(dir, 'task-list.json'), JSON.stringify(tasks), 'utf8');

  // Other ledgers copied verbatim (unused here but detectSchema-loadable).
  for (const f of [
    'product-backlog.json',
    'product-roadmap.json',
    'product-retros.json',
  ]) {
    writeFileSync(join(dir, f), JSON.stringify(readFixture(f)), 'utf8');
  }

  // ── archive markdown for the 1.2 pointer. §1.1 / §1.3 flank §1.2 so the
  //    section-extraction boundary (and the 1.1-vs-1.10 word-boundary) is
  //    exercised. ──
  mkdirSync(join(dir, 'archive'), { recursive: true });
  writeFileSync(
    join(dir, 'archive', 'ID-1-journals.md'),
    [
      '# ID-1 — archived subtask journals',
      '',
      '## 1.1 — wrong section',
      '',
      'DO NOT return this body.',
      '',
      '## 1.2 — the archived subtask',
      '',
      'ARCHIVED BODY line one.',
      jb('2026-06-01T00:00:00.000Z', 'archived journal block'),
      '',
      '## 1.3 — after',
      '',
      'DO NOT return this either.',
      '',
    ].join('\n'),
    'utf8',
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}

async function ok(
  subcommand: string,
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
) {
  const r = await run(args(subcommand, positionals, extra));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r;
}

const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

describe('ledger-cli — show 48KB journal-stub valve (S447)', () => {
  it('auto-stubs subtask journals over 48KB and adds a top-level notice', async () => {
    const r = await ok('show', ['task', '900']);
    const rec = r.result as {
      notice?: string;
      subtasks: { id: string; details: string }[];
    };
    expect(rec.notice).toBeDefined();
    expect(rec.notice).toContain('--full');
    const sub = rec.subtasks[0];
    // Journal replaced by a stub; the non-journal prose survives.
    expect(sub.details).toContain('Keep this prose.');
    expect(sub.details).toContain('journal block');
    expect(sub.details).toContain('use: journal 900.1');
    expect(sub.details).not.toContain('XXXXXXXX');
    // The stubbed result is far smaller than the verbatim record.
    expect(size(rec)).toBeLessThan(48 * 1024);
  });

  it('--full restores the verbatim record (no valve, no notice)', async () => {
    const r = await ok('show', ['task', '900'], { full: true });
    const rec = r.result as {
      notice?: string;
      subtasks: { details: string }[];
    };
    expect(rec.notice).toBeUndefined();
    expect(rec.subtasks[0].details).toContain('X'.repeat(60000));
    expect(size(rec)).toBeGreaterThan(48 * 1024);
  });

  it('a small record is returned verbatim with no notice', async () => {
    const r = await ok('show', ['task', '1']);
    const rec = r.result as {
      notice?: string;
      subtasks: { details: string }[];
    };
    expect(rec.notice).toBeUndefined();
    // The live journal thread is intact.
    expect(rec.subtasks[0].details).toContain('THIRD entry');
  });

  it('stage 2: degrades to the summary shape when stubbing journals is not enough', async () => {
    const r = await ok('show', ['task', '901']);
    const rec = r.result as {
      notice?: string;
      subtasks: Record<string, unknown>[];
    };
    expect(rec.notice).toContain('degraded to a summary');
    // Subtasks are now the compact {id,title,status} table (details dropped).
    for (const s of rec.subtasks) {
      expect(Object.keys(s).sort()).toEqual(['id', 'status', 'title']);
    }
    expect(size(rec)).toBeLessThanOrEqual(48 * 1024);
  });

  it('stage 3: degrades to identity fields when even the summary is too big', async () => {
    const r = await ok('show', ['task', '902']);
    const rec = r.result as Record<string, unknown>;
    expect(String(rec.notice)).toContain('identity fields only');
    // Oversized top-level description is gone; only identity + count remain.
    expect(Object.keys(rec).sort()).toEqual([
      'id',
      'notice',
      'status',
      'subtaskCount',
      'title',
    ]);
    expect(rec.subtaskCount).toBe(2);
    expect(size(rec)).toBeLessThanOrEqual(48 * 1024);
  });

  it('INVARIANT: default show is never >48KB regardless of record shape', async () => {
    for (const id of ['1', '2', '900', '901', '902']) {
      const r = await ok('show', ['task', id]);
      expect(size(r.result)).toBeLessThanOrEqual(48 * 1024);
    }
    // …and --full is the only shape allowed to exceed it (900/901/902 are big).
    for (const id of ['900', '901', '902']) {
      const r = await ok('show', ['task', id], { full: true });
      expect(size(r.result)).toBeGreaterThan(48 * 1024);
    }
  });
});

describe('ledger-cli — show shaping flags (S447)', () => {
  it('--no-journals strips journal blocks regardless of size, keeps prose', async () => {
    const r = await ok('show', ['task', '1'], { noJournals: true });
    const rec = r.result as {
      notice?: string;
      subtasks: { id: string; details: string }[];
    };
    expect(rec.notice).toContain('--no-journals');
    const sub11 = rec.subtasks.find((s) => s.id === '1')!;
    expect(sub11.details).toContain('Original brief prose for 1.1');
    expect(sub11.details).toContain('3 journal blocks');
    expect(sub11.details).not.toContain('THIRD entry');
  });

  it('--summary returns top-level fields + a compact {id,title,status} table', async () => {
    const r = await ok('show', ['task', '1'], { summary: true });
    const rec = r.result as {
      id: string;
      subtasks: Record<string, unknown>[];
    };
    expect(rec.id).toBe('1');
    for (const s of rec.subtasks) {
      expect(Object.keys(s).sort()).toEqual(['id', 'status', 'title']);
    }
  });

  it('--fields projects only the requested top-level fields', async () => {
    const r = await ok('show', ['task', '1'], { fields: 'id,status' });
    expect(Object.keys(r.result as object).sort()).toEqual(['id', 'status']);
  });

  it('--fields warns on an unknown field rather than dropping it silently', async () => {
    const r = await ok('show', ['task', '1'], { fields: 'id,bogus' });
    expect(Object.keys(r.result as object)).toEqual(['id']);
    expect(r.warnings?.some((w) => w.includes('bogus'))).toBe(true);
  });
});

describe('ledger-cli — get subtask paths (S447)', () => {
  it('get task <taskId>.<subId> returns the subtask record', async () => {
    const r = await ok('get', ['task', '1.1']);
    const sub = r.result as { id: string; details: string };
    expect(sub.id).toBe('1');
    expect(sub.details).toContain('FIRST entry');
  });

  it('get task <taskId>.<subId> <field> returns one subtask field', async () => {
    const r = await ok('get', ['task', '2.1', 'status']);
    expect(r.result).toBe('done');
  });

  it('subtask-not-found for a missing subId', async () => {
    const r = await run(args('get', ['task', '1.999']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('subtask-not-found');
  });

  it('field-not-found for a missing subtask field', async () => {
    const r = await run(args('get', ['task', '1.1', 'nope']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('field-not-found');
  });
});

describe('ledger-cli — journal thread + index (S447)', () => {
  it('journal <taskId.subId> returns live blocks in chronological order', async () => {
    const r = await ok('journal', ['1.1']);
    const res = r.result as {
      total: number;
      shown: number;
      truncated: boolean;
      entries: { provenance: string; text: string }[];
    };
    expect(res.total).toBe(3);
    expect(res.truncated).toBe(false);
    const order = res.entries.map((e) =>
      e.text.includes('FIRST')
        ? 'FIRST'
        : e.text.includes('SECOND')
          ? 'SECOND'
          : 'THIRD',
    );
    expect(order).toEqual(['FIRST', 'SECOND', 'THIRD']);
    expect(res.entries.every((e) => e.provenance === 'live')).toBe(true);
  });

  it('--last N returns the N most-recent entries with a supersession warning', async () => {
    const r = await ok('journal', ['1.1'], { last: '2' });
    const res = r.result as {
      total: number;
      shown: number;
      truncated: boolean;
    };
    expect(res.total).toBe(3);
    expect(res.shown).toBe(2);
    expect(res.truncated).toBe(true);
    expect(
      r.warnings?.some(
        (w) => w.includes('supersession') || w.includes('supersede'),
      ),
    ).toBe(true);
  });

  it('--last N >= total is a no-op (no truncation, no warning)', async () => {
    const r = await ok('journal', ['1.1'], { last: '9' });
    const res = r.result as { shown: number; truncated: boolean };
    expect(res.shown).toBe(3);
    expect(res.truncated).toBe(false);
    expect(r.warnings ?? []).toEqual([]);
  });

  it('resolves an archive-pointer stub, merged before live blocks with provenance', async () => {
    const r = await ok('journal', ['1.2']);
    const res = r.result as {
      total: number;
      entries: { provenance: string; source?: string; text: string }[];
    };
    expect(res.total).toBe(1);
    const arc = res.entries[0];
    expect(arc.provenance).toBe('archived');
    expect(arc.source).toContain('ID-1-journals.md');
    expect(arc.source).toContain('1.2');
    expect(arc.text).toContain('ARCHIVED BODY line one.');
    // Section boundaries respected — the flanking sections must NOT leak in.
    expect(arc.text).not.toContain('DO NOT return');
  });

  it('journal <taskId> returns a per-subtask index (counts, not content)', async () => {
    const r = await ok('journal', ['1']);
    const res = r.result as {
      task: string;
      subtasks: {
        id: string;
        journalBlocks: number;
        chars: number;
        latest: string | null;
        archived?: string[];
      }[];
    };
    expect(res.task).toBe('1');
    const s1 = res.subtasks.find((s) => s.id === '1')!;
    expect(s1.journalBlocks).toBe(3);
    expect(s1.chars).toBeGreaterThan(0);
    expect(s1.latest).toBe('2026-06-16T09:00:00.000Z');
    expect(s1.archived).toBeUndefined();
    const s2 = res.subtasks.find((s) => s.id === '2')!;
    expect(s2.journalBlocks).toBe(0);
    expect(s2.archived?.[0]).toContain('§1.2');
  });

  it('rejects a non-integer --last (never a silent slice)', async () => {
    const r = await run(args('journal', ['1.1'], { last: 'abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-flag-value');
  });

  it('record-not-found for a missing task index', async () => {
    const r = await run(args('journal', ['99999']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('record-not-found');
  });
});
