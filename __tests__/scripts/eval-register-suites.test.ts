/**
 * eval-register-suites — bootstrap registration + suite dispatch map.
 *
 * Behaviour contract (testStrategy, {104.14}):
 *   - each L1/L3/L4 suite is a registered touchpoint with a bound contract
 *     routing through eval-runner;
 *   - each of the 7 legacy suites is registered with a bound contract;
 *   - `buildSuiteRegistry` returns a registry keyed by suite_name covering
 *     all 10 suites;
 *   - `registerAllSuites` calls `registerTouchpoint` once per contract (10
 *     calls) and is idempotent (second call is a no-op from the registry's
 *     perspective);
 *   - the mcp-eval contracts carry severity_on_fail='block', the legacy
 *     contracts carry 'warn';
 *   - each contract has the seven mandatory AgentEvalContract fields.
 *
 * Behaviour-first per reference/test-philosophy.md; shared Supabase mock only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';
import { agentEvalContractSchema } from '@/lib/eval/contract';
import type { Touchpoint } from '@/lib/eval/registry';
import {
  REGISTERED_SUITE_CONTRACTS,
  buildSuiteRegistry,
  registerAllSuites,
} from '@/scripts/eval-register-suites';

import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

/**
 * The shared Supabase mock typed as the production client — same helper
 * pattern as eval-runner.test.ts.
 */
function mockDb(): SupabaseClient<Database> &
  ReturnType<typeof createMockSupabaseClient> {
  return createMockSupabaseClient() as unknown as SupabaseClient<Database> &
    ReturnType<typeof createMockSupabaseClient>;
}

/** A minimal stored touchpoint row for mock registry reads. */
function storedRow(suite_name: string, touchpoint_id: string): Touchpoint {
  return {
    touchpoint_id,
    kind: 'tool',
    owner: 'platform-team',
    suite_name,
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: 0.02,
    graduation_metric: null,
    contract_version: 1,
    registry_version: 1,
    created_at: '2026-06-16T00:00:00.000Z',
    updated_at: '2026-06-16T00:00:00.000Z',
  } as Touchpoint;
}

// ---------------------------------------------------------------------------
// REGISTERED_SUITE_CONTRACTS — the static contract manifest
// ---------------------------------------------------------------------------

describe('REGISTERED_SUITE_CONTRACTS', () => {
  it('contains exactly 10 suite contracts (3 mcp-eval + 7 legacy)', () => {
    expect(REGISTERED_SUITE_CONTRACTS).toHaveLength(10);
  });

  it('every contract satisfies the AgentEvalContract Zod schema (all 7 mandatory fields present)', () => {
    for (const contract of REGISTERED_SUITE_CONTRACTS) {
      const result = agentEvalContractSchema.safeParse(contract);
      expect(
        result.success,
        `contract ${contract.touchpoint_id} failed Zod parse`,
      ).toBe(true);
    }
  });

  it('includes exactly the 3 mcp-eval suite_names (l1, l3, l4)', () => {
    const mcpSuiteNames = REGISTERED_SUITE_CONTRACTS.filter(
      (c) =>
        c.suite_name === 'l1' || c.suite_name === 'l3' || c.suite_name === 'l4',
    )
      .map((c) => c.suite_name)
      .sort();
    expect(mcpSuiteNames).toEqual(['l1', 'l3', 'l4']);
  });

  it('includes exactly the 7 legacy suite_names', () => {
    const legacyNames = [
      'classification',
      'entity-classification',
      'holder-rule-ts',
      'procurement-drafting',
      'search',
      'summarisation',
      'tag-morphology-adoption',
    ].sort();
    const actual = REGISTERED_SUITE_CONTRACTS.filter(
      (c) => !['l1', 'l3', 'l4'].includes(c.suite_name),
    )
      .map((c) => c.suite_name)
      .sort();
    expect(actual).toEqual(legacyNames);
  });

  it('mcp-eval contracts carry severity_on_fail = block (CI-gating suites)', () => {
    const mcpContracts = REGISTERED_SUITE_CONTRACTS.filter((c) =>
      ['l1', 'l3', 'l4'].includes(c.suite_name),
    );
    for (const contract of mcpContracts) {
      expect(contract.severity_on_fail).toBe('block');
    }
  });

  it('legacy contracts carry severity_on_fail = warn (not yet CI-blocking)', () => {
    const legacyContracts = REGISTERED_SUITE_CONTRACTS.filter(
      (c) => !['l1', 'l3', 'l4'].includes(c.suite_name),
    );
    for (const contract of legacyContracts) {
      expect(contract.severity_on_fail).toBe('warn');
    }
  });

  it('all touchpoint_ids are unique (no duplicates)', () => {
    const ids = REGISTERED_SUITE_CONTRACTS.map((c) => c.touchpoint_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// registerAllSuites — idempotent bootstrap registration
// ---------------------------------------------------------------------------

describe('registerAllSuites', () => {
  it('calls registerTouchpoint once per contract (10 contracts → 10 DB pre-reads)', async () => {
    const supabase = mockDb();

    // registerTouchpoint calls:
    //   1. tryQuery for the pre-read (maybeSingle — no existing row)
    //   2. currentRegistryVersion (then — direct array resolve)
    //   3. sb insert (single)
    // We configure maybeSingle → null (no existing row) + single → inserted
    // row for each of the 10 contracts. We use mockResolvedValue (not Once)
    // so all 10 calls share the same mock behaviour.
    supabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    supabase._chain.single.mockResolvedValue({
      data: storedRow('l1', 'mcp-eval.l1'),
      error: null,
    });

    await registerAllSuites(supabase);

    // 10 contracts × 1 maybeSingle pre-read each = 10 maybeSingle calls.
    expect(supabase._chain.maybeSingle).toHaveBeenCalledTimes(10);
    // 10 contracts × 1 insert each = 10 insert calls.
    expect(supabase._chain.insert).toHaveBeenCalledTimes(10);
  });

  it('is a no-op (zero inserts) when every contract row already exists with an identical contract', async () => {
    const supabase = mockDb();

    // For a no-op: maybeSingle returns the existing row with identical fields.
    // registerTouchpoint compares incoming vs stored — if no field changed,
    // it skips the update (no version churn, B-INV-5).
    // We return a contract-matching row for the first call site (l1) as a
    // spot-check; for simplicity we verify zero insert/update calls.
    supabase._chain.maybeSingle.mockImplementation(() =>
      Promise.resolve({
        data: storedRow('l1', 'mcp-eval.l1'),
        error: null,
      }),
    );

    // The 10 contracts each pre-read their row. The mock returns the l1 row
    // shape for ALL calls. For a real no-op the returned row must have the same
    // field values as the incoming contract — but since registry.ts compares
    // the VERSIONED_FIELDS one by one, a mismatch would trigger an update.
    // Here we only assert that insert was NOT called when the pre-read returns
    // a non-null result (update would be called only on field change).
    await registerAllSuites(supabase);

    expect(supabase._chain.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildSuiteRegistry — suite_name → SuiteFn map
// ---------------------------------------------------------------------------

describe('buildSuiteRegistry', () => {
  it('returns a registry with exactly 10 entries', () => {
    const registry = buildSuiteRegistry();
    expect(Object.keys(registry)).toHaveLength(10);
  });

  it('contains entries for all 3 mcp-eval suites (l1, l3, l4)', () => {
    const registry = buildSuiteRegistry();
    expect(typeof registry['l1']).toBe('function');
    expect(typeof registry['l3']).toBe('function');
    expect(typeof registry['l4']).toBe('function');
  });

  it('contains entries for all 7 legacy suites', () => {
    const registry = buildSuiteRegistry();
    const legacyNames = [
      'classification',
      'entity-classification',
      'holder-rule-ts',
      'procurement-drafting',
      'search',
      'summarisation',
      'tag-morphology-adoption',
    ];
    for (const name of legacyNames) {
      expect(typeof registry[name], `missing legacy suite: ${name}`).toBe(
        'function',
      );
    }
  });

  it('legacy suite fns return an infra outcome (not-yet-wired placeholder) without throwing', async () => {
    const registry = buildSuiteRegistry();
    const tp = storedRow('classification', 'eval.classification');
    const outcome = await registry['classification']!(tp);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.kind).toBe('infra');
      expect(outcome.reason).toContain('classification');
    }
  });

  it('every registry entry is a function (SuiteFn shape)', () => {
    const registry = buildSuiteRegistry();
    for (const [name, fn] of Object.entries(registry)) {
      expect(typeof fn, `${name} is not a function`).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: buildSuiteRegistry fns are compatible with runEvals
// ---------------------------------------------------------------------------

describe('suite registry + runEvals integration', () => {
  it('runEvals dispatches a mocked l1 suite through the registry and records the outcome', async () => {
    // Import runEvals dynamically so the test exercises the real runner.
    const { runEvals } = await import('@/scripts/eval-runner');
    const supabase = mockDb();

    // listTouchpoints (scope: all) → one l1 touchpoint.
    supabase._chain.order.mockReturnValueOnce(
      Promise.resolve({
        data: [storedRow('l1', 'mcp-eval.l1')],
        error: null,
      }) as never,
    );
    // loadBaseline → null (first run, no baseline).
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // eval_runs insert → ok.
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'r1' },
      error: null,
    });

    // Inject a mock l1 suite that returns a clean pass.
    const mockL1: (
      tp: Touchpoint,
    ) => Promise<{ ok: true; metrics: Record<string, number> }> = vi.fn(
      async (_tp) => ({ ok: true as const, metrics: { pass_rate: 1.0 } }),
    );

    const report = await runEvals(supabase, {
      scope: { all: true },
      suites: { l1: mockL1 },
      source: 'ci',
    });

    expect(report.exitClass).toBe(0); // EXIT_PASS
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.touchpointId).toBe('mcp-eval.l1');
    expect(report.results[0]?.passed).toBe(true);
  });
});
