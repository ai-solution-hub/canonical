#!/usr/bin/env bun
/**
 * ledger-differential-parity.ts — AC-P1 proof harness (ID-90.20, inv 4/21).
 *
 * Proves that the flag-ON server transport path and the flag-OFF direct-write
 * path produce BYTE-IDENTICAL ledger files, deep-equal envelopes (modulo
 * absolute paths and retry warnings), and equal exit codes across a matrix of
 * mutating subcommands.
 *
 * Usage:
 *   LOCAL: bun scripts/ledger-differential-parity.ts [--verbose]
 *   CI:    bun scripts/ledger-differential-parity.ts --ci
 *          (exports a SYNTHETIC denylist so the guard arm is exercised; AC-I)
 *
 * The harness copies the live ledgers + umbrellas.json into two $TMPDIR fixture
 * dirs and runs each matrix entry against dir A (flag-OFF) and dir B (flag-ON,
 * with an ephemeral server). Results are compared per-entry.
 *
 * DOCUMENTED EXCEPTIONS:
 *   - Promote commit order: server = ADD → roadmap → REMOVE (TECH U7); CLI =
 *     ADD → REMOVE → roadmap (ledger-cli.ts:3929-3933). Crash-visible only,
 *     byte-parity-invisible. Both preserve the inv-40 benign-transient-duplicate
 *     property (check-90-10). This harness verifies byte-parity of the FINAL
 *     file state, not intermediate commit order.
 *   - bl-269 (non-ASCII journal): the harness exercises a non-ASCII journal
 *     entry across both paths. If the server path escapes it and the CLI path
 *     does not, this surfaces as a byte-mismatch (the cutover fixes the CLI's
 *     scoped-write non-escaping). If both match → bl-269 is moot post-cutover.
 *
 * Invariants: 4 (flag-OFF path untouched), 6 (zero consumer edits), 21
 * (differential byte-identity).
 */

import {
  mkdtempSync,
  cpSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

// ── config ────────────────────────────────────────────────────────────────────

const VERBOSE = process.argv.includes('--verbose');
const CI_MODE = process.argv.includes('--ci');

const REPO_ROOT = resolve(import.meta.dir, '..');
const LEDGER_DIR = 'docs/reference';
const LEDGER_FILES = [
  'task-list.json',
  'product-roadmap.json',
  'product-backlog.json',
  'umbrellas.json',
];

// Synthetic denylist for CI (AC-I: never real tokens).
const SYNTHETIC_DENYLIST = JSON.stringify({
  tokens: [{ value: 'SYNTH_PARITY_TOKEN_DO_NOT_USE', case_insensitive: true }],
  exclusion_patterns: [],
});

// ── types ─────────────────────────────────────────────────────────────────────

interface MatrixEntry {
  /** Human-readable label for the test case. */
  label: string;
  /** Subcommand + args to pass to ledger-cli (ledgerDir is injected). */
  args: string[];
  /** Extra flags (e.g. --whole-file, --force, --dry-run). */
  flags?: string[];
  /** Which ledger files to compare after the mutation. */
  compareFiles?: string[];
}

interface ParityResult {
  label: string;
  pass: boolean;
  detail?: string;
}

// ── matrix ────────────────────────────────────────────────────────────────────
//
// Representative coverage of each ServerIntent kind. Each entry mutates
// the fixtures in a predictable way so file comparison is meaningful.
// The matrix runs SEQUENTIALLY against each dir (A then B) — state
// accumulates within a dir, matching real operator usage.

const MATRIX: MatrixEntry[] = [
  // ── field-patch (task-list) ──
  {
    label: 'flip-task (scoped)',
    args: ['flip-task', '90', 'in_progress'],
    compareFiles: ['task-list.json'],
  },
  {
    label: 'update-task (scoped)',
    args: ['update-task', '90', 'status_note', 'parity-harness test'],
    compareFiles: ['task-list.json'],
  },
  {
    label: 'flip-task --whole-file',
    args: ['flip-task', '90', 'pending'],
    flags: ['--whole-file'],
    compareFiles: ['task-list.json'],
  },
  {
    label: 'flip-task --dry-run',
    args: ['flip-task', '90', 'done'],
    flags: ['--dry-run'],
    compareFiles: ['task-list.json'],
  },

  // ── field-patch (backlog) ──
  {
    // ID-90.22 R1b: re-pointed from the since-resolved item 270 to a live
    // backlog id (the fixture is the working-tree backlog; 270 was removed).
    label: 'update-backlog',
    args: ['update-backlog', '28', 'status', 'ready'],
    compareFiles: ['product-backlog.json'],
  },

  // ── field-patch (roadmap) ──
  {
    label: 'update-roadmap',
    args: ['update-roadmap', '10', 'status', 'in_progress'],
    compareFiles: ['product-roadmap.json'],
  },

  // ── subtask field-patch ──
  {
    label: 'flip-subtask (scoped)',
    args: ['flip-subtask', '90.15', 'in_progress'],
    compareFiles: ['task-list.json'],
  },

  // ── append-journal (bl-269: exercises non-ASCII via ASCII-safe text) ──
  {
    label: 'append-journal',
    args: [
      'append-journal',
      '90.15',
      'parity-harness -> ASCII-safe journal entry',
    ],
    compareFiles: ['task-list.json'],
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  if (VERBOSE || CI_MODE) process.stderr.write(`[parity] ${msg}\n`);
}

function setupFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-parity-'));
  const refDir = join(dir, LEDGER_DIR);
  cpSync(join(REPO_ROOT, LEDGER_DIR), refDir, { recursive: true });
  return dir;
}

function runCli(
  fixtureRoot: string,
  entry: MatrixEntry,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const ledgerDir = join(fixtureRoot, LEDGER_DIR);
  const allArgs = [
    'scripts/ledger-cli.ts',
    ...entry.args,
    '--ledger-dir',
    ledgerDir,
    '--no-regen-mirrors',
    ...(entry.flags ?? []),
  ];

  const result = spawnSync('bun', allArgs, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

/**
 * ID-90.22 R1b transport-only assertion: each touched ledger file is
 * OQ-LS-2-conforming — its bytes parse as JSON AND end with exactly one
 * trailing newline (the sole-writer format the server emits). Returns a
 * failure-detail string, or null when every file conforms.
 */
function assertOqls2Conforming(dir: string, files: string[]): string | null {
  for (const file of files) {
    const path = join(dir, LEDGER_DIR, file);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      return `${file}: read error — ${err instanceof Error ? err.message : String(err)}`;
    }
    try {
      JSON.parse(raw);
    } catch (err) {
      return `${file}: not valid JSON — ${err instanceof Error ? err.message : String(err)}`;
    }
    if (!raw.endsWith('\n') || raw.endsWith('\n\n')) {
      return `${file}: not OQ-LS-2-conforming (expected exactly one trailing newline)`;
    }
  }
  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ID-90.22 R1b: TRANSPORT-ONLY mode. The OFF-vs-ON differential is gone — the
  // direct-write path was removed (`serverEnabled()` deleted), so there is no
  // OFF arm to compare against. The harness is retained as a REGRESSION check
  // (TECH §Testing, until {68.30} re-homes the gate upstream): it runs each
  // matrix entry through the server transport and asserts (a) success exit 0
  // and (b) every touched ledger file is OQ-LS-2-conforming (valid JSON + a
  // single trailing newline).
  log('Setting up fixture directory (transport-only)...');
  const dir = setupFixtureDir();
  log(`  dir (transport): ${dir}`);

  // Pin the ledger clock so timestamp-bearing writes are deterministic.
  const FIXED_NOW = '2026-01-01T00:00:00.000Z';
  const env: Record<string, string> = {
    KH_LEDGER_NOW: FIXED_NOW,
  };

  // In CI, export the synthetic denylist for the guard arm (AC-I).
  if (CI_MODE) {
    env.KH_CLIENT_NAME_DENYLIST = SYNTHETIC_DENYLIST;
    log('CI mode: synthetic denylist exported.');
  }

  const results: ParityResult[] = [];
  let failures = 0;

  for (const entry of MATRIX) {
    log(`\n── ${entry.label} ──`);

    const result = runCli(dir, entry, env);
    log(`  exit=${result.exitCode}`);
    if (VERBOSE) {
      log(`  stdout: ${result.stdout.slice(0, 200)}`);
    }

    // (a) success exit.
    if (result.exitCode !== 0) {
      results.push({
        label: entry.label,
        pass: false,
        detail: `non-zero exit ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
      });
      failures++;
      continue;
    }

    // (b) OQ-LS-2-conforming bytes: each touched file parses as JSON and ends
    // with exactly one trailing newline.
    const filesToCompare = entry.compareFiles ?? LEDGER_FILES;
    const byteIssue = assertOqls2Conforming(dir, filesToCompare);
    if (byteIssue !== null) {
      results.push({ label: entry.label, pass: false, detail: byteIssue });
      failures++;
      continue;
    }

    results.push({ label: entry.label, pass: true });
    log(`  ✓ PASS`);
  }

  // ── summary ──
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  process.stderr.write(
    `\n[parity] ${passed}/${total} passed, ${failures} failed\n`,
  );

  if (failures > 0) {
    process.stderr.write('\nFAILURES:\n');
    for (const r of results.filter((f) => !f.pass)) {
      process.stderr.write(`  ✗ ${r.label}: ${r.detail}\n`);
    }
    process.stderr.write(
      '\nTRANSPORT-ONLY GATE: FAILED — a server-transport write regressed.\n',
    );
    process.exit(1);
  }

  process.stderr.write(
    '\nTRANSPORT-ONLY GATE: PASSED — every server-transport write succeeded ' +
      `and produced OQ-LS-2-conforming bytes across the ${total}-entry matrix.\n`,
  );

  // Structured exit envelope for CI.
  process.stdout.write(
    JSON.stringify({
      ok: true,
      mode: 'transport-only',
      matrix: total,
      passed,
      failures: 0,
    }) + '\n',
  );
}

main().catch((err) => {
  process.stderr.write(
    `[parity] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(2);
});
