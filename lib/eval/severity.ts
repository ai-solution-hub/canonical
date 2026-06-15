/**
 * Severity → runner exit disposition — ID-104 §Area B / T6, T7 / B-INV-6, B-INV-7.
 *
 * `disposition(results)` folds the WORST {@link SeverityTier} across an eval run
 * into the exit class the central `eval-runner` (T9/T10) consumes:
 *
 *   - a single `block` regression  → gate fail (contributes exit class 1);
 *   - `warn` / `info`              → recorded + surfaced, the gate still PASSES;
 *   - `infra` (transient-provider 529 / timeout / 503) → recorded as
 *     infrastructure noise, does NOT fail the gate and is NEVER counted as a
 *     quality regression.
 *
 * The 4-tier model (`block | warn | info | infra`) imported from
 * `@/lib/eval/contract` is canonical; it supersedes the historic 3-tier draft
 * (`block | warn | info`) that `lib/eval/types.ts` never shipped (B-INV-6).
 *
 * DISTINCT from `scripts/quality-gate.ts:severityFor` — that is the CONTENT
 * quality-gate severity mapper, a separate surface. Do NOT conflate or import it.
 *
 * Note on exit class: this fold yields exit class `0` (pass) or `1` (≥1 `block`
 * regression). Exit class `2` (runner crash / DB-unreachable / unregistered
 * touchpoint) is the runner's own determination (T10) and is intentionally NOT
 * derivable from severity alone — an `infra`-classified provider failure with no
 * other failures still exits `0` per T7.
 */

import type { SeverityTier } from '@/lib/eval/contract';

/**
 * A single triggered/failing eval result carrying the severity tier that applies
 * to it. Passing touchpoints contribute no result (severity only applies on fail).
 */
export interface SeverityResult {
  severity: SeverityTier;
}

/** The folded, runner-consumable disposition for a whole run. */
export interface RunDisposition {
  /** The worst severity tier present across the run, or `null` for an empty run. */
  worst: SeverityTier | null;
  /** True when at least one `block`-severity regression is present. */
  gateFailed: boolean;
  /**
   * True only when a real quality regression is present (a `block` tier).
   * `infra` failures are infrastructure noise and are NEVER a quality regression.
   */
  qualityRegression: boolean;
  /** Exit class contribution: `1` when the gate failed, otherwise `0`. */
  exitClass: 0 | 1;
}

/**
 * Severity ordering for the worst-of fold. Higher rank = worse. `infra` outranks
 * `warn`/`info` so it surfaces as the worst tier for reporting, but it carries no
 * gate-failing or regression weight (see {@link disposition}).
 */
const SEVERITY_RANK: Record<SeverityTier, number> = {
  info: 0,
  warn: 1,
  infra: 2,
  block: 3,
};

/**
 * Fold the worst {@link SeverityTier} across a run into a runner exit disposition.
 *
 * @param results The triggered/failing results, each carrying its severity tier.
 * @returns The {@link RunDisposition} the `eval-runner` (T10) branches on.
 */
export function disposition(
  results: readonly SeverityResult[],
): RunDisposition {
  let worst: SeverityTier | null = null;

  for (const { severity } of results) {
    if (worst === null || SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) {
      worst = severity;
    }
  }

  // Only a `block` tier fails the gate / counts as a quality regression.
  // `infra` is transient-provider noise; `warn` / `info` are recorded-but-pass.
  const gateFailed = results.some((result) => result.severity === 'block');

  return {
    worst,
    gateFailed,
    qualityRegression: gateFailed,
    exitClass: gateFailed ? 1 : 0,
  };
}
