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
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${result.suite_name} — ${status}`);
  console.log(`  ${result.timestamp}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total items: ${result.total_items}`);
  console.log(`${'─'.repeat(60)}`);

  // Metrics table
  for (const [name, value] of Object.entries(result.metrics)) {
    const formatted = formatMetricName(name);
    const valueStr = typeof value === 'number' ? value.toFixed(4) : String(value);

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
    console.log(`${'─'.repeat(60)}`);
    console.log(`  Failures (${result.failures.length}):`);
    for (const failure of result.failures) {
      console.log(`    - ${failure}`);
    }
  }

  // Regression details
  if (regressions && regressions.some((r) => !r.passed)) {
    console.log(`${'─'.repeat(60)}`);
    console.log('  Regressions detected:');
    for (const reg of regressions.filter((r) => !r.passed)) {
      const name = formatMetricName(reg.metric_name);
      console.log(
        `    ${name}: ${reg.baseline_value.toFixed(4)} → ${reg.current_value.toFixed(4)} (delta: ${reg.delta.toFixed(4)}, threshold: ${reg.threshold.toFixed(4)})`
      );
    }
  }

  console.log(`${'═'.repeat(60)}\n`);
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
