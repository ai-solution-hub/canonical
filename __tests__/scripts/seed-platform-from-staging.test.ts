import { describe, it, expect } from 'vitest';
import {
  parseSeedArgs,
  resolveSeedConfig,
  runSeed,
  PLATFORM_TARGET_REF,
  type SeedClientFactory,
  type EnvLike,
} from '../../scripts/seed-platform-from-staging';
import {
  PAYLOAD_CONTRACT,
  type PayloadTableContract,
} from '../../scripts/propagation/payload-contract';
import type {
  PropagationClient,
  PropagationLogEvent,
} from '../../scripts/propagate-canonical-content';

/**
 * Unit tests for the staging->platform canonical-data SEED wrapper
 * (Q2 seed-data, recommended ledger home {108.1}).
 *
 * The wrapper is a THIN, direction-LOCKED invocation of the existing {95.13}
 * worker (`scripts/propagate-canonical-content.ts`). These tests assert the
 * wrapper's own contract — direction lock, dry-run default / explicit --apply,
 * fail-loud on missing creds, and that a dry-run delegates the WHOLE
 * PAYLOAD_CONTRACT producing a 6-table upsert plan + reference_items SKIP + 0
 * tombstone-deletes — WITHOUT touching a live DB. The worker's own per-table
 * mechanics are already covered by propagate-canonical-content.test.ts.
 *
 * Mock-only: a small chainable double stands in for BOTH source and target so
 * the one-way invariant (source never written) and the direction lock (source =
 * staging url/key, target = platform url/key) are assertable.
 *
 * Test philosophy: behaviour, not implementation.
 */

// ---------------------------------------------------------------------------
// Recording chainable double (mirrors propagate-canonical-content.test.ts).
// Each terminal await pops the next queued select response for its table, else
// returns the fallback. Records every from(table).<verb>(...) call.
// ---------------------------------------------------------------------------
interface Call {
  table: string;
  verb: string;
  args: unknown[];
}

type Response = { data: unknown; error: unknown; count?: number | null };

function makeRecordingClient(opts?: {
  selects?: Record<string, Response[]>;
  fallback?: Response;
}): PropagationClient & { calls: Call[] } {
  const calls: Call[] = [];
  const selects = opts?.selects ?? {};
  const fallback: Response = opts?.fallback ?? {
    data: [],
    error: null,
    count: 0,
  };

  function builder(table: string) {
    let kind: 'select' | 'delete' | 'upsert' | null = null;
    const chain = {
      select(columns?: string) {
        kind = 'select';
        calls.push({ table, verb: 'select', args: [columns] });
        return chain;
      },
      upsert(values: unknown, options?: unknown) {
        kind = 'upsert';
        calls.push({ table, verb: 'upsert', args: [values, options] });
        return chain;
      },
      delete() {
        kind = 'delete';
        calls.push({ table, verb: 'delete', args: [] });
        return chain;
      },
      in(column: string, values: readonly unknown[]) {
        calls.push({ table, verb: 'in', args: [column, values] });
        return chain;
      },
      not(column: string, operator: string, value: unknown) {
        calls.push({ table, verb: 'not', args: [column, operator, value] });
        return chain;
      },
      then<TResult>(
        onfulfilled: (value: Response) => TResult,
      ): Promise<TResult> {
        let res: Response;
        if (kind === 'select' && selects[table]?.length) {
          // Sticky: keep the LAST queued response so repeated selects of the
          // same table (e.g. the fkRemap bridge re-reading taxonomy_domains
          // AFTER that table's own propagation step) still resolve rows.
          res =
            selects[table].length > 1
              ? (selects[table].shift() as Response)
              : (selects[table][0] as Response);
        } else {
          res = fallback;
        }
        return Promise.resolve(onfulfilled(res));
      },
    };
    return chain as unknown as ReturnType<PropagationClient['from']>;
  }

  return { from: (table: string) => builder(table), calls };
}

function collectLog() {
  const events: PropagationLogEvent[] = [];
  return { log: (e: PropagationLogEvent) => events.push(e), events };
}

/** Non-reference_items contract tables — the 6 the seed should upsert. */
const SEEDED_TABLES: PayloadTableContract[] = PAYLOAD_CONTRACT.filter(
  (c) => c.table !== 'reference_items',
);

const STAGING_URL = 'https://examplestagingref000.supabase.co';
const STAGING_KEY = 'staging-service-role-key';
const PLATFORM_URL = 'https://zjqbrdctesqvouboziae.supabase.co';
const PLATFORM_KEY = 'platform-service-role-key';

function fullEnv(): EnvLike {
  return {
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY,
    KH_PLATFORM_URL: PLATFORM_URL,
    KH_PLATFORM_SECRET_KEY: PLATFORM_KEY,
  };
}

describe('parseSeedArgs — dry-run is the SAFE default', () => {
  it('defaults to dry-run when --apply is absent', () => {
    expect(parseSeedArgs([]).dryRun).toBe(true);
    expect(parseSeedArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('only performs a live run when --apply is given explicitly', () => {
    expect(parseSeedArgs(['--apply']).dryRun).toBe(false);
  });

  it('--dry-run wins over --apply (refuses to live-run on an ambiguous invocation)', () => {
    expect(parseSeedArgs(['--apply', '--dry-run']).dryRun).toBe(true);
  });
});

describe('resolveSeedConfig — direction is LOCKED staging -> platform', () => {
  it('reads source from staging env and target from platform env', () => {
    const cfg = resolveSeedConfig(fullEnv());
    expect(cfg.source.url).toBe(STAGING_URL);
    expect(cfg.source.serviceRoleKey).toBe(STAGING_KEY);
    expect(cfg.target.url).toBe(PLATFORM_URL);
    expect(cfg.target.serviceRoleKey).toBe(PLATFORM_KEY);
    expect(cfg.target.ref).toBe(PLATFORM_TARGET_REF);
  });

  it('fails loud when the staging source URL env is missing', () => {
    const env = fullEnv();
    delete env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => resolveSeedConfig(env)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('fails loud when the staging source key env is missing', () => {
    const env = fullEnv();
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => resolveSeedConfig(env)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('fails loud when the platform target URL env is missing', () => {
    const env = fullEnv();
    delete env.KH_PLATFORM_URL;
    expect(() => resolveSeedConfig(env)).toThrow(/KH_PLATFORM_URL/);
  });

  it('fails loud when the platform target key env is missing', () => {
    const env = fullEnv();
    delete env.KH_PLATFORM_SECRET_KEY;
    expect(() => resolveSeedConfig(env)).toThrow(/KH_PLATFORM_SECRET_KEY/);
  });
});

describe('runSeed — dry-run plan over the full PAYLOAD_CONTRACT', () => {
  it('plans a 6-table upsert set with reference_items SKIP and 0 tombstone-deletes', async () => {
    // Each canonical source table returns one row so the dry-run reports a
    // would-upsert; reference_items is skip-loud before any read.
    const selects: Record<string, Response[]> = {};
    for (const c of SEEDED_TABLES) {
      // taxonomy_subtopics needs a resolvable domain on BOTH sides for fkRemap,
      // but in DRY-RUN fkRemap still resolves before the plan log, so supply a
      // domain row keyed by name on both source and target.
      selects[c.table] = [{ data: [seedRow(c)], error: null }];
    }
    // Domain rows for the subtopics fkRemap bridge (source uuid -> name).
    selects.taxonomy_domains = [
      { data: [{ id: 'src-domain', name: 'Procurement' }], error: null },
    ];

    const source = makeRecordingClient({ selects });
    const target = makeRecordingClient({
      selects: {
        // Target-side domain lookup for the fkRemap (name -> target uuid).
        taxonomy_domains: [
          { data: [{ id: 'tgt-domain', name: 'Procurement' }], error: null },
        ],
      },
    });
    const factory = lockedFactory(source, target);
    const { log, events } = collectLog();

    const result = await runSeed({
      config: resolveSeedConfig(fullEnv()),
      dryRun: true,
      clientFactory: factory,
      log,
    });

    expect(result.ok).toBe(true);

    // 6 tables planned for upsert, reference_items skipped.
    const planned = result.tables.filter((t) => !t.skipped);
    const skipped = result.tables.filter((t) => t.skipped);
    expect(planned).toHaveLength(SEEDED_TABLES.length); // 6
    expect(planned).toHaveLength(6);
    expect(skipped.map((t) => t.table)).toEqual(['reference_items']);

    // Dry-run: ZERO live tombstone-deletes and ZERO live upserts on the target.
    expect(result.tables.every((t) => t.deleted === 0)).toBe(true);
    expect(target.calls.some((c) => c.verb === 'delete')).toBe(false);
    expect(target.calls.some((c) => c.verb === 'upsert')).toBe(false);

    // reference_items emitted a skip-loud warn and was never read.
    expect(
      events.some(
        (e) =>
          e.level === 'warn' &&
          /reference_items propagation deferred/.test(e.msg),
      ),
    ).toBe(true);
    expect(source.calls.some((c) => c.table === 'reference_items')).toBe(false);
  });

  it('locks direction: source client built from staging creds, target from platform creds', async () => {
    const source = makeRecordingClient({ fallback: { data: [], error: null } });
    const target = makeRecordingClient({ fallback: { data: [], error: null } });
    const seen: Array<{ url: string; key: string }> = [];
    const factory: SeedClientFactory = (url, key) => {
      seen.push({ url, key });
      // First call = source (staging), second = target (platform), by lock order.
      return seen.length === 1 ? source : target;
    };
    const { log } = collectLog();

    await runSeed({
      config: resolveSeedConfig(fullEnv()),
      dryRun: true,
      clientFactory: factory,
      log,
    });

    expect(seen[0]).toEqual({ url: STAGING_URL, key: STAGING_KEY });
    expect(seen[1]).toEqual({ url: PLATFORM_URL, key: PLATFORM_KEY });
  });

  it('never writes the source (staging) — one-way invariant preserved', async () => {
    const selects: Record<string, Response[]> = {};
    for (const c of SEEDED_TABLES) {
      selects[c.table] = [{ data: [seedRow(c)], error: null }];
    }
    selects.taxonomy_domains = [
      { data: [{ id: 'src-domain', name: 'Procurement' }], error: null },
    ];
    const source = makeRecordingClient({ selects });
    const target = makeRecordingClient({
      selects: {
        taxonomy_domains: [
          { data: [{ id: 'tgt-domain', name: 'Procurement' }], error: null },
        ],
      },
    });
    const { log } = collectLog();

    await runSeed({
      config: resolveSeedConfig(fullEnv()),
      dryRun: true,
      clientFactory: lockedFactory(source, target),
      log,
    });

    const sourceVerbs = new Set(source.calls.map((c) => c.verb));
    expect(sourceVerbs.has('upsert')).toBe(false);
    expect(sourceVerbs.has('delete')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal source row carrying the table's stableKey + any fkRemap column. */
function seedRow(c: PayloadTableContract): Record<string, unknown> {
  const row: Record<string, unknown> = { id: `src-${c.table}` };
  for (const k of c.stableKey) row[k] = `${k}-value`;
  if (c.fkRemap) row[c.fkRemap.column] = 'src-domain';
  return row;
}

/** Returns source for the first call (staging) and target for the second (platform). */
function lockedFactory(
  source: PropagationClient,
  target: PropagationClient,
): SeedClientFactory {
  let n = 0;
  return () => (n++ === 0 ? source : target);
}
