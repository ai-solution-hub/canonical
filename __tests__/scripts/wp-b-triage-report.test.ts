import { describe, it, expect, vi } from 'vitest';
import {
  parseArgs,
  todayIsoDate,
  defaultOutputPath,
  csvEscape,
  buildCsvHeader,
  buildCsvRow,
  buildCsv,
  findNullProvenanceRows,
  CSV_COLUMNS,
  PROD_PROJECT_REF,
  type TriageRow,
} from '../../scripts/wp-b-triage-report';

// ---------------------------------------------------------------------------
// CSV_COLUMNS — column order is locked per spec §6.7. If this test fails,
// you have changed a load-bearing contract — see the spec before fixing.
// ---------------------------------------------------------------------------

describe('CSV_COLUMNS', () => {
  it('matches spec §6.7 column order exactly', () => {
    expect(CSV_COLUMNS).toEqual([
      'id',
      'title',
      'source_url',
      'source_file',
      'created_by',
      'created_at',
      'current_classification_model',
      'current_embedding_model',
    ]);
  });

  it('exposes the prod project ref so --env=prod guard can compare', () => {
    expect(PROD_PROJECT_REF).toBe('rovrymhhffssilaftdwd');
  });
});

// ---------------------------------------------------------------------------
// todayIsoDate / defaultOutputPath
// ---------------------------------------------------------------------------

describe('todayIsoDate', () => {
  it('formats UTC year-month-day as YYYY-MM-DD with zero-padding', () => {
    const fixed = new Date(Date.UTC(2026, 3, 5, 12, 0, 0)); // 2026-04-05
    expect(todayIsoDate(fixed)).toBe('2026-04-05');
  });

  it('uses UTC (not local time) so the output filename is deterministic', () => {
    // 2026-04-28 23:30 UTC is still 2026-04-28 in UTC regardless of TZ.
    const fixed = new Date(Date.UTC(2026, 3, 28, 23, 30, 0));
    expect(todayIsoDate(fixed)).toBe('2026-04-28');
  });
});

describe('defaultOutputPath', () => {
  it('produces scripts/output/wp-b-provenance-triage-{date}.csv', () => {
    const fixed = new Date(Date.UTC(2026, 3, 28, 0, 0, 0));
    expect(defaultOutputPath(fixed)).toBe(
      'scripts/output/wp-b-provenance-triage-2026-04-28.csv',
    );
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  const FIXED_DATE = new Date(Date.UTC(2026, 3, 28, 0, 0, 0));

  it('applies sensible defaults — staging env, unlimited rows, dated output', () => {
    const args = parseArgs([], FIXED_DATE);
    expect(args.error).toBeNull();
    expect(args.env).toBe('staging');
    expect(args.limit).toBeNull();
    expect(args.output).toBe(
      'scripts/output/wp-b-provenance-triage-2026-04-28.csv',
    );
  });

  it('parses --output, --limit, and --env=prod (combined flags)', () => {
    const args = parseArgs(
      ['--limit', '50', '--output', '/tmp/out.csv', '--env=prod'],
      FIXED_DATE,
    );
    expect(args.error).toBeNull();
    expect(args.limit).toBe(50);
    expect(args.output).toBe('/tmp/out.csv');
    expect(args.env).toBe('prod');
  });

  it('parses --output=<path> with equals-sign form', () => {
    const args = parseArgs(['--output=/tmp/eq.csv'], FIXED_DATE);
    expect(args.error).toBeNull();
    expect(args.output).toBe('/tmp/eq.csv');
  });

  it('parses --limit=<n> with equals-sign form', () => {
    const args = parseArgs(['--limit=10'], FIXED_DATE);
    expect(args.error).toBeNull();
    expect(args.limit).toBe(10);
  });

  it('parses --env staging (space-separated form)', () => {
    const args = parseArgs(['--env', 'staging'], FIXED_DATE);
    expect(args.error).toBeNull();
    expect(args.env).toBe('staging');
  });

  it('rejects non-numeric --limit', () => {
    const args = parseArgs(['--limit', 'abc'], FIXED_DATE);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('positive integer');
  });

  it('rejects zero or negative --limit', () => {
    const args = parseArgs(['--limit', '0'], FIXED_DATE);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('positive integer');
  });

  it("rejects --env values other than 'staging' or 'prod'", () => {
    const args = parseArgs(['--env=preview'], FIXED_DATE);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('--env');
  });
});

// ---------------------------------------------------------------------------
// csvEscape / buildCsvRow / buildCsv
// ---------------------------------------------------------------------------

describe('csvEscape', () => {
  it('returns empty string for null and undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('returns the value unchanged when no special chars', () => {
    expect(csvEscape('plain')).toBe('plain');
  });

  it('quotes and doubles inner quotes when value contains a double-quote', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes when value contains a comma', () => {
    expect(csvEscape('a, b')).toBe('"a, b"');
  });

  it('quotes when value contains a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('coerces non-string values to string before escaping', () => {
    expect(csvEscape(42)).toBe('42');
  });
});

describe('buildCsvHeader', () => {
  it('emits the locked column header in spec §6.7 order', () => {
    expect(buildCsvHeader()).toBe(
      'id,title,source_url,source_file,created_by,created_at,current_classification_model,current_embedding_model',
    );
  });
});

describe('buildCsvRow', () => {
  const fixture: TriageRow = {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'Sample item',
    source_url: 'https://example.com/page',
    source_file: null,
    created_by: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    created_at: '2026-04-01T12:34:56Z',
    current_classification_model: null,
    current_embedding_model: null,
  };

  it('produces a single CSV line with cells in CSV_COLUMNS order', () => {
    expect(buildCsvRow(fixture)).toBe(
      [
        '11111111-2222-4333-8444-555555555555',
        'Sample item',
        'https://example.com/page',
        '', // source_file is null -> empty
        '99999999-aaaa-4bbb-8ccc-dddddddddddd',
        '2026-04-01T12:34:56Z',
        '', // current_classification_model null -> empty
        '', // current_embedding_model null -> empty
      ].join(','),
    );
  });

  it('escapes a title containing a comma', () => {
    const row = { ...fixture, title: 'A title, with comma' };
    const out = buildCsvRow(row);
    expect(out).toContain('"A title, with comma"');
  });

  it('escapes a title containing double quotes', () => {
    const row = { ...fixture, title: 'Quoted "value"' };
    const out = buildCsvRow(row);
    expect(out).toContain('"Quoted ""value"""');
  });
});

describe('buildCsv', () => {
  it('emits header-only CSV (with trailing newline) when rows are empty', () => {
    const csv = buildCsv([]);
    expect(csv).toBe(
      'id,title,source_url,source_file,created_by,created_at,current_classification_model,current_embedding_model\n',
    );
    // Body line count: split-1 (trailing newline) -> 0 body rows.
    const lines = csv.split('\n');
    expect(lines[0]).toBe(buildCsvHeader());
    expect(lines.filter((l) => l.length > 0)).toHaveLength(1);
  });

  it('emits header + N body rows in order', () => {
    const rows: TriageRow[] = [
      {
        id: 'a',
        title: 'A',
        source_url: null,
        source_file: null,
        created_by: null,
        created_at: '2026-04-01T00:00:00Z',
        current_classification_model: null,
        current_embedding_model: null,
      },
      {
        id: 'b',
        title: 'B',
        source_url: null,
        source_file: null,
        created_by: null,
        created_at: '2026-04-02T00:00:00Z',
        current_classification_model: null,
        current_embedding_model: null,
      },
    ];
    const csv = buildCsv(rows);
    const lines = csv.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1].startsWith('a,A,')).toBe(true);
    expect(lines[2].startsWith('b,B,')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findNullProvenanceRows — verify the candidate-query shape against a mock.
// Read-only — no real DB. Records each chained call so we can assert against
// the exact builder shape required by spec §6.7.
// ---------------------------------------------------------------------------

interface MockRow {
  [key: string]: unknown;
}

interface ChainCallLog {
  table: string | null;
  selectArgs: string[];
  filterCalls: Array<[string, string, unknown]>;
  orderCalls: Array<[string, unknown]>;
  limitCalls: number[];
}

function makeMockSupabase(rows: MockRow[], err: Error | null = null) {
  const log: ChainCallLog = {
    table: null,
    selectArgs: [],
    filterCalls: [],
    orderCalls: [],
    limitCalls: [],
  };

  const resolved = Promise.resolve({
    data: rows,
    error: err,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: vi.fn((cols: string) => {
      log.selectArgs.push(cols);
      return chain;
    }),
    filter: vi.fn((col: string, op: string, val: unknown) => {
      log.filterCalls.push([col, op, val]);
      return chain;
    }),
    order: vi.fn((col: string, opts: unknown) => {
      log.orderCalls.push([col, opts]);
      return chain;
    }),
    limit: vi.fn((n: number) => {
      log.limitCalls.push(n);
      return chain;
    }),
    then: resolved.then.bind(resolved),
    catch: resolved.catch.bind(resolved),
    finally: resolved.finally.bind(resolved),
  };

  const supabase = {
    from: vi.fn((table: string) => {
      log.table = table;
      return chain;
    }),
  };

  return { supabase, log };
}

describe('findNullProvenanceRows', () => {
  it("builds the candidate query: from(content_items) → filter(metadata->>ingestion_source, 'is', null) → order(created_at ASC)", async () => {
    const { supabase, log } = makeMockSupabase([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await findNullProvenanceRows(supabase as any, null);

    expect(log.table).toBe('content_items');
    // Spec §6.7 columns + the source-of-truth `classification_model` /
    // `embedding_model` (renamed in TS to current_*). Verify the select
    // contains every column the spec requires.
    expect(log.selectArgs).toHaveLength(1);
    const select = log.selectArgs[0];
    expect(select).toContain('id');
    expect(select).toContain('title');
    expect(select).toContain('source_url');
    expect(select).toContain('source_file');
    expect(select).toContain('created_by');
    expect(select).toContain('created_at');
    expect(select).toContain('classification_model');
    expect(select).toContain('embedding_model');

    // NULL-provenance filter — spec §6.7 + plan §4.1 candidate query.
    // Use .filter() (canonical PostgREST form) for JSONB path operands;
    // .is(jsonb-path, null) has no live-DB-verified prior art in the
    // codebase. WP3 verifier M-finding.
    expect(log.filterCalls).toEqual([
      ['metadata->>ingestion_source', 'is', null],
    ]);

    // Sort: created_at ASC.
    expect(log.orderCalls).toEqual([['created_at', { ascending: true }]]);

    // Unlimited — `null` limit -> .limit() not called.
    expect(log.limitCalls).toEqual([]);
  });

  it('passes --limit through to .limit() when set', async () => {
    const { supabase, log } = makeMockSupabase([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await findNullProvenanceRows(supabase as any, 50);

    expect(log.limitCalls).toEqual([50]);
  });

  it('renames classification_model/embedding_model to current_* in returned rows', async () => {
    const { supabase } = makeMockSupabase([
      {
        id: 'item-1',
        title: 'Title 1',
        source_url: 'https://example.com',
        source_file: null,
        created_by: 'user-1',
        created_at: '2026-04-01T00:00:00Z',
        classification_model: 'claude-sonnet-4-6',
        embedding_model: 'text-embedding-3-large',
      },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findNullProvenanceRows(supabase as any, null);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'item-1',
      title: 'Title 1',
      source_url: 'https://example.com',
      source_file: null,
      created_by: 'user-1',
      created_at: '2026-04-01T00:00:00Z',
      current_classification_model: 'claude-sonnet-4-6',
      current_embedding_model: 'text-embedding-3-large',
    });
  });

  it('emits empty array (header-only CSV path) when DB returns 0 rows', async () => {
    const { supabase } = makeMockSupabase([]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findNullProvenanceRows(supabase as any, null);
    expect(result).toEqual([]);

    // Confirm the empty result feeds buildCsv to produce header-only CSV.
    const csv = buildCsv(result);
    expect(csv).toBe(`${buildCsvHeader()}\n`);
  });

  it('throws a descriptive error when the query fails', async () => {
    const { supabase } = makeMockSupabase([], new Error('connection refused'));

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findNullProvenanceRows(supabase as any, null),
    ).rejects.toThrow(/content_items/);
  });
});
