/**
 * Console and JSON reporting for the AI evaluation framework.
 *
 * Provides human-readable console output and machine-readable JSON
 * for CI consumption.
 */

import type { EvalResult, RegressionResult } from './types';

/** Convert snake_case metric name to Title Case */
function formatMetricName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Format a metric value as a percentage if it's in the 0-1 range, otherwise as-is */
function formatMetricValue(value: number): string {
  if (value >= 0 && value <= 1) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(4);
}

const REPORT_WIDTH = 72;

/**
 * Print a human-readable eval report to the console.
 *
 * Shows suite name, timestamp, total items, each metric with its value,
 * and regression status if a baseline comparison was performed.
 */
export function printReport(
  result: EvalResult,
  regressions?: RegressionResult[]
): void {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`\n${'='.repeat(REPORT_WIDTH)}`);
  console.log(`  ${result.suite_name} -- ${status}`);
  console.log(`  ${result.timestamp}`);
  console.log(`${'='.repeat(REPORT_WIDTH)}`);
  console.log(`  Total items: ${result.total_items}`);
  console.log(`${'-'.repeat(REPORT_WIDTH)}`);

  // Metrics table
  for (const [name, value] of Object.entries(result.metrics)) {
    const formatted = formatMetricName(name);
    const valueStr = typeof value === 'number' ? formatMetricValue(value) : String(value);

    let regressionMarker = '';
    if (regressions) {
      const related = regressions.filter((r) => r.metric_name === name);
      if (related.length > 0) {
        const allPassed = related.every((r) => r.passed);
        regressionMarker = allPassed ? '  [OK]' : '  [REGRESSION]';
      }
    }

    console.log(`  ${formatted.padEnd(30)} ${valueStr}${regressionMarker}`);
  }

  // Failures
  if (result.failures.length > 0) {
    console.log(`${'-'.repeat(REPORT_WIDTH)}`);
    console.log(`  Failures (${result.failures.length}):`);
    for (const failure of result.failures) {
      console.log(`    - ${failure}`);
    }
  }

  // Regression details
  if (regressions && regressions.some((r) => !r.passed)) {
    console.log(`${'-'.repeat(REPORT_WIDTH)}`);
    console.log('  Regressions detected:');
    for (const reg of regressions.filter((r) => !r.passed)) {
      const name = formatMetricName(reg.metric_name);
      console.log(
        `    ${name}: ${formatMetricValue(reg.baseline_value)} -> ${formatMetricValue(reg.current_value)} (delta: ${reg.delta.toFixed(4)}, threshold: ${formatMetricValue(reg.threshold)})`
      );
    }
  }

  console.log(`${'='.repeat(REPORT_WIDTH)}\n`);
}

/**
 * Print a JSON eval report to stdout for CI consumption.
 *
 * Includes the full eval result and any regression check results.
 */
export function printJsonReport(
  result: EvalResult,
  regressions?: RegressionResult[]
): void {
  const output = {
    ...result,
    regressions: regressions ?? [],
  };
  console.log(JSON.stringify(output, null, 2));
}
