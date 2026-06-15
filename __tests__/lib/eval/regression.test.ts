/**
 * Tests for the touchpoint-keyed regression check (T8 / B-INV-8).
 *
 * Behaviour-first per test-philosophy.md: we assert the regression VERDICT
 * (pass / fail) and the parity with the legacy `checkRegression` math — not the
 * internal control flow. The improvement-asymmetry (F17) is the load-bearing
 * property: a drop beyond the variance band fails, a drop within it passes, and
 * an improvement of ANY magnitude passes.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VARIANCE_BAND,
  resolveVarianceBand,
  checkTouchpointRegression,
} from '@/lib/eval/regression';
import { checkRegression } from '@/lib/eval/baseline';
import type { AgentEvalContract } from '@/lib/eval/contract';
import type { EvalBaseline } from '@/lib/eval/types';

/** Minimal contract factory — only `variance_band` is load-bearing here. */
function contract(
  overrides: Partial<AgentEvalContract> = {},
): AgentEvalContract {
  return {
    touchpoint_id: 'tp-test',
    kind: 'tool',
    owner: 'eval-team',
    suite_name: 'l1',
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: DEFAULT_VARIANCE_BAND,
    ...overrides,
  };
}

describe('resolveVarianceBand', () => {
  it('defaults to 0.02 when the contract does not override', () => {
    expect(resolveVarianceBand(contract())).toBe(0.02);
    expect(DEFAULT_VARIANCE_BAND).toBe(0.02);
  });

  it('uses the contract band when the contract overrides it', () => {
    expect(resolveVarianceBand(contract({ variance_band: 0.1 }))).toBe(0.1);
  });

  it('honours an explicit zero band (no tolerance, not the default)', () => {
    expect(resolveVarianceBand(contract({ variance_band: 0 }))).toBe(0);
  });
});

describe('checkTouchpointRegression — improvement-asymmetry (F17)', () => {
  it('passes when the drop is within the variance band', () => {
    // baseline 0.90, current 0.885 → drop 0.015 < band 0.02 → tolerated.
    const result = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.9,
      currentValue: 0.885,
    });
    expect(result.passed).toBe(true);
  });

  it('fails when the drop is beyond the variance band', () => {
    // baseline 0.90, current 0.85 → drop 0.05 > band 0.02 → regression.
    const result = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.9,
      currentValue: 0.85,
    });
    expect(result.passed).toBe(false);
  });

  it('passes for an improvement of any size (asymmetry — never Math.abs)', () => {
    // A large positive delta must NOT be treated as a regression.
    const small = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.9,
      currentValue: 0.905,
    });
    const huge = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.1,
      currentValue: 0.99,
    });
    expect(small.passed).toBe(true);
    expect(huge.passed).toBe(true);
  });

  it('passes for a drop exactly equal to the band (boundary is inclusive)', () => {
    // (baseline - current) === band → NOT a regression (matches legacy
    // `drop > max_drop` strict inequality). Integer-scale values are used so
    // the boundary is exactly representable in IEEE-754 — sub-unit decimals
    // (e.g. 0.9 - 0.85) round to just above their nominal difference and would
    // make this test about float rounding rather than the inclusive boundary.
    const result = checkTouchpointRegression({
      contract: contract({ variance_band: 1 }),
      baselineValue: 5,
      currentValue: 4,
    });
    expect(result.passed).toBe(true);
  });

  it('reports the signed delta (negative for a drop, positive for a gain)', () => {
    const drop = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.9,
      currentValue: 0.8,
    });
    const gain = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.8,
      currentValue: 0.9,
    });
    expect(drop.delta).toBeCloseTo(-0.1, 10);
    expect(gain.delta).toBeCloseTo(0.1, 10);
  });
});

describe('checkTouchpointRegression — optional `min` floor (ported one-sided)', () => {
  it('fails when the current value is below the absolute minimum floor', () => {
    const result = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.9,
      currentValue: 0.895, // within band, but below the 0.9 floor
      min: 0.9,
    });
    expect(result.passed).toBe(false);
  });

  it('passes when the current value meets the minimum floor and stays in band', () => {
    const result = checkTouchpointRegression({
      contract: contract(),
      baselineValue: 0.9,
      currentValue: 0.9,
      min: 0.9,
    });
    expect(result.passed).toBe(true);
  });
});

describe('parity with legacy checkRegression (PARITY proof)', () => {
  /**
   * The new touchpoint check, with `variance_band` standing in for `max_drop`
   * and an optional `min`, must produce the same pass/fail verdict as the
   * ported legacy `checkRegression` on identical inputs.
   */
  function legacyVerdict(
    baselineValue: number,
    currentValue: number,
    threshold: { min?: number; max_drop?: number },
  ): boolean {
    const baseline: EvalBaseline = {
      suite_name: 'l1',
      created_at: '2026-01-01T00:00:00.000Z',
      metrics: { m: baselineValue },
      thresholds: { m: threshold },
    };
    return checkRegression(baseline, { m: currentValue })[0].passed;
  }

  const cases: Array<{
    baseline: number;
    current: number;
    band: number;
    min?: number;
  }> = [
    { baseline: 0.9, current: 0.885, band: 0.02 }, // within band
    { baseline: 0.9, current: 0.85, band: 0.02 }, // beyond band
    { baseline: 0.9, current: 0.85, band: 0.05 }, // near band (float artefact: drop > band)
    { baseline: 5, current: 4, band: 1 }, // exactly band (integer-exact boundary)
    { baseline: 0.1, current: 0.99, band: 0.02 }, // big improvement
    { baseline: 0.9, current: 0.905, band: 0.02 }, // small improvement
    { baseline: 0.9, current: 0.895, band: 0.02, min: 0.9 }, // min floor breach
    { baseline: 0.9, current: 0.9, band: 0.02, min: 0.9 }, // min floor met
    { baseline: 0.5, current: 0.3, band: 0.02, min: 0.4 }, // both checks fail
  ];

  it.each(cases)(
    'matches legacy verdict for baseline=$baseline current=$current band=$band min=$min',
    ({ baseline, current, band, min }) => {
      const ported = checkTouchpointRegression({
        contract: contract({ variance_band: band }),
        baselineValue: baseline,
        currentValue: current,
        min,
      }).passed;

      const legacy = legacyVerdict(baseline, current, {
        max_drop: band,
        ...(min !== undefined ? { min } : {}),
      });

      expect(ported).toBe(legacy);
    },
  );
});
