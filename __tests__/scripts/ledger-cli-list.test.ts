/**
 * ledger-cli-list.test.ts — unit tests for the read-only `list` subcommand
 * (task/roadmap/backlog/retro snapshot + filters). Drives the exported `run()`
 * directly against temp ledgers built by deep-cloning the schema-valid fixture
 * records into the richer shapes the filters exercise (a cancelled Task, a
 * dependency edge, a capability_theme, a deprecated retro, multiple sessions).
 *
 * Kept in its own file (not the shared ledger-cli.test.ts) so the augmented
 * fixtures never perturb count assertions in the other suites.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, run, type ParsedArgs } from '@/scripts/ledger-cli';

const FIXTURE_DIR = resolve(__dirname, '../fixtures/ledger');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const readFixture = (file: string) =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8'));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-list-'));

  // ── task-list: 3 live tasks (1/2/35) + 1 cancelled (99). task 1 carries a
  //    capability_theme; task 2 depends on task 1; updatedAt is distinct so
  //    --since / --recent are deterministic.
  const tasks = readFixture('task-list.json');
  const t1 = tasks.tasks[0]; // id 1, in_progress, 2026-01-01
  t1.capability_theme = '5';
  const t2 = tasks.tasks[1]; // id 2, pending, 2026-01-02
  t2.dependencies = ['1'];
  // tasks.tasks[2] = id 35, pending, 2026-01-03 (left as-is)
  const cancelled = clone(t1);
  cancelled.id = '99';
  cancelled.title = 'Fixture Task Cancelled';
  cancelled.status = 'cancelled';
  cancelled.capability_theme = null;
  cancelled.updatedAt = '2026-01-04T00:00:00.000Z';
  tasks.tasks.push(cancelled);
  writeFileSync(join(dir, 'task-list.json'), JSON.stringify(tasks), 'utf8');

  // ── retros: S1..S3 live + S4 deprecated. Distinct dates.
  const retros = readFixture('product-retros.json');
  const base = retros.retros[0]; // S1, 2026-01-01
  const mk = (id: string, date: string, deprecated: boolean) => {
    const r = clone(base);
    r.id = id;
    r.date = date;
    r.deprecated = deprecated;
    return r;
  };
  retros.retros = [
    base,
    mk('S2', '2026-01-02', false),
    mk('S3', '2026-01-03', false),
    mk('S4', '2026-01-04', true),
  ];
  writeFileSync(
    join(dir, 'product-retros.json'),
    JSON.stringify(retros),
    'utf8',
  );

  // ── backlog + roadmap: copied verbatim (already valid; statuses suffice).
  writeFileSync(
    join(dir, 'product-backlog.json'),
    JSON.stringify(readFixture('product-backlog.json')),
    'utf8',
  );
  writeFileSync(
    join(dir, 'product-roadmap.json'),
    JSON.stringify(readFixture('product-roadmap.json')),
    'utf8',
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function args(
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
): ParsedArgs {
  return {
    subcommand: 'list',
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

type ListResult = {
  ledger: string;
  total: number;
  shown: number;
  truncated: boolean;
  records: unknown[];
};
async function listOk(
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
) {
  const r = await run(args(positionals, extra));
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('expected ok');
  return r as Extract<typeof r, { ok: true }> & { result: ListResult };
}

describe('ledger-cli — list snapshot defaults', () => {
  it('list task returns every non-cancelled task as {id,title,status,subtasks}', async () => {
    const r = await listOk(['task']);
    const res = r.result as ListResult;
    expect(res.ledger).toBe('task');
    expect(res.total).toBe(3);
    expect(res.shown).toBe(3);
    expect(res.truncated).toBe(false);
    const ids = (res.records as { id: string }[]).map((x) => x.id).sort();
    expect(ids).toEqual(['1', '2', '35']);
    // S447: the default projection now carries the derived subtasks roll-up.
    expect(Object.keys(res.records[0] as object).sort()).toEqual([
      'id',
      'status',
      'subtasks',
      'title',
    ]);
  });

  it('S447: the subtasks column renders done/total (done counts done+cancelled)', async () => {
    const r = await listOk(['task']);
    const rows = (r.result as ListResult).records as {
      id: string;
      subtasks: string;
    }[];
    const byId = Object.fromEntries(rows.map((x) => [x.id, x.subtasks]));
    // Fixture: task 1 = 2 pending, task 2 = 1 done, task 35 = 2 pending.
    expect(byId['1']).toBe('0/2');
    expect(byId['2']).toBe('1/1');
    expect(byId['35']).toBe('0/2');
  });

  it('is read-only — the ledger mtime is untouched', async () => {
    const before = statSync(join(dir, 'task-list.json')).mtimeMs;
    await listOk(['task']);
    expect(statSync(join(dir, 'task-list.json')).mtimeMs).toBe(before);
  });

  it('list backlog returns all items (no task-only cancelled rule)', async () => {
    const r = await listOk(['backlog']);
    expect((r.result as ListResult).total).toBe(3);
  });

  it('list roadmap is retired (ID-148.8, TECH §3.4 INV-7) — returns retired-verb', async () => {
    const r = await run(args(['roadmap']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('retired-verb');
  });

  it('list retro excludes deprecated and projects {id,date,track}', async () => {
    const r = await listOk(['retro']);
    const res = r.result as ListResult;
    expect(res.total).toBe(3); // S4 deprecated dropped
    const ids = (res.records as { id: string }[]).map((x) => x.id).sort();
    expect(ids).toEqual(['S1', 'S2', 'S3']);
    expect(Object.keys(res.records[0] as object).sort()).toEqual([
      'date',
      'id',
      'track',
    ]);
  });
});

describe('ledger-cli — list filters', () => {
  it('--status filters and OVERRIDES the cancelled-exclusion default', async () => {
    const pending = await listOk(['task'], { status: 'pending' });
    expect(
      (pending.result as ListResult).records
        .map((x) => (x as { id: string }).id)
        .sort(),
    ).toEqual(['2', '35']);
    // Explicit --status cancelled surfaces the cancelled task.
    const cancelled = await listOk(['task'], { status: 'cancelled' });
    const cres = cancelled.result as ListResult;
    expect(cres.total).toBe(1);
    expect((cres.records[0] as { id: string }).id).toBe('99');
  });

  it('--status accepts a csv of statuses', async () => {
    const r = await listOk(['task'], { status: 'in_progress,pending' });
    expect((r.result as ListResult).total).toBe(3);
  });

  it('--depends-on returns tasks whose dependency array contains the id', async () => {
    const r = await listOk(['task'], { dependsOn: '1' });
    const res = r.result as ListResult;
    expect(res.total).toBe(1);
    expect((res.records[0] as { id: string }).id).toBe('2');
  });

  it('--theme filters task.capability_theme', async () => {
    const r = await listOk(['task'], { theme: '5' });
    const res = r.result as ListResult;
    expect(res.total).toBe(1);
    expect((res.records[0] as { id: string }).id).toBe('1');
  });

  it('--since keeps records on/after the ISO date (date-only token vs datetime field)', async () => {
    const r = await listOk(['task'], { since: '2026-01-03' });
    const res = r.result as ListResult;
    expect(res.records.map((x) => (x as { id: string }).id)).toEqual(['35']);
  });

  it('--since on retro reads the ISO date field', async () => {
    const r = await listOk(['retro'], { since: '2026-01-03' });
    expect(
      (r.result as ListResult).records.map((x) => (x as { id: string }).id),
    ).toEqual(['S3']);
  });
});

describe('ledger-cli — list projection + ordering + caps', () => {
  it('--ids-only returns a bare id array', async () => {
    const r = await listOk(['task'], { idsOnly: true });
    const res = r.result as ListResult;
    expect((res.records as string[]).sort()).toEqual(['1', '2', '35']);
  });

  it('--fields projects exactly the requested columns', async () => {
    const r = await listOk(['task'], { fields: 'id,status' });
    expect(
      Object.keys((r.result as ListResult).records[0] as object).sort(),
    ).toEqual(['id', 'status']);
  });

  it('--limit caps output and reports total + truncated + a warning', async () => {
    const r = await listOk(['task'], { limit: '2' });
    const res = r.result as ListResult;
    expect(res.shown).toBe(2);
    expect(res.total).toBe(3);
    expect(res.truncated).toBe(true);
    expect(r.warnings?.some((w) => w.includes('showing 2 of 3'))).toBe(true);
  });

  it('--recent on task orders most-recent-first by updatedAt', async () => {
    const r = await listOk(['task'], { recent: '2' });
    const res = r.result as ListResult;
    expect(res.records.map((x) => (x as { id: string }).id)).toEqual([
      '35',
      '2',
    ]);
    expect(res.total).toBe(3);
    expect(res.truncated).toBe(true);
  });

  it('--recent on retro orders most-recent-first by session id', async () => {
    const r = await listOk(['retro'], { recent: '2' });
    expect(
      (r.result as ListResult).records.map((x) => (x as { id: string }).id),
    ).toEqual(['S3', 'S2']);
  });
});

describe('ledger-cli — list inert filters + errors', () => {
  it('--status on retro is reported inert, not silently dropped', async () => {
    const r = await listOk(['retro'], { status: 'done' });
    expect((r.result as ListResult).total).toBe(3);
    expect(r.warnings?.some((w) => w.includes('--status ignored'))).toBe(true);
  });

  it('rejects a missing ledger', async () => {
    const r = await run(args([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('missing-args');
  });

  it('rejects an unknown ledger', async () => {
    const r = await run(args(['bogus']));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-ledger');
  });

  it('rejects a non-integer --recent (never a silent slice)', async () => {
    const r = await run(args(['task'], { recent: 'abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('bad-flag-value');
      expect(r.detail).toContain('--recent');
    }
  });

  it('rejects a negative --limit', async () => {
    const r = await run(args(['task'], { limit: '-1' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('bad-flag-value');
  });
});

describe('parseArgs — list value-flags tokenise (raw strings)', () => {
  it('captures the list filter/projection flags', () => {
    const r = parseArgs([
      'list',
      'task',
      '--status',
      'done',
      '--since',
      '2026-01-01',
      '--theme',
      '5',
      '--depends-on',
      '1',
      '--recent',
      '3',
      '--limit',
      '10',
      '--fields',
      'id,title',
      '--ids-only',
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { flags, subcommand, positionals } = r.parsed;
    expect(subcommand).toBe('list');
    expect(positionals).toEqual(['task']);
    expect(flags.status).toBe('done');
    expect(flags.since).toBe('2026-01-01');
    expect(flags.theme).toBe('5');
    expect(flags.dependsOn).toBe('1');
    expect(flags.recent).toBe('3'); // raw string — coerced at the call site
    expect(flags.limit).toBe('10');
    expect(flags.fields).toBe('id,title');
    expect(flags.idsOnly).toBe(true);
  });
});
