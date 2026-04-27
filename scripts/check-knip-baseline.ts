/**
 * Knip baseline guard — invoked by .github/workflows/ci.yml.
 *
 * Runs `bun run knip --reporter json`, sums per-category counts across all
 * files, and compares against `.knip-baseline.json`. Fails the build if any
 * current count exceeds the baseline.
 *
 * Counts-only strategy (rather than per-file snapshot): the current 314
 * findings would yield a noisy + brittle JSON snapshot. Counts catch
 * regressions (new unused export added in a PR) without forcing churn when
 * intentional refactors move existing findings between files.
 *
 * Re-baseline: when a deliberate cleanup reduces counts, run this script
 * locally to print the new totals, then update `.knip-baseline.json` in a
 * dedicated commit so the lower threshold is locked in. Procedure documented
 * in `docs/runbooks/ci.md` §6.
 *
 * Exit codes:
 *   0 = at-or-below baseline (PR may merge)
 *   1 = exceeds baseline (PR blocked) or knip itself errored
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type CountKey =
  | 'dependencies'
  | 'devDependencies'
  | 'exports'
  | 'types'
  | 'unlisted'
  | 'binaries'
  | 'duplicates'
  | 'files'
  | 'enumMembers'
  | 'unresolved';

interface Baseline {
  counts: Record<CountKey, number>;
}

interface KnipFileEntry {
  file: string;
  dependencies?: unknown[];
  devDependencies?: unknown[];
  exports?: unknown[];
  types?: unknown[];
  unlisted?: unknown[];
  binaries?: unknown[];
  duplicates?: unknown[];
  files?: unknown[];
  enumMembers?: unknown[];
  unresolved?: unknown[];
}

interface KnipReport {
  issues: KnipFileEntry[];
}

const COUNT_KEYS: CountKey[] = [
  'dependencies',
  'devDependencies',
  'exports',
  'types',
  'unlisted',
  'binaries',
  'duplicates',
  'files',
  'enumMembers',
  'unresolved',
];

function loadBaseline(): Baseline {
  const path = join(process.cwd(), '.knip-baseline.json');
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Baseline;
  if (!parsed.counts) {
    throw new Error(
      `.knip-baseline.json is missing "counts" — file may be corrupt`,
    );
  }
  return parsed;
}

function runKnip(): KnipReport {
  // `bun run knip --reporter json` exits non-zero whenever knip finds
  // anything (which is always, by design — we have a non-empty baseline).
  // We only treat it as a hard failure if no parseable JSON came back.
  const result = spawnSync('bun', ['run', 'knip', '--reporter', 'json'], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout ?? '';
  const start = stdout.indexOf('{');
  if (start === -1) {
    process.stderr.write(
      `knip produced no JSON. stderr:\n${result.stderr ?? '(empty)'}\n`,
    );
    process.exit(1);
  }
  try {
    return JSON.parse(stdout.slice(start)) as KnipReport;
  } catch (err) {
    process.stderr.write(
      `Failed to parse knip JSON output: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }
}

function tallyCounts(report: KnipReport): Record<CountKey, number> {
  const totals = Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as Record<
    CountKey,
    number
  >;
  for (const file of report.issues) {
    for (const key of COUNT_KEYS) {
      const arr = file[key];
      if (Array.isArray(arr)) totals[key] += arr.length;
    }
  }
  return totals;
}

function main(): void {
  const baseline = loadBaseline();
  const report = runKnip();
  const current = tallyCounts(report);

  const breaches: Array<{
    category: CountKey;
    baseline: number;
    current: number;
    delta: number;
  }> = [];
  const reductions: Array<{
    category: CountKey;
    baseline: number;
    current: number;
  }> = [];

  for (const key of COUNT_KEYS) {
    const base = baseline.counts[key] ?? 0;
    const cur = current[key];
    if (cur > base) {
      breaches.push({
        category: key,
        baseline: base,
        current: cur,
        delta: cur - base,
      });
    } else if (cur < base) {
      reductions.push({ category: key, baseline: base, current: cur });
    }
  }

  // Always print the comparison table so CI logs make the state legible.
  process.stdout.write('\nKnip baseline comparison\n');
  process.stdout.write('========================\n');
  for (const key of COUNT_KEYS) {
    const base = baseline.counts[key] ?? 0;
    const cur = current[key];
    const marker = cur > base ? 'FAIL' : cur < base ? 'DROP' : 'OK  ';
    process.stdout.write(
      `  [${marker}] ${key.padEnd(18)} baseline=${String(base).padStart(4)}  current=${String(cur).padStart(4)}\n`,
    );
  }

  if (reductions.length > 0) {
    process.stdout.write(
      '\nReductions detected — consider re-baselining (see docs/runbooks/ci.md §6):\n',
    );
    for (const r of reductions) {
      process.stdout.write(`  ${r.category}: ${r.baseline} -> ${r.current}\n`);
    }
  }

  if (breaches.length > 0) {
    process.stderr.write('\nKnip baseline breached:\n');
    for (const b of breaches) {
      process.stderr.write(
        `  ${b.category}: baseline=${b.baseline} current=${b.current} (+${b.delta})\n`,
      );
    }
    process.stderr.write(
      '\nFix the new findings or, if intentional, raise the baseline in a separate commit.\n',
    );
    process.exit(1);
  }

  process.stdout.write('\nKnip baseline OK.\n');
}

main();
