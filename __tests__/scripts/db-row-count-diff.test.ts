/**
 * Vitest unit tests for `scripts/db-row-count-diff.ts`.
 *
 * Covers (per WP-G3.5 acceptance criteria):
 *   - parseCliArgs: happy + sad path; --source/--target/--tables/--allowlist
 *   - parseAllowlist + loadAllowlist: empty / non-empty / malformed
 *   - computeDiff: zero delta, expected-empty, within-allowlist,
 *     out-of-allowlist drift, missing-on-one-side
 *   - summariseDiff: counter aggregation
 *   - renderMarkdown: header + body + status sort order
 *   - buildJsonSidecar + sidecarFilename: shape + filename safety
 *   - resolveCredentials: SOURCE_/TARGET_, PROD_/STAGING_, fallback chain
 *   - fetchTableInventory + countAllTables: live-DB calls mocked via the
 *     shared `createMockSupabaseClient()` helper
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseCliArgs,
  parseAllowlist,
  loadAllowlist,
  computeDiff,
  summariseDiff,
  renderMarkdown,
  buildJsonSidecar,
  sidecarFilename,
  resolveCredentials,
  fetchTableInventory,
  countOneTable,
  countAllTables,
  EXIT_OK,
  EXIT_DRIFT,
  EXIT_QUERY_FAILED,
  type RowCount,
  type DiffRow,
} from '../../scripts/db-row-count-diff';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('returns defaults when no flags are passed', () => {
    const args = parseCliArgs([]);
    expect(args.source).toBe('prod');
    expect(args.target).toBe('staging');
    expect(args.tables).toBeNull();
    expect(args.error).toBeNull();
    expect(args.help).toBe(false);
  });

  it('honours --help short and long forms', () => {
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--help']).help).toBe(true);
  });

  it('parses --source/--target via = form', () => {
    const args = parseCliArgs(['--source=staging', '--target=prod']);
    expect(args.error).toBeNull();
    expect(args.source).toBe('staging');
    expect(args.target).toBe('prod');
  });

  it('parses --source/--target via space form', () => {
    const args = parseCliArgs(['--source', 'staging', '--target', 'prod']);
    expect(args.error).toBeNull();
    expect(args.source).toBe('staging');
    expect(args.target).toBe('prod');
  });

  it('rejects unknown source value', () => {
    const args = parseCliArgs(['--source=dev']);
    expect(args.error).toContain("--source must be 'prod' or 'staging'");
  });

  it('rejects unknown target value', () => {
    const args = parseCliArgs(['--target=nope']);
    expect(args.error).toContain("--target must be 'prod' or 'staging'");
  });

  it('rejects identical source and target', () => {
    const args = parseCliArgs(['--source=prod', '--target=prod']);
    expect(args.error).toContain('--source and --target must differ');
  });

  it('parses --tables=A,B,C', () => {
    const args = parseCliArgs(['--tables=content_items, user_roles ,tags']);
    expect(args.error).toBeNull();
    expect(args.tables).toEqual(['content_items', 'user_roles', 'tags']);
  });

  it('rejects empty --tables list (only commas)', () => {
    const args = parseCliArgs(['--tables=,,, ']);
    expect(args.error).toContain(
      '--tables provided but parsed to an empty list',
    );
  });

  it('parses --allowlist=<path>', () => {
    const args = parseCliArgs(['--allowlist=/tmp/aw.json']);
    expect(args.error).toBeNull();
    expect(args.allowlistPath).toBe('/tmp/aw.json');
  });

  it('parses --output-dir=<path>', () => {
    const args = parseCliArgs(['--output-dir=/tmp/out']);
    expect(args.error).toBeNull();
    expect(args.outputDir).toBe('/tmp/out');
  });

  it('rejects unknown flags', () => {
    const args = parseCliArgs(['--rebuild-everything']);
    expect(args.error).toContain('unknown flag');
  });
});

// ---------------------------------------------------------------------------
// parseAllowlist
// ---------------------------------------------------------------------------

describe('parseAllowlist', () => {
  it('parses empty object', () => {
    const { allowlist, error } = parseAllowlist('{}');
    expect(error).toBeNull();
    expect(allowlist).toEqual({});
  });

  it('parses mixed expected-empty + integer values', () => {
    const { allowlist, error } = parseAllowlist(
      '{"users": "expected-empty", "events": 5}',
    );
    expect(error).toBeNull();
    expect(allowlist).toEqual({ users: 'expected-empty', events: 5 });
  });

  it('rejects malformed JSON', () => {
    const { error } = parseAllowlist('{not valid');
    expect(error).toContain('parse error');
  });

  it('rejects array root', () => {
    const { error } = parseAllowlist('[]');
    expect(error).toContain('JSON object');
  });

  it('rejects non-integer numeric values', () => {
    const { error } = parseAllowlist('{"foo": 3.5}');
    expect(error).toContain('non-negative integer');
  });

  it('rejects negative integers', () => {
    const { error } = parseAllowlist('{"foo": -1}');
    expect(error).toContain('non-negative integer');
  });

  it('rejects unknown string values', () => {
    const { error } = parseAllowlist('{"foo": "anything-else"}');
    expect(error).toContain('expected-empty');
  });

  it('rejects boolean values', () => {
    const { error } = parseAllowlist('{"foo": true}');
    expect(error).toContain('expected-empty');
  });
});

describe('loadAllowlist', () => {
  it('returns empty allowlist when file does not exist', () => {
    const { allowlist, error } = loadAllowlist('/nonexistent/aw.json');
    expect(error).toBeNull();
    expect(allowlist).toEqual({});
  });

  it('returns empty allowlist for empty file', () => {
    const tmp = path.join(os.tmpdir(), `aw-${Date.now()}.json`);
    fs.writeFileSync(tmp, '');
    try {
      const { allowlist, error } = loadAllowlist(tmp);
      expect(error).toBeNull();
      expect(allowlist).toEqual({});
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('reads + parses valid file', () => {
    const tmp = path.join(os.tmpdir(), `aw-${Date.now()}.json`);
    fs.writeFileSync(tmp, '{"x": 3, "y": "expected-empty"}');
    try {
      const { allowlist, error } = loadAllowlist(tmp);
      expect(error).toBeNull();
      expect(allowlist).toEqual({ x: 3, y: 'expected-empty' });
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('surfaces parse errors from the file', () => {
    const tmp = path.join(os.tmpdir(), `aw-${Date.now()}.json`);
    fs.writeFileSync(tmp, '{"bad": 1.5}');
    try {
      const { error } = loadAllowlist(tmp);
      expect(error).toContain('non-negative integer');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

describe('computeDiff', () => {
  it('marks zero-delta tables as match', () => {
    const counts: RowCount[] = [
      { table: 'a', sourceCount: 10, targetCount: 10 },
      { table: 'b', sourceCount: 0, targetCount: 0 },
    ];
    const rows = computeDiff(counts, {});
    expect(rows[0].status).toBe('match');
    expect(rows[0].delta).toBe(0);
    expect(rows[1].status).toBe('match');
  });

  it('marks expected-empty allowlist hits when target is 0', () => {
    const counts: RowCount[] = [
      { table: 'feature_flags', sourceCount: 12, targetCount: 0 },
    ];
    const rows = computeDiff(counts, { feature_flags: 'expected-empty' });
    expect(rows[0].status).toBe('expected-empty');
    expect(rows[0].allowlistApplied).toBe('expected-empty');
  });

  it('does NOT apply expected-empty when target is non-zero', () => {
    const counts: RowCount[] = [
      { table: 'feature_flags', sourceCount: 12, targetCount: 3 },
    ];
    const rows = computeDiff(counts, { feature_flags: 'expected-empty' });
    expect(rows[0].status).toBe('drift');
  });

  it('marks within-allowlist when |delta| ≤ allowed magnitude', () => {
    const counts: RowCount[] = [
      { table: 'events', sourceCount: 100, targetCount: 103 }, // delta +3
      { table: 'events_neg', sourceCount: 100, targetCount: 95 }, // delta -5
    ];
    const rows = computeDiff(counts, { events: 5, events_neg: 5 });
    expect(rows[0].status).toBe('within-allowlist');
    expect(rows[1].status).toBe('within-allowlist');
  });

  it('marks drift when |delta| > allowed magnitude', () => {
    const counts: RowCount[] = [
      { table: 'events', sourceCount: 100, targetCount: 200 }, // delta +100
    ];
    const rows = computeDiff(counts, { events: 5 });
    expect(rows[0].status).toBe('drift');
    expect(rows[0].delta).toBe(100);
    expect(rows[0].absDelta).toBe(100);
  });

  it('marks drift for unallowlisted non-zero delta', () => {
    const counts: RowCount[] = [
      { table: 'orphans', sourceCount: 5, targetCount: 7 },
    ];
    const rows = computeDiff(counts, {});
    expect(rows[0].status).toBe('drift');
    expect(rows[0].delta).toBe(2);
  });

  it('always reports drift when a table is missing on source', () => {
    const counts: RowCount[] = [
      { table: 'new_table', sourceCount: null, targetCount: 5 },
    ];
    const rows = computeDiff(counts, { new_table: 100 });
    expect(rows[0].status).toBe('drift');
  });

  it('always reports drift when a table is missing on target', () => {
    const counts: RowCount[] = [
      { table: 'dropped_table', sourceCount: 5, targetCount: null },
    ];
    const rows = computeDiff(counts, { dropped_table: 'expected-empty' });
    expect(rows[0].status).toBe('drift');
  });

  it('preserves allowlistApplied when status is match', () => {
    const counts: RowCount[] = [{ table: 'a', sourceCount: 5, targetCount: 5 }];
    const rows = computeDiff(counts, { a: 100 });
    expect(rows[0].status).toBe('match');
    expect(rows[0].allowlistApplied).toBe(100);
  });

  it('handles allowlist of 0 correctly (= behave like absent)', () => {
    // Allowlist value 0 means "0 delta allowed" — equivalent to no entry
    // for delta > 0.
    const counts: RowCount[] = [
      { table: 'a', sourceCount: 10, targetCount: 11 },
    ];
    const rows = computeDiff(counts, { a: 0 });
    expect(rows[0].status).toBe('drift');
  });
});

// ---------------------------------------------------------------------------
// summariseDiff
// ---------------------------------------------------------------------------

describe('summariseDiff', () => {
  it('aggregates each status counter', () => {
    const rows: DiffRow[] = [
      mkDiffRow('a', 1, 1, 'match'),
      mkDiffRow('b', 5, 0, 'expected-empty'),
      mkDiffRow('c', 100, 102, 'within-allowlist'),
      mkDiffRow('d', 50, 1000, 'drift'),
      mkDiffRow('e', 50, 0, 'drift'),
    ];
    expect(summariseDiff(rows)).toEqual({
      matched: 1,
      expectedEmpty: 1,
      withinAllowlist: 1,
      drifted: 2,
      totalTables: 5,
    });
  });

  it('reports zeros for empty input', () => {
    expect(summariseDiff([])).toEqual({
      matched: 0,
      expectedEmpty: 0,
      withinAllowlist: 0,
      drifted: 0,
      totalTables: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// renderMarkdown
// ---------------------------------------------------------------------------

describe('renderMarkdown', () => {
  it('renders header with summary counters', () => {
    const rows: DiffRow[] = [mkDiffRow('a', 1, 1, 'match')];
    const md = renderMarkdown(rows, 'prod', 'staging');
    expect(md).toContain('# DB row-count diff: prod → staging');
    expect(md).toContain('Matched: 1');
    expect(md).toContain('**Drifted: 0**');
  });

  it('renders header columns with source/target labels', () => {
    const md = renderMarkdown([], 'staging', 'prod');
    expect(md).toContain('| staging count | prod count |');
  });

  it('sorts drift rows above matched rows', () => {
    const rows: DiffRow[] = [
      mkDiffRow('zzz_match', 1, 1, 'match'),
      mkDiffRow('aaa_drift', 100, 0, 'drift'),
    ];
    const md = renderMarkdown(rows, 'prod', 'staging');
    const driftIdx = md.indexOf('aaa_drift');
    const matchIdx = md.indexOf('zzz_match');
    expect(driftIdx).toBeGreaterThan(0);
    expect(driftIdx).toBeLessThan(matchIdx);
  });

  it('renders MISSING for null counts', () => {
    const rows: DiffRow[] = [mkDiffRow('vanished', null, 5, 'drift')];
    const md = renderMarkdown(rows, 'prod', 'staging');
    expect(md).toContain('MISSING');
  });

  it('renders + prefix on positive deltas', () => {
    const rows: DiffRow[] = [mkDiffRow('grew', 5, 10, 'drift')];
    const md = renderMarkdown(rows, 'prod', 'staging');
    expect(md).toContain('+5');
  });

  it('renders allowlist column for expected-empty', () => {
    const rows: DiffRow[] = [
      mkDiffRow('flags', 12, 0, 'expected-empty', 'expected-empty'),
    ];
    const md = renderMarkdown(rows, 'prod', 'staging');
    expect(md).toContain('expected-empty');
  });

  it('renders allowlist column for integer threshold', () => {
    const rows: DiffRow[] = [
      mkDiffRow('events', 100, 102, 'within-allowlist', 5),
    ];
    const md = renderMarkdown(rows, 'prod', 'staging');
    expect(md).toContain('±5');
  });
});

// ---------------------------------------------------------------------------
// buildJsonSidecar + sidecarFilename
// ---------------------------------------------------------------------------

describe('buildJsonSidecar', () => {
  it('builds the expected shape', () => {
    const rows: DiffRow[] = [mkDiffRow('a', 1, 1, 'match')];
    const sidecar = buildJsonSidecar({
      rows,
      source: 'prod',
      target: 'staging',
      sourceUrl: 'https://prod.example/',
      targetUrl: 'https://staging.example/',
      generatedAt: '2026-04-29T12:00:00.000Z',
    });
    expect(sidecar).toEqual({
      generatedAt: '2026-04-29T12:00:00.000Z',
      source: 'prod',
      target: 'staging',
      sourceUrl: 'https://prod.example/',
      targetUrl: 'https://staging.example/',
      summary: {
        matched: 1,
        expectedEmpty: 0,
        withinAllowlist: 0,
        drifted: 0,
        totalTables: 1,
      },
      rows,
    });
  });

  it('defaults generatedAt to current time when omitted', () => {
    const sidecar = buildJsonSidecar({
      rows: [],
      source: 'prod',
      target: 'staging',
      sourceUrl: '',
      targetUrl: '',
    });
    expect(sidecar.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('sidecarFilename', () => {
  it('replaces colons and dots with hyphens', () => {
    expect(sidecarFilename('2026-04-29T12:34:56.789Z')).toBe(
      'db-row-count-diff-output-2026-04-29T12-34-56-789Z.json',
    );
  });

  it('produces a Windows-safe filename with no `:` or `.` (besides extension)', () => {
    const fname = sidecarFilename('2026-04-29T12:34:56.789Z');
    const stem = fname.slice(0, -'.json'.length);
    expect(stem).not.toContain(':');
    expect(stem).not.toContain('.');
  });
});

// ---------------------------------------------------------------------------
// resolveCredentials
// ---------------------------------------------------------------------------

describe('resolveCredentials', () => {
  it('prefers SOURCE_/TARGET_ slot variables', () => {
    const env = {
      SOURCE_SUPABASE_URL: 'https://src.example/',
      SOURCE_SUPABASE_SERVICE_ROLE_KEY: 'src-key',
      PROD_SUPABASE_URL: 'https://prod.example/',
      PROD_SUPABASE_SERVICE_ROLE_KEY: 'prod-key',
    };
    expect(resolveCredentials('prod', 'source', env)).toEqual({
      url: 'https://src.example/',
      key: 'src-key',
    });
  });

  it('falls back to PROD_/STAGING_ when slot variables are missing', () => {
    const env = {
      PROD_SUPABASE_URL: 'https://prod.example/',
      PROD_SUPABASE_SERVICE_ROLE_KEY: 'prod-key',
    };
    expect(resolveCredentials('prod', 'source', env)).toEqual({
      url: 'https://prod.example/',
      key: 'prod-key',
    });
  });

  it('uses SUPABASE_URL fallback when ref matches', () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://exampleprodref000000.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
    };
    expect(resolveCredentials('prod', 'source', env)).toEqual({
      url: 'https://exampleprodref000000.supabase.co',
      key: 'k',
    });
  });

  it('does NOT use SUPABASE_URL fallback when ref mismatches', () => {
    // A URL whose project ref does NOT match the requested side's expected ref:
    // a synthetic placeholder ref suffices (the specific value is irrelevant —
    // the assertion is that a non-matching ref yields null/null).
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://exampleprojectref000.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
    };
    expect(resolveCredentials('staging', 'source', env)).toEqual({
      url: null,
      key: null,
    });
  });

  it('returns nulls when nothing matches', () => {
    expect(resolveCredentials('prod', 'source', {})).toEqual({
      url: null,
      key: null,
    });
  });
});

// ---------------------------------------------------------------------------
// fetchTableInventory (mocked via createMockSupabaseClient)
// ---------------------------------------------------------------------------

describe('fetchTableInventory', () => {
  it('returns sorted unique table names from string-array RPC result', async () => {
    const mock = createMockSupabaseClient();
    mock.rpc.mockResolvedValueOnce({
      data: ['users', 'content_items', 'users'],
      error: null,
    });
    const tables = await fetchTableInventory(mock as unknown as SupabaseClient);
    expect(tables).toEqual(['content_items', 'users']);
  });

  it('returns sorted unique table names from object-array RPC result', async () => {
    const mock = createMockSupabaseClient();
    mock.rpc.mockResolvedValueOnce({
      data: [{ tablename: 'b_table' }, { tablename: 'a_table' }],
      error: null,
    });
    const tables = await fetchTableInventory(mock as unknown as SupabaseClient);
    expect(tables).toEqual(['a_table', 'b_table']);
  });

  it('throws when RPC errors with hint to apply migration', async () => {
    const mock = createMockSupabaseClient();
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'function does not exist' },
    });
    await expect(
      fetchTableInventory(mock as unknown as SupabaseClient),
    ).rejects.toThrow(/apply the migration|--tables=/);
  });

  it('throws when RPC returns non-array data', async () => {
    const mock = createMockSupabaseClient();
    mock.rpc.mockResolvedValueOnce({ data: 'not-an-array', error: null });
    await expect(
      fetchTableInventory(mock as unknown as SupabaseClient),
    ).rejects.toThrow(/non-array/);
  });
});

// ---------------------------------------------------------------------------
// countOneTable (mocked, direct)
// ---------------------------------------------------------------------------

describe('countOneTable', () => {
  it('returns count on success', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: 7 }),
    ) as typeof mock._chain.then;
    expect(await countOneTable(mock as unknown as SupabaseClient, 't')).toBe(7);
  });

  it('returns null on relation-not-found (42P01)', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { code: '42P01', message: 'relation gone' },
        count: null,
      }),
    ) as typeof mock._chain.then;
    expect(
      await countOneTable(mock as unknown as SupabaseClient, 'gone'),
    ).toBeNull();
  });

  it('throws on other PG errors', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { code: '42501', message: 'permission denied' },
        count: null,
      }),
    ) as typeof mock._chain.then;
    await expect(
      countOneTable(mock as unknown as SupabaseClient, 't'),
    ).rejects.toThrow(/permission denied/);
  });
});

// ---------------------------------------------------------------------------
// countAllTables (mocked)
// ---------------------------------------------------------------------------

describe('countAllTables', () => {
  it('returns count for each table', async () => {
    const mock = createMockSupabaseClient();
    // Each .from(...).select(..., { count, head: true }) returns the chain;
    // the chain is awaitable and resolves to { count, data, error }.
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: null, error: null, count: 42 }),
    ) as typeof mock._chain.then;
    const out = await countAllTables(
      mock as unknown as SupabaseClient,
      ['t1', 't2'],
      5,
    );
    expect(out).toEqual([
      { table: 't1', count: 42 },
      { table: 't2', count: 42 },
    ]);
  });

  it('returns null count when relation does not exist (42P01)', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { code: '42P01', message: 'no relation' },
        count: null,
      }),
    ) as typeof mock._chain.then;
    const out = await countAllTables(
      mock as unknown as SupabaseClient,
      ['gone'],
      5,
    );
    expect(out).toEqual([{ table: 'gone', count: null }]);
  });

  it('throws on non-relation-not-found errors', async () => {
    const mock = createMockSupabaseClient();
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({
        data: null,
        error: { code: 'XX000', message: 'boom' },
        count: null,
      }),
    ) as typeof mock._chain.then;
    await expect(
      countAllTables(mock as unknown as SupabaseClient, ['t1'], 5),
    ).rejects.toThrow(/boom/);
  });

  it('respects the maxParallel cap', async () => {
    const mock = createMockSupabaseClient();
    let inFlight = 0;
    let maxObservedInFlight = 0;
    mock._chain.then = vi.fn((resolve: (v: unknown) => void) => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      // Yield then resolve so a batch can build up.
      Promise.resolve().then(() => {
        inFlight--;
        resolve({ data: null, error: null, count: 1 });
      });
    }) as typeof mock._chain.then;
    const tables = Array.from({ length: 25 }, (_, i) => `t${i}`);
    await countAllTables(mock as unknown as SupabaseClient, tables, 4);
    expect(maxObservedInFlight).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Exit-code constants are exported (sanity check; downstream CI uses them)
// ---------------------------------------------------------------------------

describe('exit code constants', () => {
  it('matches the spec', () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_DRIFT).toBe(1);
    expect(EXIT_QUERY_FAILED).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkDiffRow(
  table: string,
  sourceCount: number | null,
  targetCount: number | null,
  status: DiffRow['status'],
  allowlistApplied: DiffRow['allowlistApplied'] = null,
): DiffRow {
  const delta = (targetCount ?? 0) - (sourceCount ?? 0);
  return {
    table,
    sourceCount,
    targetCount,
    delta,
    absDelta: Math.abs(delta),
    status,
    allowlistApplied,
  };
}
