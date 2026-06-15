/**
 * In-house graduation metric (T18/T19, B-INV-18/19) — unit + zero-egress audit.
 *
 * The graduation metric is the per-workflow progressive-trust (WS-5) quality
 * value that earns auto-apply. It is computed ON KH's OWN infrastructure from
 * `ai_call_events` (T15) + `eval_runs` (T9) — NO client-data trajectory is POSTed
 * to Raindrop cloud (directly satisfies ID-71 B-INV-15). This suite proves:
 *
 *   1. the metric is produced by `graduation.ts` from on-platform data;
 *   2. `metricFor(touchpointId)` returns a value for a declared `graduation_metric`
 *      (contract-addressable, T19) and `null` when none is declared;
 *   3. a GATING network assertion confirms ZERO Raindrop-cloud egress — no
 *      `fetch`/network call, no `raindrop.ai` host, no Workshop `writeKey`.
 *
 * This PRODUCT only COMPUTES the metric; auto-apply on it is the DEFERRED
 * follow-up (T24 / {104.19}) and is deliberately absent here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  metricFor,
  computeWinRate,
  computeEvalPassRate,
  computeProgressiveTrust,
  GRADUATION_METRIC_NAMES,
  type GraduationMetricName,
} from '@/lib/eval/graduation';
import { createMockSupabaseTable } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Fixtures: minimal on-platform rows mirroring the M4/M2 column shapes.
// ---------------------------------------------------------------------------

/** An `ai_call_events` row slice carrying the outcome signal the metric reads. */
function callEvent(outcome: 'win' | 'fail' | 'loop' | 'refusal') {
  return { outcome_signal: outcome };
}

/** An `eval_runs` row slice carrying the pass flag the metric reads. */
function evalRun(passed: boolean) {
  return { passed };
}

/**
 * Build a mock client that routes `from('ai_call_events')` and
 * `from('eval_runs')` to distinct resolutions, plus `from('eval_touchpoints')`
 * to a registry row carrying the declared `graduation_metric`.
 */
function mockGraduationClient(opts: {
  graduationMetric: string | null;
  callEvents?: Array<{ outcome_signal: string }>;
  evalRuns?: Array<{ passed: boolean }>;
  touchpointMissing?: boolean;
}) {
  const touchpointResolution = opts.touchpointMissing
    ? { data: null, error: null }
    : { data: { graduation_metric: opts.graduationMetric }, error: null };

  const callEventsChain = createMockSupabaseTable({
    data: opts.callEvents ?? [],
    error: null,
  });
  const evalRunsChain = createMockSupabaseTable({
    data: opts.evalRuns ?? [],
    error: null,
  });
  const touchpointChain = createMockSupabaseTable(touchpointResolution);

  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_call_events') return callEventsChain.from(table);
      if (table === 'eval_runs') return evalRunsChain.from(table);
      if (table === 'eval_touchpoints') return touchpointChain.from(table);
      throw new Error(`unexpected table in graduation read: ${table}`);
    }),
  };
}

describe('graduation metric — pure computations', () => {
  describe('computeWinRate (ai_call_events)', () => {
    it('is the fraction of `win` outcome signals', () => {
      const events = [
        callEvent('win'),
        callEvent('win'),
        callEvent('fail'),
        callEvent('loop'),
      ];
      // 2 wins / 4 calls = 0.5
      expect(computeWinRate(events)).toBeCloseTo(0.5, 10);
    });

    it('counts only `win` — fail/loop/refusal do not count toward trust', () => {
      const events = [
        callEvent('fail'),
        callEvent('loop'),
        callEvent('refusal'),
      ];
      expect(computeWinRate(events)).toBe(0);
    });

    it('returns 0 for an empty call history (no trust earned yet)', () => {
      expect(computeWinRate([])).toBe(0);
    });
  });

  describe('computeEvalPassRate (eval_runs)', () => {
    it('is the fraction of runs that passed', () => {
      const runs = [
        evalRun(true),
        evalRun(true),
        evalRun(true),
        evalRun(false),
      ];
      // 3 / 4 = 0.75
      expect(computeEvalPassRate(runs)).toBeCloseTo(0.75, 10);
    });

    it('returns 0 for an empty run history', () => {
      expect(computeEvalPassRate([])).toBe(0);
    });
  });

  describe('computeProgressiveTrust (blend)', () => {
    it('blends win-rate and eval-pass-rate (mean of the two)', () => {
      // winRate 0.5, passRate 0.75 → 0.625
      expect(computeProgressiveTrust(0.5, 0.75)).toBeCloseTo(0.625, 10);
    });

    it('is bounded in [0,1]', () => {
      expect(computeProgressiveTrust(1, 1)).toBe(1);
      expect(computeProgressiveTrust(0, 0)).toBe(0);
    });
  });
});

describe('metricFor — contract-addressable, on-platform (T19)', () => {
  it('returns the declared metric value computed from ai_call_events + eval_runs', async () => {
    const supabase = mockGraduationClient({
      graduationMetric: 'progressive_trust',
      callEvents: [
        callEvent('win'),
        callEvent('win'),
        callEvent('fail'),
        callEvent('loop'),
      ], // win 0.5
      evalRuns: [evalRun(true), evalRun(true), evalRun(true), evalRun(false)], // pass 0.75
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await metricFor(supabase as any, 'tool:find_duplicates');

    expect(result).not.toBeNull();
    expect(result?.touchpoint_id).toBe('tool:find_duplicates');
    expect(result?.metric).toBe('progressive_trust');
    // mean(0.5, 0.75) = 0.625 — computed in-house from on-platform rows.
    expect(result?.value).toBeCloseTo(0.625, 10);
    expect(result?.sample_size).toBe(8); // 4 calls + 4 runs
    expect(result?.computed_in_house).toBe(true);
  });

  it('reports win_rate when that is the declared metric', async () => {
    const supabase = mockGraduationClient({
      graduationMetric: 'win_rate',
      callEvents: [callEvent('win'), callEvent('fail')], // 0.5
      evalRuns: [evalRun(false)],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await metricFor(supabase as any, 'tool:x');
    expect(result?.metric).toBe('win_rate');
    expect(result?.value).toBeCloseTo(0.5, 10);
  });

  it('reports eval_pass_rate when that is the declared metric', async () => {
    const supabase = mockGraduationClient({
      graduationMetric: 'eval_pass_rate',
      callEvents: [callEvent('win')],
      evalRuns: [evalRun(true), evalRun(false)], // 0.5
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await metricFor(supabase as any, 'tool:x');
    expect(result?.metric).toBe('eval_pass_rate');
    expect(result?.value).toBeCloseTo(0.5, 10);
  });

  it('returns null when the touchpoint declares NO graduation_metric (nothing to report)', async () => {
    const supabase = mockGraduationClient({ graduationMetric: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await metricFor(supabase as any, 'tool:no-metric');
    expect(result).toBeNull();
  });

  it('returns null when the touchpoint is not registered', async () => {
    const supabase = mockGraduationClient({
      graduationMetric: null,
      touchpointMissing: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await metricFor(supabase as any, 'tool:absent');
    expect(result).toBeNull();
  });

  it('throws on an unrecognised declared metric (declared-but-unreadable is a B-INV-19 fail)', async () => {
    const supabase = mockGraduationClient({ graduationMetric: 'not_a_metric' });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metricFor(supabase as any, 'tool:bad'),
    ).rejects.toThrow(/unknown graduation metric/i);
  });

  it('exposes the closed set of in-house metric names', () => {
    const names: readonly GraduationMetricName[] = GRADUATION_METRIC_NAMES;
    expect(names).toContain('win_rate');
    expect(names).toContain('eval_pass_rate');
    expect(names).toContain('progressive_trust');
  });
});

// ---------------------------------------------------------------------------
// GATING zero-egress assertion (B-INV-18 / ID-71 B-INV-15). This is NOT
// advisory: if `graduation.ts` ever reaches off-platform, this fails CI.
// ---------------------------------------------------------------------------
describe('zero Raindrop-cloud egress (B-INV-18 — gating)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => {
      throw new Error(
        'NETWORK EGRESS — graduation metric must compute on-platform only',
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchSpy as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('computes metricFor WITHOUT any network call', async () => {
    const supabase = mockGraduationClient({
      graduationMetric: 'progressive_trust',
      callEvents: [callEvent('win'), callEvent('fail')],
      evalRuns: [evalRun(true)],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await metricFor(supabase as any, 'tool:x');

    expect(result).not.toBeNull();
    // The load-bearing assertion: not one byte left the platform.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the graduation module source contains no Raindrop-cloud egress path', async () => {
    // Static audit: the module must not reference the Raindrop cloud host or a
    // Workshop writeKey (Workshop is local-only, empty writeKey by design).
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'lib/eval/graduation.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/raindrop\.ai/i);
    expect(source).not.toMatch(/writeKey/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});
