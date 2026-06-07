/**
 * Guarded `gitnexus analyze` wrapper — the canonical repo invocation.
 *
 *   bun run gitnexus:analyze [-- <gitnexus analyze args>]
 *
 * Why (ID-68.31, PC-21): a plain `npx gitnexus analyze` auto-rewrites the
 * GitNexus section of the tracked harness files (CLAUDE.md, AGENTS.md),
 * reintroducing live symbol/relationship/flow counts. PRODUCT Inv 21
 * (docs/specs/ID-68-repo-visibility-ip-separation/PRODUCT.md) forbids live
 * counts in harness files — they churn on every index and leak index-size
 * telemetry. The counts were stripped in S301a (9b1e5aaf), reintroduced by
 * 8d94c53d, and reintroduced again by S321's analyze run.
 *
 * What this wrapper does:
 *   1. Snapshots CLAUDE.md + AGENTS.md (content, or recorded absence).
 *   2. Runs `npx gitnexus analyze --no-stats <passthrough args>` —
 *      `--no-stats` is gitnexus's supported switch (v1.6.5,
 *      dist/cli/index.js) that omits the volatile counts from the
 *      regenerated section template.
 *   3. Restores both harness files byte-identical if the run changed,
 *      created, or deleted them (belt-and-braces over the flag: the
 *      `<!-- gitnexus:keep -->` code path updates stat lines regardless of
 *      `--no-stats`, and future gitnexus versions may change flag handling).
 *   4. Exits with the analyze exit code; restores happen even on failure.
 *
 * Defence-in-depth companion: a `<!-- gitnexus:keep -->` marker inside the
 * harness files' gitnexus section makes the plain (unwrapped) invocation
 * inert too — gitnexus's keep-path stats regex is line-start anchored and
 * never matches the "This project is indexed by GitNexus as ..." line, so
 * upsert returns 'preserved' with zero writes.
 *
 * Exported functions are pure-ish seams for the Vitest suite
 * (__tests__/scripts/gitnexus-analyze.test.ts); the real gitnexus binary is
 * never spawned in tests.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The tracked harness files gitnexus analyze injects its section into. */
export const HARNESS_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;

export interface HarnessSnapshot {
  /** Repo-root-relative filename. */
  file: string;
  /** Whether the file existed pre-run. */
  existed: boolean;
  /** Pre-run content, or null when the file did not exist. */
  content: string | null;
}

/**
 * Build the argv tail for the analyze invocation, always carrying
 * `--no-stats` exactly once ahead of any passthrough args.
 */
export function buildAnalyzeArgs(passthroughArgs: string[]): string[] {
  const passthrough = passthroughArgs.filter((arg) => arg !== '--no-stats');
  return ['analyze', '--no-stats', ...passthrough];
}

/** Capture the pre-run state of every harness file. */
export function snapshotHarnessFiles(repoRoot: string): HarnessSnapshot[] {
  return HARNESS_FILES.map((file) => {
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(filePath)) {
      return { file, existed: false, content: null };
    }
    return { file, existed: true, content: fs.readFileSync(filePath, 'utf-8') };
  });
}

/**
 * Restore every harness file to its snapshotted state. Returns the list of
 * files that had drifted (and were restored). Byte-identical semantics:
 * mutated files are rewritten, run-created files are deleted, run-deleted
 * files are re-created.
 */
export function restoreHarnessFiles(
  repoRoot: string,
  snapshots: HarnessSnapshot[],
): string[] {
  const restored: string[] = [];
  for (const snapshot of snapshots) {
    const filePath = path.join(repoRoot, snapshot.file);
    const existsNow = fs.existsSync(filePath);
    if (!snapshot.existed) {
      if (existsNow) {
        fs.rmSync(filePath);
        restored.push(snapshot.file);
      }
      continue;
    }
    const currentContent = existsNow
      ? fs.readFileSync(filePath, 'utf-8')
      : null;
    if (currentContent !== snapshot.content) {
      fs.writeFileSync(filePath, snapshot.content as string, 'utf-8');
      restored.push(snapshot.file);
    }
  }
  return restored;
}

export interface GuardedAnalyzeOptions {
  /** Directory containing the harness files; also the spawn cwd. */
  repoRoot: string;
  /** Extra args forwarded to `gitnexus analyze`. */
  passthroughArgs: string[];
  /**
   * Full argv override (test seam). Defaults to
   * `['npx', 'gitnexus', ...buildAnalyzeArgs(passthroughArgs)]`.
   */
  command?: string[];
}

export interface GuardedAnalyzeResult {
  /** Exit code of the analyze process (passed through). */
  exitCode: number;
  /** Harness files that drifted during the run and were restored. */
  restored: string[];
}

/** Snapshot → run analyze → restore. Restores even when the run fails. */
export function runGuardedAnalyze(
  options: GuardedAnalyzeOptions,
): GuardedAnalyzeResult {
  const { repoRoot, passthroughArgs } = options;
  const argv = options.command ?? [
    'npx',
    'gitnexus',
    ...buildAnalyzeArgs(passthroughArgs),
  ];

  const snapshots = snapshotHarnessFiles(repoRoot);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  const restored = restoreHarnessFiles(repoRoot, snapshots);

  if (result.error) {
    throw result.error;
  }
  return { exitCode: result.status ?? 1, restored };
}

function main(): void {
  const repoRoot = process.cwd();
  const passthroughArgs = process.argv.slice(2);
  const { exitCode, restored } = runGuardedAnalyze({
    repoRoot,
    passthroughArgs,
  });

  if (restored.length > 0) {
    console.log(
      `[gitnexus-analyze] Restored harness file(s) rewritten by analyze: ${restored.join(', ')} ` +
        '(PRODUCT Inv 21 — no live counts in harness files).',
    );
  } else {
    console.log('[gitnexus-analyze] Harness files unchanged by analyze run.');
  }
  process.exit(exitCode);
}

if (import.meta.main) {
  main();
}
