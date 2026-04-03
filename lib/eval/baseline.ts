/**
 * Baseline storage and regression detection for the AI evaluation framework.
 *
 * Baselines are stored as JSON files in __tests__/fixtures/eval-baselines/.
 * Each eval suite has its own baseline file containing metric values and
 * thresholds for regression detection.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import type { EvalBaseline, EvalResult, RegressionResult } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BASELINE_DIR = join(__dirname, '../../__tests__/fixtures/eval-baselines');

/**
 * Load a saved baseline for a given eval suite.
 * Returns null if no baseline file exists (first run).
 */
export function loadBaseline(suiteName: string): EvalBaseline | null {
  const filePath = join(BASELINE_DIR, `${suiteName}.baseline.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as EvalBaseline;
}

/**
 * Save a baseline for a given eval suite.
 * Creates the baselines directory if it does not exist.
 * Overwrites any existing baseline for the suite.
 */
export function saveBaseline(
  suiteName: string,
  metrics: Record<string, number>,
  thresholds: Record<string, { min?: number; max_drop?: number }>
): void {
  if (!existsSync(BASELINE_DIR)) {
    mkdirSync(BASELINE_DIR, { recursive: true });
  }

  const baseline: EvalBaseline = {
    suite_name: suiteName,
    created_at: new Date().toISOString(),
    metrics,
    thresholds,
  };

  const filePath = join(BASELINE_DIR, `${suiteName}.baseline.json`);
  writeFileSync(filePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}

/**
 * Check for regressions by comparing current metrics against a baseline.
 *
 * For each threshold:
 * - `min`: absolute minimum — current value must be >= min
 * - `max_drop`: maximum allowed drop from baseline value — (baseline - current) must be <= max_drop
 *
 * Returns a RegressionResult for each threshold checked.
 */
export function checkRegression(
  baseline: EvalBaseline,
  currentMetrics: Record<string, number>
): RegressionResult[] {
  const results: RegressionResult[] = [];

  for (const [metricName, threshold] of Object.entries(baseline.thresholds)) {
    const baselineValue = baseline.metrics[metricName] ?? 0;
    const currentValue = currentMetrics[metricName] ?? 0;
    const delta = currentValue - baselineValue;

    if (threshold.min !== undefined) {
      results.push({
        metric_name: metricName,
        baseline_value: baselineValue,
        current_value: currentValue,
        threshold: threshold.min,
        passed: currentValue >= threshold.min,
        delta,
      });
    }

    if (threshold.max_drop !== undefined) {
      const drop = baselineValue - currentValue;
      results.push({
        metric_name: metricName,
        baseline_value: baselineValue,
        current_value: currentValue,
        threshold: threshold.max_drop,
        passed: drop <= threshold.max_drop,
        delta,
      });
    }
  }

  return results;
}

/**
 * Determine whether an eval run passed overall.
 *
 * Returns true if:
 * - No baseline exists (first run — nothing to regress against)
 * - All regression checks pass
 *
 * Returns false if any regression is detected.
 */
export function evalPassed(
  result: EvalResult,
  baseline: EvalBaseline | null
): boolean {
  if (!baseline) {
    return true;
  }

  const regressions = checkRegression(baseline, result.metrics);
  return regressions.every((r) => r.passed);
}
