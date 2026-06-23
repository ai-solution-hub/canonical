/**
 * Unit tests for `e2e/fixtures/admin-dedup-fixture-helpers.ts`.
 *
 * All tests use a mocked Supabase client (`createMockSupabaseClient()`).
 * No live DB writes occur — live smoke validation happens in CI via the
 * Playwright fixture + globalSetup `verifySeededPairs` gate.
 *
 * Coverage:
 *   - generateRunId format + collision resistance
 *   - seedAdminDedupFixtures shape, tagging, FK-correct payload columns,
 *     inline embedding write per decision §9.5
 *   - cleanupAdminDedupFixtures FK-safe order
 *   - cleanupAllAdminDedupFixtures broadens filter to "any run-id"
 *   - sweepOrphanFixtures applies time-window predicate
 *   - verifySeededPairs RPC call shape + missing-pair failure
 *
 * Reference: `docs/audits/s213b-admin-dedup-fixtures-design.md` §1.1, §1.2, §5.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  cleanupAdminDedupFixtures,
  cleanupAllAdminDedupFixtures,
  generateRunId,
  seedAdminDedupFixtures,
  sweepOrphanFixtures,
  verifySeededPairs,
  type AdminDedupFixtureData,
} from '@/e2e/fixtures/admin-dedup-fixture-helpers';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = '00000000-0000-4000-8000-00000000a001';

/**
 * Cast the partial mock client to the Supabase client interface the helpers
 * expect. The mock implements the chain methods + `.rpc` + `.from` that the
 * helpers call — sufficient for unit tests, narrower than the full
 * SupabaseClient surface.
 */
function asClient(mock: MockSupabaseClient): SupabaseClient {
  return mock as unknown as SupabaseClient;
}

/**
 * Configure the mock so:
 *   1. The admin user_roles lookup returns ADMIN_USER_ID.
 *   2. The pre-sweep cleanup finds no rows (idempotent re-seed).
 *   3. Both inserts return the configured rows.
 */
function configureSeedHappyPath(
  mock: MockSupabaseClient,
  opts: {
    queueRowCount: number;
    nearDupRowCount: number;
    queueIdsBySlot: Map<string, string>;
    nearDupIdsBySlot: Map<string, string>;
  },
): void {
  // 1. user_roles admin lookup.
  mock._chain.single.mockResolvedValueOnce({
    data: { user_id: ADMIN_USER_ID },
    error: null,
  });

  // 2. Pre-sweep `select('id').eq('metadata->>e2e_dedup_fixture_run_id', runId)`
  //    Implemented as awaiting the chain → resolves via `.then`.
  mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // 3. First insert (§1.7 queue) — `.select('id, metadata')`. Implemented
  //    via `.then`. Order matters: queue insert is awaited before nearDup.
  const queueRows = Array.from(opts.queueIdsBySlot.entries()).map(
    ([slot, id]) => ({
      id,
      metadata: {
        e2e_dedup_fixture_slot: slot,
        e2e_dedup_fixture_run_id: 'fakerunid',
      },
    }),
  );
  mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: queueRows, error: null, count: queueRows.length }),
  );

  // 4. Second insert (§1.9 near-dup).
  const nearDupRows = Array.from(opts.nearDupIdsBySlot.entries()).map(
    ([slot, id]) => ({
      id,
      metadata: {
        e2e_dedup_fixture_slot: slot,
        e2e_dedup_fixture_run_id: 'fakerunid',
      },
    }),
  );
  mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: nearDupRows, error: null, count: nearDupRows.length }),
  );
}

/**
 * Produce a strict RFC-4122 v4 lower-case-hex UUID parameterised by an
 * integer index. Layout: 8-4-4-4-12 hex with version=4 + variant=8/9/a/b.
 *
 * The last 12 hex chars encode `idx` zero-padded so distinct indices
 * produce distinct lex-orderable UUIDs — required by `buildPairId`'s
 * `idA < idB` predicate.
 */
function uuidLike(idx: number): string {
  const tail = idx.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}

function buildSlotMaps(): {
  queueIdsBySlot: Map<string, string>;
  nearDupIdsBySlot: Map<string, string>;
} {
  const queueSlots = [
    'queue-confirm-duplicate-canonical',
    'queue-confirm-duplicate-subject',
    'queue-confirm-unique-canonical',
    'queue-confirm-unique-subject',
    'queue-supersede-a-canonical',
    'queue-supersede-a-subject',
    'queue-supersede-b-canonical',
    'queue-supersede-b-subject',
    'queue-domain-a-filter-canonical',
    'queue-domain-a-filter-subject',
    'queue-domain-b-filter-canonical',
    'queue-domain-b-filter-subject',
  ];
  const nearDupSlots = [
    'near-dup-high-sim-x-left',
    'near-dup-high-sim-x-right',
    'near-dup-mid-sim-x-left',
    'near-dup-mid-sim-x-right',
    'near-dup-low-sim-x-left',
    'near-dup-low-sim-x-right',
    'near-dup-high-sim-y-left',
    'near-dup-high-sim-y-right',
    'near-dup-overlap-17-left',
    'near-dup-overlap-17-right',
    'near-dup-merge-target-left',
    'near-dup-merge-target-right',
    'near-dup-confirm-unique-left',
    'near-dup-confirm-unique-right',
  ];

  // Allocate UUIDs in monotonically-increasing index order so each pair's
  // left UUID < right UUID (left = even idx, right = odd idx) and queue
  // slots stay disjoint from nearDup slots.
  const queueIdsBySlot = new Map<string, string>();
  queueSlots.forEach((slot, idx) => {
    queueIdsBySlot.set(slot, uuidLike(idx + 1));
  });

  const nearDupIdsBySlot = new Map<string, string>();
  nearDupSlots.forEach((slot, idx) => {
    nearDupIdsBySlot.set(slot, uuidLike(100 + idx));
  });

  return { queueIdsBySlot, nearDupIdsBySlot };
}

// ---------------------------------------------------------------------------
// generateRunId
// ---------------------------------------------------------------------------

describe('admin-dedup-fixture-helpers / generateRunId', () => {
  it('returns the documented `s213b-{base36}-{6hex}` shape by default', () => {
    const id = generateRunId();
    expect(id).toMatch(/^s213b-[0-9a-z]+-[0-9a-f]{6}$/);
  });

  it('accepts a prefix override', () => {
    const id = generateRunId('manual');
    expect(id).toMatch(/^manual-[0-9a-z]+-[0-9a-f]{6}$/);
  });

  it('falls back to s213b when prefix is empty string', () => {
    const id = generateRunId('');
    expect(id).toMatch(/^s213b-/);
  });

  it('produces unique values across rapid calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      ids.add(generateRunId());
    }
    // 6 hex bytes = 16M space; 100 calls collision probability ≪ 1e-9.
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// seedAdminDedupFixtures
// ---------------------------------------------------------------------------

describe('admin-dedup-fixture-helpers / seedAdminDedupFixtures', () => {
  let mock: MockSupabaseClient;
  let queueIdsBySlot: Map<string, string>;
  let nearDupIdsBySlot: Map<string, string>;

  beforeEach(() => {
    mock = createMockSupabaseClient();
    const maps = buildSlotMaps();
    queueIdsBySlot = maps.queueIdsBySlot;
    nearDupIdsBySlot = maps.nearDupIdsBySlot;
    configureSeedHappyPath(mock, {
      queueRowCount: 12,
      nearDupRowCount: 14,
      queueIdsBySlot,
      nearDupIdsBySlot,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the documented shape with all queue + nearDup keys populated', async () => {
    const data = await seedAdminDedupFixtures(asClient(mock), 'fakerunid');

    expect(data.runId).toBe('fakerunid');
    expect(Object.keys(data.queue).sort()).toEqual([
      'confirmDuplicate',
      'confirmUnique',
      'domainAFilter',
      'domainBFilter',
      'supersedeA',
      'supersedeB',
    ]);
    expect(Object.keys(data.nearDup).sort()).toEqual([
      'confirmUnique',
      'highSimDomainX',
      'highSimDomainY',
      'lowSimDomainX',
      'mergeTarget',
      'midSimDomainX',
      'overlapWith17',
    ]);

    // Queue pairs each have subject + canonical IDs (UUIDs).
    for (const pair of Object.values(data.queue)) {
      expect(pair.subjectId).toBeTruthy();
      expect(pair.canonicalId).toBeTruthy();
      expect(pair.subjectId).not.toBe(pair.canonicalId);
    }
    // NearDup pairs each have left + right + pairId.
    for (const pair of Object.values(data.nearDup)) {
      expect(pair.leftId).toBeTruthy();
      expect(pair.rightId).toBeTruthy();
      expect(pair.pairId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('returns 26 unique IDs in allIds (12 queue + 14 nearDup)', async () => {
    const data: AdminDedupFixtureData = await seedAdminDedupFixtures(
      asClient(mock),
      'fakerunid',
    );
    expect(data.allIds).toHaveLength(26);
    expect(new Set(data.allIds).size).toBe(26);
  });

  it('inserts rows tagged with the runId in metadata.e2e_dedup_fixture_run_id', async () => {
    await seedAdminDedupFixtures(asClient(mock), 'fakerunid');

    // Two `.insert()` calls expected (queue + nearDup).
    expect(mock._chain.insert).toHaveBeenCalledTimes(2);

    const queueInsertArg = mock._chain.insert.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    const nearDupInsertArg = mock._chain.insert.mock.calls[1]?.[0] as Array<
      Record<string, unknown>
    >;

    expect(queueInsertArg).toHaveLength(12);
    expect(nearDupInsertArg).toHaveLength(14);

    // Every row tagged with the runId.
    for (const row of queueInsertArg) {
      const meta = row.metadata as Record<string, unknown>;
      expect(meta?.e2e_dedup_fixture_run_id).toBe('fakerunid');
    }
    for (const row of nearDupInsertArg) {
      const meta = row.metadata as Record<string, unknown>;
      expect(meta?.e2e_dedup_fixture_run_id).toBe('fakerunid');
    }
  });

  it('forbids the GENERATED ALWAYS content_text_hash column on all inserts', async () => {
    await seedAdminDedupFixtures(asClient(mock), 'fakerunid');

    const queueInsertArg = mock._chain.insert.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    const nearDupInsertArg = mock._chain.insert.mock.calls[1]?.[0] as Array<
      Record<string, unknown>
    >;

    for (const row of [...queueInsertArg, ...nearDupInsertArg]) {
      expect(row).not.toHaveProperty('content_text_hash');
    }
  });

  it('writes embedding inline on every §1.9 nearDup insert (decision §9.5)', async () => {
    await seedAdminDedupFixtures(asClient(mock), 'fakerunid');

    const nearDupInsertArg = mock._chain.insert.mock.calls[1]?.[0] as Array<
      Record<string, unknown>
    >;

    for (const row of nearDupInsertArg) {
      expect(row).toHaveProperty('embedding');
      // Inline insert per design §9.5: JSON.stringify(vec).
      expect(typeof row.embedding).toBe('string');
      const parsed = JSON.parse(row.embedding as string) as number[];
      expect(parsed).toHaveLength(1024);
    }

    // Conversely, queue inserts MUST NOT write embedding (saves budget +
    // confirms the §1.7 path doesn't depend on vectors).
    const queueInsertArg = mock._chain.insert.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    for (const row of queueInsertArg) {
      expect(row).not.toHaveProperty('embedding');
    }
  });

  it('writes both required NOT NULL columns on every row (content, content_type, title)', async () => {
    await seedAdminDedupFixtures(asClient(mock), 'fakerunid');

    const allInserts = [
      ...((mock._chain.insert.mock.calls[0]?.[0] ?? []) as Array<
        Record<string, unknown>
      >),
      ...((mock._chain.insert.mock.calls[1]?.[0] ?? []) as Array<
        Record<string, unknown>
      >),
    ];

    for (const row of allInserts) {
      expect(typeof row.content).toBe('string');
      expect((row.content as string).length).toBeGreaterThan(0);
      expect(typeof row.content_type).toBe('string');
      expect(typeof row.title).toBe('string');
      expect((row.title as string).length).toBeGreaterThan(0);
    }
  });

  it('produces matching `content` strings within each §1.7 queue pair (hash collision)', async () => {
    await seedAdminDedupFixtures(asClient(mock), 'fakerunid');

    const queueInsertArg = mock._chain.insert.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;

    // Pairs are inserted as [canonical, subject, canonical, subject, ...].
    for (let i = 0; i < queueInsertArg.length; i += 2) {
      const canonical = queueInsertArg[i] as Record<string, unknown>;
      const subject = queueInsertArg[i + 1] as Record<string, unknown>;
      // Both must share `content` so md5(normalised) collides.
      expect(canonical.content).toBe(subject.content);
      // Sanity: dedup_status differs.
      expect(canonical.dedup_status).toBe('clean');
      expect(subject.dedup_status).toBe('suspected_duplicate');
    }
  });

  it('sets created_by to options.actorUserId without a user_roles lookup', async () => {
    // Reset and re-configure without a user_roles lookup.
    mock = createMockSupabaseClient();
    const maps = buildSlotMaps();
    queueIdsBySlot = maps.queueIdsBySlot;
    nearDupIdsBySlot = maps.nearDupIdsBySlot;
    // Note: NO user_roles single() mock — fail loudly if seeder calls it.
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
    const queueRows = Array.from(queueIdsBySlot.entries()).map(
      ([slot, id]) => ({
        id,
        metadata: { e2e_dedup_fixture_slot: slot },
      }),
    );
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: queueRows, error: null, count: queueRows.length }),
    );
    const nearDupRows = Array.from(nearDupIdsBySlot.entries()).map(
      ([slot, id]) => ({
        id,
        metadata: { e2e_dedup_fixture_slot: slot },
      }),
    );
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: nearDupRows, error: null, count: nearDupRows.length }),
    );

    const customActor = '11111111-2222-4333-8444-555555555555';
    await seedAdminDedupFixtures(asClient(mock), 'fakerunid', {
      actorUserId: customActor,
    });

    const queueInsertArg = mock._chain.insert.mock.calls[0]?.[0] as Array<
      Record<string, unknown>
    >;
    expect(queueInsertArg[0]?.created_by).toBe(customActor);
  });
});

// ---------------------------------------------------------------------------
// cleanupAdminDedupFixtures — FK-safe order
// ---------------------------------------------------------------------------

describe('admin-dedup-fixture-helpers / cleanupAdminDedupFixtures', () => {
  let mock: MockSupabaseClient;

  beforeEach(() => {
    mock = createMockSupabaseClient();
    // ID resolve: returns 3 fake IDs.
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({
        data: [{ id: 'id-1' }, { id: 'id-2' }, { id: 'id-3' }],
        error: null,
        count: 3,
      }),
    );

    // Subsequent operations: superseded_by update, then 3 deletes
    // (chunks, history, items) — each `.select('id')` resolves to data.
    // Use .then on the chain for the awaited results.
    mock._chain.then
      .mockImplementationOnce(
        // superseded_by update result
        (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null, count: 0 }),
      )
      .mockImplementationOnce(
        // delete content_chunks result
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce(
        // delete content_history result
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: 'h1' }, { id: 'h2' }],
            error: null,
            count: 2,
          }),
      )
      .mockImplementationOnce(
        // delete content_items result
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: 'id-1' }, { id: 'id-2' }, { id: 'id-3' }],
            error: null,
            count: 3,
          }),
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues child-table queries before parent (FK-safe order)', async () => {
    const counts = await cleanupAdminDedupFixtures(asClient(mock), 'fakerunid');

    expect(counts.deletedContentItems).toBe(3);
    expect(counts.deletedHistoryRows).toBe(2);
    expect(counts.deletedChunks).toBe(0);

    // Order of `.from()` calls = order of operations.
    const fromCalls = mock.from.mock.calls.map((call) => call[0]);
    // 1. content_items (resolve IDs)
    expect(fromCalls[0]).toBe('content_items');
    // 2. content_items (clear superseded_by)
    expect(fromCalls[1]).toBe('content_items');
    // 3. content_chunks (FK child)
    expect(fromCalls[2]).toBe('content_chunks');
    // 4. content_history (FK child)
    expect(fromCalls[3]).toBe('content_history');
    // 5. content_items (parent)
    expect(fromCalls[4]).toBe('content_items');
  });

  it('filters by metadata->>e2e_dedup_fixture_run_id when resolving IDs', async () => {
    await cleanupAdminDedupFixtures(asClient(mock), 'fakerunid');

    // First .eq() is the run-id metadata filter.
    const firstEqCall = mock._chain.eq.mock.calls[0];
    expect(firstEqCall?.[0]).toBe('metadata->>e2e_dedup_fixture_run_id');
    expect(firstEqCall?.[1]).toBe('fakerunid');
  });

  it('returns zero counts when no rows match', async () => {
    mock = createMockSupabaseClient();
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

    const counts = await cleanupAdminDedupFixtures(
      asClient(mock),
      'unknown-run',
    );
    expect(counts).toEqual({
      deletedContentItems: 0,
      deletedHistoryRows: 0,
      deletedChunks: 0,
    });

    // Should NOT have issued any deletes — only the lookup.
    expect(mock._chain.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cleanupAllAdminDedupFixtures
// ---------------------------------------------------------------------------

describe('admin-dedup-fixture-helpers / cleanupAllAdminDedupFixtures', () => {
  let mock: MockSupabaseClient;

  beforeEach(() => {
    mock = createMockSupabaseClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('broadens cleanup to every run via a metadata IS NOT NULL filter', async () => {
    mock._chain.then
      .mockImplementationOnce(
        // resolve IDs
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: 'a' }, { id: 'b' }],
            error: null,
            count: 2,
          }),
      )
      .mockImplementationOnce(
        // superseded_by update
        (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: null, count: 0 }),
      )
      .mockImplementationOnce(
        // delete content_chunks
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce(
        // delete content_history
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null, count: 0 }),
      )
      .mockImplementationOnce(
        // delete content_items
        (resolve: (v: unknown) => void) =>
          resolve({
            data: [{ id: 'a' }, { id: 'b' }],
            error: null,
            count: 2,
          }),
      );

    const counts = await cleanupAllAdminDedupFixtures(asClient(mock));
    expect(counts.deletedContentItems).toBe(2);

    // First .not() call: filter on metadata->run_id IS NOT NULL.
    const notCalls = mock._chain.not.mock.calls;
    expect(notCalls[0]?.[0]).toBe('metadata->e2e_dedup_fixture_run_id');
    expect(notCalls[0]?.[1]).toBe('is');
    expect(notCalls[0]?.[2]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sweepOrphanFixtures
// ---------------------------------------------------------------------------

describe('admin-dedup-fixture-helpers / sweepOrphanFixtures', () => {
  let mock: MockSupabaseClient;

  beforeEach(() => {
    mock = createMockSupabaseClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sweeps only fixtures older than the created_at cutoff', async () => {
    mock._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );

    await sweepOrphanFixtures(asClient(mock), 2);

    const ltCalls = mock._chain.lt.mock.calls;
    // Only one .lt() call, on created_at, with an ISO timestamp cutoff.
    expect(ltCalls[0]?.[0]).toBe('created_at');
    const cutoffArg = ltCalls[0]?.[1] as string;
    expect(typeof cutoffArg).toBe('string');
    // Sanity: parses as a valid date in the past.
    expect(Date.parse(cutoffArg)).toBeLessThan(Date.now());
  });

  it('rejects non-positive olderThanHours', async () => {
    await expect(sweepOrphanFixtures(asClient(mock), 0)).rejects.toThrow(
      /olderThanHours/,
    );
    await expect(sweepOrphanFixtures(asClient(mock), -1)).rejects.toThrow(
      /olderThanHours/,
    );
  });
});

// ---------------------------------------------------------------------------
// verifySeededPairs
// ---------------------------------------------------------------------------

describe('admin-dedup-fixture-helpers / verifySeededPairs', () => {
  let mock: MockSupabaseClient;

  beforeEach(() => {
    mock = createMockSupabaseClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildFakeFixtureData(): AdminDedupFixtureData {
    // Reserve the [200, 226] window so these UUIDs don't collide with the
    // queue (1-12) or nearDup (100-113) ranges used by buildSlotMaps.
    const ids = (n: number) => uuidLike(200 + n);
    return {
      runId: 'fakerunid',
      queue: {
        confirmDuplicate: { canonicalId: ids(1), subjectId: ids(2) },
        confirmUnique: { canonicalId: ids(3), subjectId: ids(4) },
        supersedeA: { canonicalId: ids(5), subjectId: ids(6) },
        supersedeB: { canonicalId: ids(7), subjectId: ids(8) },
        domainAFilter: { canonicalId: ids(9), subjectId: ids(10) },
        domainBFilter: { canonicalId: ids(11), subjectId: ids(12) },
      },
      nearDup: {
        highSimDomainX: {
          leftId: ids(13),
          rightId: ids(14),
          pairId: `${ids(13)}__${ids(14)}`,
        },
        midSimDomainX: {
          leftId: ids(15),
          rightId: ids(16),
          pairId: `${ids(15)}__${ids(16)}`,
        },
        lowSimDomainX: {
          leftId: ids(17),
          rightId: ids(18),
          pairId: `${ids(17)}__${ids(18)}`,
        },
        highSimDomainY: {
          leftId: ids(19),
          rightId: ids(20),
          pairId: `${ids(19)}__${ids(20)}`,
        },
        overlapWith17: {
          leftId: ids(21),
          rightId: ids(22),
          pairId: `${ids(21)}__${ids(22)}`,
        },
        mergeTarget: {
          leftId: ids(23),
          rightId: ids(24),
          pairId: `${ids(23)}__${ids(24)}`,
        },
        confirmUnique: {
          leftId: ids(25),
          rightId: ids(26),
          pairId: `${ids(25)}__${ids(26)}`,
        },
      },
      allIds: [],
    };
  }

  it('calls find_duplicate_pairs with threshold 0.85, no domain, limit 200', async () => {
    mock.rpc.mockResolvedValueOnce({ data: [], error: null });

    const fixture = buildFakeFixtureData();
    await expect(verifySeededPairs(asClient(mock), fixture)).rejects.toThrow(
      /NOT found/,
    );

    // Even though it threw, the RPC was called with the right args.
    const call = mock.rpc.mock.calls[0];
    expect(call?.[0]).toBe('find_duplicate_pairs');
    expect(call?.[1]).toEqual({
      similarity_threshold: 0.85,
      p_domain: undefined,
      limit_count: 200,
    });
  });

  it('throws with diff summary when an expected pair is missing', async () => {
    mock.rpc.mockResolvedValueOnce({ data: [], error: null });

    const fixture = buildFakeFixtureData();
    await expect(verifySeededPairs(asClient(mock), fixture)).rejects.toThrow(
      /NOT found in find_duplicate_pairs/,
    );
  });

  it('throws when an expected pair is at the wrong similarity', async () => {
    const fixture = buildFakeFixtureData();
    // Mock RPC: every pair returns at sim=0.50 — wildly off-target.
    const allPairs = [
      fixture.nearDup.highSimDomainX,
      fixture.nearDup.midSimDomainX,
      fixture.nearDup.lowSimDomainX,
      fixture.nearDup.highSimDomainY,
      fixture.nearDup.overlapWith17,
      fixture.nearDup.mergeTarget,
      fixture.nearDup.confirmUnique,
    ];
    mock.rpc.mockResolvedValueOnce({
      data: allPairs.map((p) => ({
        id1: p.leftId < p.rightId ? p.leftId : p.rightId,
        id2: p.leftId < p.rightId ? p.rightId : p.leftId,
        similarity: 0.5,
      })),
      error: null,
    });

    await expect(verifySeededPairs(asClient(mock), fixture)).rejects.toThrow(
      /differs from expected/,
    );
  });

  it('throws when the RPC errors', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'rpc gone' },
    });

    const fixture = buildFakeFixtureData();
    await expect(verifySeededPairs(asClient(mock), fixture)).rejects.toThrow(
      /rpc gone/,
    );
  });
});
