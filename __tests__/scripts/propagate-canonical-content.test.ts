import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  propagateTableToTarget,
  propagateAllToTarget,
  conflictColumns,
  canonicalChecksum,
  readCatalog,
  resolveTargets,
  parseArgs,
  type PropagationClient,
  type PropagationLogEvent,
} from '../../scripts/propagate-canonical-content';
import { PAYLOAD_CONTRACT } from '../../scripts/propagation/payload-contract';

/**
 * Unit tests for the PI-18 canonical-content propagation worker (ID-95 {95.13}).
 *
 * Mock-only (no live DB). Both source and target are driven by a small chainable
 * test double that records every `from(table).<verb>(...)` call so we can assert
 * the one-way invariant (source never written), the FK-dependency order, fkRemap
 * resolution, onConflict columns, tombstone-vs-mass-delete, the version ledger,
 * reference_items skip-loud, and --dry-run.
 *
 * Spec: scripts/propagation/payload-contract.ts + PLAN.md §D-2.
 * Test philosophy: behaviour, not implementation.
 */

// ---------------------------------------------------------------------------
// Recording chainable double. Resolves a queue of responses keyed by an ordered
// list; each terminal await pops the next queued response for its table.
// ---------------------------------------------------------------------------
interface Call {
  table: string;
  verb: string;
  args: unknown[];
}

type Response = { data: unknown; error: unknown; count?: number | null };

function makeRecordingClient(opts?: {
  /** Map of table -> array of select() responses (consumed in order). */
  selects?: Record<string, Response[]>;
  /** Map of table -> array of delete-chain terminal responses. */
  deletes?: Record<string, Response[]>;
  /** Default terminal response when nothing queued. */
  fallback?: Response;
}): PropagationClient & { calls: Call[] } {
  const calls: Call[] = [];
  const selects = opts?.selects ?? {};
  const deletes = opts?.deletes ?? {};
  const fallback: Response = opts?.fallback ?? {
    data: [],
    error: null,
    count: 0,
  };

  function builder(table: string) {
    // Track which terminal kind this chain represents so `then` returns the
    // right queued response.
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
          res = selects[table].shift() as Response;
        } else if (kind === 'delete' && deletes[table]?.length) {
          res = deletes[table].shift() as Response;
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

const DOMAINS = PAYLOAD_CONTRACT.find((c) => c.table === 'taxonomy_domains')!;
const SUBTOPICS = PAYLOAD_CONTRACT.find(
  (c) => c.table === 'taxonomy_subtopics',
)!;
const LAYER_VOCAB = PAYLOAD_CONTRACT.find(
  (c) => c.table === 'layer_vocabulary',
)!;
const REQUIREMENTS = PAYLOAD_CONTRACT.find(
  (c) => c.table === 'form_template_requirements',
)!;
const REFERENCE_ITEMS = PAYLOAD_CONTRACT.find(
  (c) => c.table === 'reference_items',
)!;

describe('conflictColumns', () => {
  it('returns the stableKey alone for tables with no fkRemap', () => {
    expect(conflictColumns(DOMAINS)).toEqual(['name']);
    expect(conflictColumns(LAYER_VOCAB)).toEqual(['key']);
  });

  it('unions the fkRemap FK column with the stableKey for taxonomy_subtopics', () => {
    // (domain_id, name) = the DB UNIQUE constraint taxonomy_subtopics_domain_id_name_key
    expect(conflictColumns(SUBTOPICS)).toEqual(['domain_id', 'name']);
  });

  it('uses the full composite section tuple for form_template_requirements', () => {
    expect(conflictColumns(REQUIREMENTS)).toEqual([
      'template_name',
      'template_version',
      'section_ref',
      'question_number',
    ]);
  });
});

describe('canonicalChecksum', () => {
  it('is invariant to row order and column order', () => {
    const a = canonicalChecksum(
      [
        { name: 'b', extra: 2 },
        { name: 'a', extra: 1 },
      ],
      ['name'],
    );
    const b = canonicalChecksum(
      [
        { extra: 1, name: 'a' },
        { extra: 2, name: 'b' },
      ],
      ['name'],
    );
    expect(a).toBe(b);
  });

  it('changes when payload content changes', () => {
    const a = canonicalChecksum([{ name: 'a', v: 1 }], ['name']);
    const b = canonicalChecksum([{ name: 'a', v: 2 }], ['name']);
    expect(a).not.toBe(b);
  });
});

describe('propagateTableToTarget — one-way & ordering', () => {
  it('reads from the source with select only — never writes to the source', async () => {
    const source = makeRecordingClient({
      selects: {
        taxonomy_domains: [
          { data: [{ id: 's1', name: 'Procurement' }], error: null },
        ],
      },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    await propagateTableToTarget(source, target, DOMAINS, {
      dryRun: false,
      log,
    });

    // The source client must only ever be called with `select`.
    const sourceVerbs = new Set(source.calls.map((c) => c.verb));
    expect(sourceVerbs.has('upsert')).toBe(false);
    expect(sourceVerbs.has('delete')).toBe(false);
    expect([...sourceVerbs]).toEqual(['select']);
  });

  it('upserts into the target on the contract conflict columns', async () => {
    const source = makeRecordingClient({
      selects: {
        layer_vocabulary: [
          { data: [{ id: 's1', key: 'risk', label: 'Risk' }], error: null },
        ],
      },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    await propagateTableToTarget(source, target, LAYER_VOCAB, {
      dryRun: false,
      log,
    });

    const upsert = target.calls.find((c) => c.verb === 'upsert');
    expect(upsert).toBeDefined();
    expect((upsert!.args[1] as { onConflict: string }).onConflict).toBe('key');
  });
});

describe('propagateTableToTarget — taxonomy_subtopics fkRemap', () => {
  it('bridges domain_id source-uuid -> domain name -> target-uuid before upsert', async () => {
    // The source subtopic carries a SOURCE-side domain_id uuid. Resolution
    // bridges it through the domain natural key (`name`): the SOURCE domains
    // table maps source-uuid -> name, the TARGET domains table maps name ->
    // target-uuid. The two uuids differ per DB — that is the whole point.
    const source = makeRecordingClient({
      selects: {
        taxonomy_subtopics: [
          {
            data: [
              {
                id: 'src-sub',
                name: 'Bid Writing',
                domain_id: 'SRC-DOMAIN-UUID',
              },
            ],
            error: null,
          },
        ],
        // Source domains: source-uuid -> natural key.
        taxonomy_domains: [
          {
            data: [{ id: 'SRC-DOMAIN-UUID', name: 'Procurement' }],
            error: null,
          },
        ],
      },
    });
    const target = makeRecordingClient({
      selects: {
        // Target domains: natural key -> target-uuid (different uuid).
        taxonomy_domains: [
          {
            data: [{ id: 'TARGET-DOMAIN-UUID', name: 'Procurement' }],
            error: null,
          },
        ],
      },
    });
    const { log } = collectLog();

    await propagateTableToTarget(source, target, SUBTOPICS, {
      dryRun: false,
      log,
    });

    const upsert = target.calls.find((c) => c.verb === 'upsert');
    expect(upsert).toBeDefined();
    const rows = upsert!.args[0] as Array<Record<string, unknown>>;
    // The resolved TARGET domain uuid must replace the source domain_id.
    expect(rows[0].domain_id).toBe('TARGET-DOMAIN-UUID');
    expect((upsert!.args[1] as { onConflict: string }).onConflict).toBe(
      'domain_id,name',
    );
  });

  it('fails loud when the referenced target domain is missing', async () => {
    const source = makeRecordingClient({
      selects: {
        taxonomy_subtopics: [
          {
            data: [
              { id: 'src-sub', name: 'Unknown', domain_id: 'SRC-DOMAIN-UUID' },
            ],
            error: null,
          },
        ],
        taxonomy_domains: [
          {
            data: [{ id: 'SRC-DOMAIN-UUID', name: 'Procurement' }],
            error: null,
          },
        ],
      },
    });
    const target = makeRecordingClient({
      selects: {
        taxonomy_domains: [{ data: [], error: null }], // no matching target domain
      },
    });
    const { log } = collectLog();

    await expect(
      propagateTableToTarget(source, target, SUBTOPICS, { dryRun: false, log }),
    ).rejects.toThrow(/fkRemap failed/);

    // Must NOT have attempted an upsert with a dangling FK.
    expect(target.calls.find((c) => c.verb === 'upsert')).toBeUndefined();
  });
});

describe('propagateTableToTarget — tombstone', () => {
  it('deletes target rows absent from the source active set', async () => {
    const source = makeRecordingClient({
      selects: {
        taxonomy_domains: [
          {
            data: [
              { id: 's1', name: 'Procurement' },
              { id: 's2', name: 'Sales' },
            ],
            error: null,
          },
        ],
      },
    });
    const target = makeRecordingClient({
      deletes: {
        // delete().not(...) resolves with the deleted rows.
        taxonomy_domains: [
          { data: [{ id: 't9', name: 'Obsolete' }], error: null },
        ],
      },
    });
    const { log } = collectLog();

    const result = await propagateTableToTarget(source, target, DOMAINS, {
      dryRun: false,
      log,
    });

    const del = target.calls.find((c) => c.verb === 'delete');
    expect(del).toBeDefined();
    const not = target.calls.find((c) => c.verb === 'not');
    expect(not).toBeDefined();
    // The NOT-IN list must reference the source active key column.
    expect(not!.args[0]).toBe('name');
    expect(result.deleted).toBe(1);
  });

  it('does NOT mass-delete when the source fetch returned empty', async () => {
    const source = makeRecordingClient({
      selects: {
        // Source genuinely empty (fetch succeeded with zero rows).
        taxonomy_domains: [{ data: [], error: null }],
      },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    const result = await propagateTableToTarget(source, target, DOMAINS, {
      dryRun: false,
      log,
    });

    expect(target.calls.find((c) => c.verb === 'delete')).toBeUndefined();
    expect(result.deleted).toBe(0);
  });

  it('fails loud (no delete) when the source fetch errored', async () => {
    const source = makeRecordingClient({
      selects: {
        taxonomy_domains: [
          { data: null, error: { message: 'connection reset' } },
        ],
      },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    await expect(
      propagateTableToTarget(source, target, DOMAINS, { dryRun: false, log }),
    ).rejects.toThrow(/Source fetch failed/);
    expect(target.calls.find((c) => c.verb === 'delete')).toBeUndefined();
    expect(target.calls.find((c) => c.verb === 'upsert')).toBeUndefined();
  });
});

describe('propagateTableToTarget — version ledger', () => {
  it('upserts content_propagation_version with a checksum, keyed on payload_key', async () => {
    const source = makeRecordingClient({
      selects: {
        layer_vocabulary: [{ data: [{ id: 's1', key: 'risk' }], error: null }],
      },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    await propagateTableToTarget(source, target, LAYER_VOCAB, {
      dryRun: false,
      log,
    });

    const versionUpsert = target.calls.find(
      (c) => c.table === 'content_propagation_version' && c.verb === 'upsert',
    );
    expect(versionUpsert).toBeDefined();
    const row = versionUpsert!.args[0] as Record<string, unknown>;
    expect(row.payload_key).toBe('layer_vocabulary');
    expect(typeof row.payload_checksum).toBe('string');
    expect((row.payload_checksum as string).length).toBeGreaterThan(0);
    expect((versionUpsert!.args[1] as { onConflict: string }).onConflict).toBe(
      'payload_key',
    );
  });
});

describe('propagateTableToTarget — reference_items skip-loud', () => {
  it('emits a warn and writes nothing for reference_items', async () => {
    const source = makeRecordingClient();
    const target = makeRecordingClient();
    const { log, events } = collectLog();

    const result = await propagateTableToTarget(
      source,
      target,
      REFERENCE_ITEMS,
      {
        dryRun: false,
        log,
      },
    );

    expect(result.skipped).toBe(true);
    const warn = events.find(
      (e) =>
        e.level === 'warn' &&
        /reference_items propagation deferred/.test(e.msg),
    );
    expect(warn).toBeDefined();
    // No reads or writes attempted at all for reference_items.
    expect(source.calls).toHaveLength(0);
    expect(target.calls).toHaveLength(0);
  });
});

describe('propagateTableToTarget — dry-run', () => {
  it('writes nothing in dry-run mode', async () => {
    const source = makeRecordingClient({
      selects: {
        taxonomy_domains: [
          { data: [{ id: 's1', name: 'Procurement' }], error: null },
        ],
      },
    });
    const target = makeRecordingClient();
    const { log, events } = collectLog();

    await propagateTableToTarget(source, target, DOMAINS, {
      dryRun: true,
      log,
    });

    expect(target.calls.find((c) => c.verb === 'upsert')).toBeUndefined();
    expect(target.calls.find((c) => c.verb === 'delete')).toBeUndefined();
    expect(
      events.some((e) => e.level === 'info' && /\[dry-run\]/.test(e.msg)),
    ).toBe(true);
  });
});

describe('propagateAllToTarget — FK-dependency order', () => {
  it('iterates the contract in order: taxonomy_domains before taxonomy_subtopics', async () => {
    const source = makeRecordingClient({
      // Empty sources everywhere -> upsert skipped, tombstone guarded, version
      // still recorded; we only assert ORDER of source reads here.
      fallback: { data: [], error: null, count: 0 },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    await propagateAllToTarget(source, target, 'client-ref-x', {
      dryRun: false,
      log,
    });

    const sourceSelectOrder = source.calls
      .filter((c) => c.verb === 'select')
      .map((c) => c.table);
    const domainsIdx = sourceSelectOrder.indexOf('taxonomy_domains');
    const subtopicsIdx = sourceSelectOrder.indexOf('taxonomy_subtopics');
    expect(domainsIdx).toBeGreaterThanOrEqual(0);
    expect(subtopicsIdx).toBeGreaterThan(domainsIdx);

    // reference_items must be skipped-loud: it is iterated but never read.
    expect(sourceSelectOrder).not.toContain('reference_items');
  });

  it('reports ok=false and surfaces the error when a target table fails loud', async () => {
    const source = makeRecordingClient({
      selects: {
        taxonomy_domains: [{ data: null, error: { message: 'boom' } }],
      },
      fallback: { data: [], error: null, count: 0 },
    });
    const target = makeRecordingClient();
    const { log } = collectLog();

    const result = await propagateAllToTarget(source, target, 'client-ref-y', {
      dryRun: false,
      log,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Source fetch failed/);
  });
});

describe('catalog & CLI parsing', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parseArgs picks defaults and reads --dry-run', () => {
    const args = parseArgs(['--source-url', 'http://s', '--dry-run']);
    expect(args.sourceUrl).toBe('http://s');
    expect(args.dryRun).toBe(true);
    expect(args.targetsPath).toBe('scripts/.propagation-catalog.json');
  });

  it('resolveTargets prefers an explicit --target-url/--target-key pair', () => {
    const targets = resolveTargets({
      targetsPath: 'scripts/.propagation-catalog.json',
      targetUrl: 'https://abcdef.supabase.co',
      targetKey: 'svc-key',
      dryRun: false,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].url).toBe('https://abcdef.supabase.co');
    expect(targets[0].serviceRoleKey).toBe('svc-key');
  });

  it('readCatalog parses a valid array and rejects a malformed catalog', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prop-catalog-'));
    const okPath = join(dir, 'ok.json');
    const badPath = join(dir, 'bad.json');
    writeFileSync(
      okPath,
      JSON.stringify([
        { ref: 'c1', url: 'https://c1.co', serviceRoleKey: 'k' },
      ]),
    );
    writeFileSync(badPath, JSON.stringify({ not: 'array' }));

    const parsed = readCatalog(okPath);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      ref: 'c1',
      url: 'https://c1.co',
      serviceRoleKey: 'k',
    });

    expect(() => readCatalog(badPath)).toThrow(/must be a JSON array/);
  });
});
