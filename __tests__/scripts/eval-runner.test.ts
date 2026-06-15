/**
 * eval-runner — central dispatcher + deterministic exit 0/1/2 ({104.13}).
 *
 * Behaviour contract (testStrategy): every touchpoint dispatches through the
 * runner; the three run conditions map DETERMINISTICALLY to exit 0/1/2, with
 * quality-fail (1) and infra-error (2) kept DISTINCT; an unregistered touchpoint
 * yields a 'not registered' reason and exit 2.
 *
 * The runner separates the PURE disposition logic (returns an exit class) from
 * the `process.exit()` call, so these tests assert the exit class as a value
 * without killing the test process.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Touchpoint } from '@/lib/eval/registry';
import {
  EXIT_PASS,
  EXIT_QUALITY_FAIL,
  EXIT_RUNNER_ERROR,
  foldExitClass,
  runEvalTouchpoint,
  runEvals,
  type SuiteRunOutcome,
} from '@/scripts/eval-runner';

import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A registered touchpoint row, parameterised by the fields the runner reads. */
function touchpoint(overrides: Partial<Touchpoint> = {}): Touchpoint {
  return {
    touchpoint_id: 'classification',
    kind: 'tool',
    owner: 'ai-platform',
    suite_name: 'classification',
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: 0.02,
    graduation_metric: null,
    contract_version: 1,
    registry_version: 1,
    created_at: '2026-06-15T00:00:00.000Z',
    updated_at: '2026-06-15T00:00:00.000Z',
    ...overrides,
  } as Touchpoint;
}

/** A suite fn that reports a clean run with the given metrics. */
function passingSuite(metrics: Record<string, number>): SuiteRunOutcome {
  return { ok: true, metrics };
}

/** A suite fn that reports a transient-provider (529/timeout) failure. */
function infraSuite(reason: string): SuiteRunOutcome {
  return { ok: false, kind: 'infra', reason };
}

// ---------------------------------------------------------------------------
// foldExitClass — the pure 0/1/2 fold
// ---------------------------------------------------------------------------

describe('foldExitClass', () => {
  it('returns EXIT_PASS (0) when every touchpoint passed', () => {
    expect(
      foldExitClass([{ exitClass: EXIT_PASS }, { exitClass: EXIT_PASS }]),
    ).toBe(EXIT_PASS);
  });

  it('returns EXIT_QUALITY_FAIL (1) when a block regression is present and no infra error', () => {
    expect(
      foldExitClass([
        { exitClass: EXIT_PASS },
        { exitClass: EXIT_QUALITY_FAIL },
      ]),
    ).toBe(EXIT_QUALITY_FAIL);
  });

  it('returns EXIT_RUNNER_ERROR (2) and OUTRANKS a quality fail when any infra error is present', () => {
    // 2 dominates 1: a runner/infra error means the run could not complete, so
    // the quality verdict is unreliable — 2 must win.
    expect(
      foldExitClass([
        { exitClass: EXIT_QUALITY_FAIL },
        { exitClass: EXIT_RUNNER_ERROR },
      ]),
    ).toBe(EXIT_RUNNER_ERROR);
  });

  it('returns EXIT_PASS (0) for an empty run (nothing dispatched, nothing failed)', () => {
    expect(foldExitClass([])).toBe(EXIT_PASS);
  });
});

// ---------------------------------------------------------------------------
// runEvalTouchpoint — single-touchpoint dispatch + uniform eval_runs write
// ---------------------------------------------------------------------------

describe('runEvalTouchpoint', () => {
  it('exits 0 and writes passed=true when metrics hold against the baseline', async () => {
    const supabase = createMockSupabaseClient();
    // Active baseline load (.maybeSingle) — domain_accuracy baseline 0.80.
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        touchpoint_id: 'classification',
        metrics: { domain_accuracy: 0.8 },
        thresholds: {},
        registry_version: 1,
        promoted_at: '2026-06-15T00:00:00.000Z',
        promoted_by: 'bootstrap',
      },
      error: null,
    });
    // eval_runs insert (.single) — echo the row back.
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'run-1' },
      error: null,
    });

    const tp = touchpoint();
    // current 0.81 ≥ baseline 0.80 → improvement → pass.
    const result = await runEvalTouchpoint(
      supabase,
      tp,
      async () => passingSuite({ domain_accuracy: 0.81 }),
      'ci',
    );

    expect(result.exitClass).toBe(EXIT_PASS);
    expect(result.passed).toBe(true);
    expect(result.severityDisposition).toBe('info');

    // A uniform eval_runs row was written with the runner's exit class.
    const insertArg = supabase._chain.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(supabase.from).toHaveBeenCalledWith('eval_runs');
    expect(insertArg).toMatchObject({
      touchpoint_id: 'classification',
      passed: true,
      exit_class: EXIT_PASS,
      source: 'ci',
    });
  });

  it('exits 1 (quality fail) with severity_disposition=block when a block-severity regression beyond the variance band occurs', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        touchpoint_id: 'classification',
        metrics: { domain_accuracy: 0.8 },
        thresholds: {},
        registry_version: 1,
        promoted_at: '2026-06-15T00:00:00.000Z',
        promoted_by: 'bootstrap',
      },
      error: null,
    });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'run-2' },
      error: null,
    });

    const tp = touchpoint({ severity_on_fail: 'block', variance_band: 0.02 });
    // current 0.70: drop of 0.10 > variance_band 0.02 → regression → block fail.
    const result = await runEvalTouchpoint(
      supabase,
      tp,
      async () => passingSuite({ domain_accuracy: 0.7 }),
      'nightly',
    );

    expect(result.exitClass).toBe(EXIT_QUALITY_FAIL);
    expect(result.passed).toBe(false);
    expect(result.severityDisposition).toBe('block');

    const insertArg = supabase._chain.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertArg).toMatchObject({
      passed: false,
      exit_class: EXIT_QUALITY_FAIL,
      severity_disposition: 'block',
    });
  });

  it('exits 0 — NOT 1 — when a regression occurs but severity_on_fail is warn (recorded, gate still passes)', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        touchpoint_id: 'search',
        metrics: { recall: 0.9 },
        thresholds: {},
        registry_version: 1,
        promoted_at: '2026-06-15T00:00:00.000Z',
        promoted_by: 'bootstrap',
      },
      error: null,
    });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'run-3' },
      error: null,
    });

    const tp = touchpoint({
      touchpoint_id: 'search',
      suite_name: 'search',
      severity_on_fail: 'warn',
    });
    // big drop, but warn severity → recorded, gate passes (exit 0). The
    // regression is SURFACED via severity_disposition='warn', not by failing
    // the gate: `passed` is the gate verdict, which stays true for warn/info.
    const result = await runEvalTouchpoint(
      supabase,
      tp,
      async () => passingSuite({ recall: 0.5 }),
      'nightly',
    );

    expect(result.exitClass).toBe(EXIT_PASS);
    expect(result.passed).toBe(true);
    expect(result.severityDisposition).toBe('warn');

    // The eval_runs row records the warn disposition so the regression is not
    // lost: passed=true (gate ok) AND severity_disposition='warn' (regression surfaced).
    const insertArg = supabase._chain.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertArg).toMatchObject({
      passed: true,
      exit_class: EXIT_PASS,
      severity_disposition: 'warn',
    });
  });

  it('exits 2 (infra) — NOT 1 — when the suite reports a transient-provider failure (Anthropic 529)', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'run-4' },
      error: null,
    });

    const tp = touchpoint();
    const result = await runEvalTouchpoint(
      supabase,
      tp,
      async () => infraSuite('Anthropic 529 overloaded'),
      'nightly',
    );

    // Infra failure is a runner-level could-not-complete (exit 2), and is NEVER
    // counted as a quality regression (passed left null/false, never block).
    expect(result.exitClass).toBe(EXIT_RUNNER_ERROR);
    expect(result.severityDisposition).toBe('infra');

    const insertArg = supabase._chain.insert.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(insertArg).toMatchObject({
      exit_class: EXIT_RUNNER_ERROR,
      severity_disposition: 'infra',
    });
  });

  it('exits 0 with passed=true on the first run when no baseline has been promoted yet', async () => {
    const supabase = createMockSupabaseClient();
    // loadBaseline → null (no baseline).
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    supabase._chain.single.mockResolvedValueOnce({
      data: { id: 'run-5' },
      error: null,
    });

    const tp = touchpoint();
    const result = await runEvalTouchpoint(
      supabase,
      tp,
      async () => passingSuite({ domain_accuracy: 0.5 }),
      'manual',
    );

    expect(result.exitClass).toBe(EXIT_PASS);
    expect(result.passed).toBe(true);
  });

  it('exits 2 (runner error) when the eval_runs write itself fails (DB unreachable)', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    // eval_runs insert fails.
    supabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused', code: 'NETWORK_ERROR' },
    });

    const tp = touchpoint();
    const result = await runEvalTouchpoint(
      supabase,
      tp,
      async () => passingSuite({ domain_accuracy: 0.9 }),
      'ci',
    );

    expect(result.exitClass).toBe(EXIT_RUNNER_ERROR);
  });
});

// ---------------------------------------------------------------------------
// runEvals — central dispatcher over scope (no process.exit)
// ---------------------------------------------------------------------------

describe('runEvals', () => {
  it('dispatches every registered touchpoint and folds an aggregate EXIT_PASS when all pass', async () => {
    const supabase = createMockSupabaseClient();
    // listTouchpoints → two registered touchpoints.
    supabase._chain.order.mockReturnValueOnce(
      Promise.resolve({
        data: [
          touchpoint({
            touchpoint_id: 'classification',
            suite_name: 'classification',
          }),
          touchpoint({ touchpoint_id: 'search', suite_name: 'search' }),
        ],
        error: null,
      }) as never,
    );
    // Every loadBaseline → null (first run); every eval_runs insert → ok.
    supabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    supabase._chain.single.mockResolvedValue({
      data: { id: 'r' },
      error: null,
    });

    const report = await runEvals(supabase, {
      scope: { all: true },
      suites: {
        classification: async () => passingSuite({ domain_accuracy: 0.9 }),
        search: async () => passingSuite({ recall: 0.9 }),
      },
      source: 'nightly',
    });

    expect(report.exitClass).toBe(EXIT_PASS);
    expect(report.results).toHaveLength(2);
  });

  it('folds to EXIT_RUNNER_ERROR (2) — DISTINCT from a quality fail — for an unregistered --touchpoint', async () => {
    const supabase = createMockSupabaseClient();
    // getTouchpoint(unregistered) → maybeSingle null.
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const report = await runEvals(supabase, {
      scope: { touchpointId: 'does-not-exist' },
      suites: {},
      source: 'manual',
    });

    expect(report.exitClass).toBe(EXIT_RUNNER_ERROR);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.reason).toContain('not registered');
  });

  it('keeps quality-fail (1) and infra-error (2) DISTINCT across a mixed run — the infra error dominates the fold', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.order.mockReturnValueOnce(
      Promise.resolve({
        data: [
          touchpoint({
            touchpoint_id: 'classification',
            suite_name: 'classification',
            severity_on_fail: 'block',
          }),
          touchpoint({
            touchpoint_id: 'search',
            suite_name: 'search',
            severity_on_fail: 'block',
          }),
        ],
        error: null,
      }) as never,
    );
    // classification: baseline 0.80 then a big drop → block quality fail (exit 1).
    // search: suite reports infra (exit 2).
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: {
        touchpoint_id: 'classification',
        metrics: { domain_accuracy: 0.8 },
        thresholds: {},
        registry_version: 1,
        promoted_at: '2026-06-15T00:00:00.000Z',
        promoted_by: 'bootstrap',
      },
      error: null,
    });
    supabase._chain.single.mockResolvedValue({
      data: { id: 'r' },
      error: null,
    });

    const report = await runEvals(supabase, {
      scope: { all: true },
      suites: {
        classification: async () => passingSuite({ domain_accuracy: 0.5 }),
        search: async () => infraSuite('Anthropic 529'),
      },
      source: 'nightly',
    });

    const byId = Object.fromEntries(
      report.results.map((r) => [r.touchpointId, r]),
    );
    expect(byId.classification?.exitClass).toBe(EXIT_QUALITY_FAIL);
    expect(byId.search?.exitClass).toBe(EXIT_RUNNER_ERROR);
    // The fold takes the worst: 2 (infra) dominates 1 (quality fail).
    expect(report.exitClass).toBe(EXIT_RUNNER_ERROR);
  });

  it('exits 2 when a touchpoint references a suite_name with no registered suite fn', async () => {
    const supabase = createMockSupabaseClient();
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: touchpoint({
        touchpoint_id: 'classification',
        suite_name: 'ghost-suite',
      }),
      error: null,
    });

    const report = await runEvals(supabase, {
      scope: { touchpointId: 'classification' },
      // No suite registered for 'ghost-suite'.
      suites: {},
      source: 'manual',
    });

    expect(report.exitClass).toBe(EXIT_RUNNER_ERROR);
    expect(report.results[0]?.reason).toContain('ghost-suite');
  });
});

// ---------------------------------------------------------------------------
// flag parsing — --touchpoint <id> / --all scope selection
// ---------------------------------------------------------------------------

describe('parseRunnerArgs', () => {
  it('parses --all into an all-scope', async () => {
    const { parseRunnerArgs } = await import('@/scripts/eval-runner');
    expect(parseRunnerArgs(['--all']).scope).toEqual({ all: true });
  });

  it('parses --touchpoint <id> into a single-touchpoint scope', async () => {
    const { parseRunnerArgs } = await import('@/scripts/eval-runner');
    expect(parseRunnerArgs(['--touchpoint', 'classification']).scope).toEqual({
      touchpointId: 'classification',
    });
  });
});

// ---------------------------------------------------------------------------
// process.exit separation — the disposition value is computed without exiting
// ---------------------------------------------------------------------------

describe('exit-class purity', () => {
  it('computes the exit class as a return value — runEvals never calls process.exit', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-expect-error — stub the never-returning signature for the test.
      .mockImplementation((() => undefined) as never);

    const supabase = createMockSupabaseClient();
    supabase._chain.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await runEvals(supabase, {
      scope: { touchpointId: 'does-not-exist' },
      suites: {},
      source: 'manual',
    });

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
