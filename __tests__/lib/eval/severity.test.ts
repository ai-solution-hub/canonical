import { describe, it, expect } from 'vitest';

import {
  disposition,
  type SeverityResult,
  type RunDisposition,
} from '@/lib/eval/severity';

// ──────────────────────────────────────────
// severity → runner exit disposition — ID-104 §Area B / T6, T7 / B-INV-6, B-INV-7
// disposition(results) folds the WORST SeverityTier across a run into an exit
// class the eval-runner (T10) consumes. The 4-tier model (block|warn|info|infra)
// is canonical and supersedes the historic 3-tier draft.
//
// Behaviour-first (test-philosophy.md): we assert the OBSERVABLE gate decision —
// does the run fail the gate, and is a transient-provider failure recorded as
// infrastructure noise rather than counted as a quality regression.
// ──────────────────────────────────────────

/** Convenience: build a failing/triggered result carrying a severity tier. */
function r(severity: SeverityResult['severity']): SeverityResult {
  return { severity };
}

describe('disposition — worst-severity fold', () => {
  it('a single block regression fails the gate (exit-1 contribution)', () => {
    const d: RunDisposition = disposition([r('info'), r('block'), r('warn')]);

    expect(d.worst).toBe('block');
    expect(d.gateFailed).toBe(true);
    expect(d.exitClass).toBe(1);
  });

  it('block dominates regardless of ordering or other tiers present', () => {
    expect(disposition([r('block'), r('infra')]).gateFailed).toBe(true);
    expect(disposition([r('warn'), r('info'), r('block')]).worst).toBe('block');
  });
});

describe('disposition — warn / info are recorded but pass', () => {
  it('warn alone is recorded-but-pass', () => {
    const d = disposition([r('warn')]);

    expect(d.worst).toBe('warn');
    expect(d.gateFailed).toBe(false);
    expect(d.exitClass).toBe(0);
  });

  it('info alone is recorded-but-pass', () => {
    const d = disposition([r('info')]);

    expect(d.gateFailed).toBe(false);
    expect(d.exitClass).toBe(0);
  });

  it('warn outranks info in the worst-of fold but still passes', () => {
    const d = disposition([r('info'), r('warn'), r('info')]);

    expect(d.worst).toBe('warn');
    expect(d.gateFailed).toBe(false);
  });
});

describe('disposition — infra is infrastructure noise, never a quality regression', () => {
  it('a 529 classified infra does NOT fail the gate and is not a regression', () => {
    const d = disposition([r('infra')]);

    expect(d.worst).toBe('infra');
    expect(d.gateFailed).toBe(false);
    expect(d.exitClass).toBe(0);
    expect(d.qualityRegression).toBe(false);
  });

  it('infra alongside warn/info still passes (no block present)', () => {
    const d = disposition([r('infra'), r('warn'), r('info')]);

    expect(d.gateFailed).toBe(false);
    expect(d.qualityRegression).toBe(false);
  });

  it('infra is NEVER counted as a quality regression even when it is the worst tier', () => {
    // worst tier is infra, but a transient-provider failure must not be a regression
    expect(disposition([r('infra'), r('infra')]).qualityRegression).toBe(false);
  });

  it('a block present alongside infra IS a quality regression', () => {
    const d = disposition([r('infra'), r('block')]);

    expect(d.gateFailed).toBe(true);
    expect(d.qualityRegression).toBe(true);
  });
});

describe('disposition — empty run', () => {
  it('an empty result set passes (nothing triggered)', () => {
    const d = disposition([]);

    expect(d.worst).toBeNull();
    expect(d.gateFailed).toBe(false);
    expect(d.exitClass).toBe(0);
    expect(d.qualityRegression).toBe(false);
  });
});
