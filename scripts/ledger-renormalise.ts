/**
 * ledger-renormalise.ts — ID-65.5 one-shot re-normaliser for the three KH
 * workflow ledgers (`docs/reference/{task-list,product-roadmap,product-backlog}.json`).
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────────
 * Rewrites each ledger via `escapeSerialise(detectSchema(text).data)` — the
 * Zod-canonical key order + escaped non-ASCII (`\uXXXX`) sole-writer format that
 * `scripts/ledger-cli.ts`'s `serialise()` and the scoped path both emit. Running it
 * brings the on-disk files byte-for-byte into that format, clearing the residual
 * drift (RESEARCH §8 — a no-op `escapeSerialise(detectSchema(text).data)` round-trip
 * still diverges by ~7 lines on the live ledgers, because the files were last
 * normalised by an earlier pass with a slightly different key order / escaping).
 *
 * ── WHEN TO RUN ─────────────────────────────────────────────────────────────────
 * A DELIBERATE, OPERATIONAL one-shot. Run it ONCE before a `--whole-file` write (or
 * before the always-whole-file `delete-subtask` / `delete-backlog`) is expected, so
 * that wide write is ALSO a minimal diff: once every record is already Zod-canonical,
 * a whole-file re-emit only changes the bytes that actually changed (e.g. the removed
 * record's lines), not ~7 incidental key-order/escaping lines scattered across the
 * file. After the one-shot, the round-trip is byte-identical (idempotent — re-running
 * is a no-op).
 *
 * It is NOT part of the per-mutation write path (`scripts/ledger-cli.ts` writes
 * minimal diffs by default already). It is the operational reset for the 7-line
 * residual.
 *
 * ── SEMANTIC-IDENTITY GUARANTEE ──────────────────────────────────────────────────
 * Before writing, the tool asserts an order-insensitive deep-equal of
 * JSON.parse(original) vs JSON.parse(new). Any structural diff (added/removed key,
 * changed value, type change) makes it THROW and write nothing. A correct run has 0
 * structural diffs; only key order + escaping bytes change. (Mirrors the precedent
 * `scripts/ledger-normalise-oqls2.ts` S270 normaliser.)
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────
 *   bun scripts/ledger-renormalise.ts                         (apply + report — real ledgers)
 *   bun scripts/ledger-renormalise.ts --check                 (report only, no write)
 *   bun scripts/ledger-renormalise.ts --ledger-dir <path>     (target a different dir — TESTS)
 *
 * SAFETY: tests MUST pass `--ledger-dir <tempDir>` (or call `renormaliseLedgers`
 * directly with a temp dir) — NEVER run this against the real `docs/reference/*.json`
 * inside a test.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectSchema } from '@/lib/ledger/detect-schema';
import { escapeSerialise } from '@/lib/ledger/scoped-serialise';

/** The three core ledger filenames, relative to the ledger dir. */
const LEDGER_FILES = [
  'task-list.json',
  'product-roadmap.json',
  'product-backlog.json',
] as const;

// ── Order-insensitive deep-equal (mirrors ledger-normalise-oqls2.ts) ──────────

function sortedJsonRepr(val: unknown): string {
  if (Array.isArray(val)) {
    return '[' + val.map(sortedJsonRepr).join(',') + ']';
  }
  if (val !== null && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + sortedJsonRepr(obj[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(val);
}

function assertSemanticIdentity(
  path: string,
  original: unknown,
  normalised: unknown,
): void {
  const origRepr = sortedJsonRepr(original);
  const newRepr = sortedJsonRepr(normalised);
  if (origRepr !== newRepr) {
    throw new Error(
      `SEMANTIC DIFF detected for ${path} — re-normalisation would change values/keys. ` +
        `This means Zod is NOT a pure passthrough. ABORTING — nothing written.`,
    );
  }
}

// ── Per-ledger diff report ────────────────────────────────────────────────────

export interface LedgerReport {
  path: string;
  changedLines: number;
  totalLines: number;
  /** Always 0 after assertSemanticIdentity — kept as documentation. */
  structuralDiffs: 0;
  /** True when the file is already byte-identical to the normalised form. */
  noopStable: boolean;
}

function diffLineCount(original: string, normalised: string): number {
  const origLines = original.split('\n');
  const newLines = normalised.split('\n');
  const maxLen = Math.max(origLines.length, newLines.length);
  let count = 0;
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== newLines[i]) count++;
  }
  return count;
}

// ── Core (exported for tests — runs against ANY ledger dir) ───────────────────

/**
 * Re-normalise the three ledgers in `ledgerDir`. Returns one {@link LedgerReport}
 * per file. When `checkOnly` is false (the default), the normalised text is written
 * to disk (skipping files already byte-stable). When true, nothing is written —
 * the report records what WOULD change. Throws (writing nothing for the offending
 * file and aborting) if any file's normalisation would alter values/keys.
 *
 * Tests drive this directly against a temp dir holding COPIES of the ledgers, so the
 * real `docs/reference/*.json` is never touched.
 */
export function renormaliseLedgers(
  ledgerDir: string,
  checkOnly = false,
): LedgerReport[] {
  const reports: LedgerReport[] = [];
  for (const file of LEDGER_FILES) {
    const path = resolve(ledgerDir, file);
    const originalText = readFileSync(path, 'utf8');
    const originalParsed: unknown = JSON.parse(originalText);

    const detected = detectSchema(originalParsed);
    if (detected.kind === 'unknown') {
      throw new Error(
        `${path}: detectSchema returned unknown kind. Cannot re-normalise.`,
      );
    }

    const newText = escapeSerialise(detected.data);
    const newParsed: unknown = JSON.parse(newText);

    // Hard-fail on any structural diff BEFORE any byte is written.
    assertSemanticIdentity(path, originalParsed, newParsed);

    const changedLines = diffLineCount(originalText, newText);
    const noopStable = newText === originalText;

    reports.push({
      path,
      changedLines,
      totalLines: originalText.split('\n').length,
      structuralDiffs: 0,
      noopStable,
    });

    if (!checkOnly && !noopStable) {
      writeFileSync(path, newText);
    }
  }
  return reports;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

function parseLedgerDir(argv: string[]): string {
  const i = argv.indexOf('--ledger-dir');
  if (i !== -1 && argv[i + 1] !== undefined) return argv[i + 1];
  return 'docs/reference';
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const ledgerDir = parseLedgerDir(process.argv);

  const reports = renormaliseLedgers(ledgerDir, checkOnly);

  const mode = checkOnly ? '--check (no writes)' : 'APPLIED';
  console.log(`\nID-65.5 ledger re-normalisation [${mode}] dir=${ledgerDir}\n`);
  for (const r of reports) {
    const status = r.noopStable
      ? 'already normalised (noop)'
      : checkOnly
        ? `would change ${r.changedLines} lines`
        : `re-normalised — changed ${r.changedLines} lines`;
    console.log(`  ${r.path}`);
    console.log(
      `    changed-lines=${r.changedLines} / total-lines=${r.totalLines}`,
    );
    console.log(`    structural-diffs=${r.structuralDiffs}`);
    console.log(`    noop-stable=${r.noopStable}`);
    console.log(`    status: ${status}\n`);
  }

  const anyChange = reports.some((r) => !r.noopStable);
  if (!anyChange) {
    console.log('All ledgers already in the normalised form. No changes.');
  } else if (checkOnly) {
    console.log('Run without --check to apply re-normalisation.');
  } else {
    console.log(
      'Done. Run `bash scripts/regen-mirrors.sh` if mirrors need refreshing.',
    );
  }
}

// Only run main() when invoked directly (not when imported by a test).
if (import.meta.main) {
  main();
}
