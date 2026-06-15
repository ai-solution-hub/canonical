/**
 * Touchpoint-keyed regression check (T8 / B-INV-8).
 *
 * SEMANTICS PORT of `lib/eval/baseline.ts:checkRegression` (the legacy
 * metric-keyed, file-JSON regression math). The math is preserved verbatim;
 * only the KEY changes — from an opaque metric name to a touchpoint's
 * {@link AgentEvalContract}, with the contract's `variance_band` standing in
 * for the legacy `max_drop` threshold.
 *
 * The two checks are BOTH one-sided (improvement-asymmetry, phase-3 F17):
 *
 *   - `min` (optional absolute floor): `currentValue < min` → fail.
 *   - `variance_band` (max tolerated drop): `(baselineValue - currentValue) >
 *     variance_band` → fail.
 *
 * Consequences of the one-sided shape, which `Math.abs(...)` would destroy:
 *   - a drop WITHIN `±variance_band` is NOT a regression (tolerated noise);
 *   - a drop BEYOND it (the worsening direction) IS a regression;
 *   - an improvement of ANY size passes — gains are never penalised.
 *
 * NEVER use `Math.abs(...)` here: a symmetric band would flag large
 * improvements as regressions, which is the exact failure F17 guards against.
 *
 * This module is the regression SEMANTICS only. The DB-backed baseline store
 * (replacing the flat-JSON `saveBaseline`/`loadBaseline`) is rebuilt under
 * {104.11} — this file does NOT touch storage.
 */

import type { AgentEvalContract } from '@/lib/eval/contract';

/**
 * Default per-touchpoint regression tolerance when a contract does not override
 * `variance_band`. Mirrors the documented default on
 * {@link AgentEvalContract.variance_band}.
 */
export const DEFAULT_VARIANCE_BAND = 0.02;

/** Resolve the effective variance band for a touchpoint's contract. */
export function resolveVarianceBand(contract: AgentEvalContract): number {
  return contract.variance_band ?? DEFAULT_VARIANCE_BAND;
}

/** Inputs for a single touchpoint regression check. */
export interface TouchpointRegressionInput {
  /** The touchpoint's contract — supplies `variance_band` (the max tolerated drop). */
  contract: AgentEvalContract;
  /** The baseline (reference) metric value for this touchpoint. */
  baselineValue: number;
  /** The current run's metric value for this touchpoint. */
  currentValue: number;
  /**
   * Optional absolute minimum floor (ported one-sided `min` check). When set,
   * `currentValue < min` is a regression regardless of the variance band.
   */
  min?: number;
}

/** The verdict of a single touchpoint regression check. */
export interface TouchpointRegressionResult {
  /** The touchpoint this verdict belongs to. */
  touchpoint_id: string;
  baseline_value: number;
  current_value: number;
  /** The effective variance band applied (the max tolerated drop). */
  variance_band: number;
  /** Whether the touchpoint passed (true = no regression). */
  passed: boolean;
  /** Signed change: `currentValue - baselineValue` (negative = a drop). */
  delta: number;
}

/**
 * Check a single touchpoint for a regression, applying the ported one-sided
 * `min` + `max_drop` math with the contract's `variance_band` as the max drop.
 *
 * Parity guarantee: for the same `baselineValue`/`currentValue` and a legacy
 * threshold of `{ min, max_drop: variance_band }`, this returns the same
 * pass/fail verdict as `checkRegression`.
 */
export function checkTouchpointRegression(
  input: TouchpointRegressionInput,
): TouchpointRegressionResult {
  const { contract, baselineValue, currentValue, min } = input;
  const varianceBand = resolveVarianceBand(contract);
  const delta = currentValue - baselineValue;

  let passed = true;

  // Ported one-sided `min` floor: current must be >= min.
  if (min !== undefined) {
    if (currentValue < min) {
      passed = false;
    }
  }

  // Ported one-sided `max_drop`: a drop beyond the band (worsening direction)
  // is a regression; a drop within it, or any improvement, passes. The strict
  // `>` keeps the band boundary inclusive (drop === band → tolerated), matching
  // the legacy `drop > max_drop` comparison.
  const drop = baselineValue - currentValue;
  if (drop > varianceBand) {
    passed = false;
  }

  return {
    touchpoint_id: contract.touchpoint_id,
    baseline_value: baselineValue,
    current_value: currentValue,
    variance_band: varianceBand,
    passed,
    delta,
  };
}
