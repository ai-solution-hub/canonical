/**
 * ledger-normalise-oqls2.ts — reproducible, idempotent one-time normaliser for
 * the three KH workflow ledgers (OQ-LS-2, S270).
 *
 * Convergence target: **escaped non-ASCII (`\uXXXX`) + Zod-canonical key order**
 * — the conforming sole-writer format that `scripts/ledger-cli.ts`'s `serialise()`
 * now emits after the OQ-LS-2 fix. Running this script brings the on-disk files
 * byte-for-byte into that format, so future writes are minimal-diff with respect to
 * both the whole-file path (`serialise()`) and the scoped path
 * (`lib/ledger/scoped-serialise.ts` / `--scoped`).
 *
 * ── Why escaped, not raw ────────────────────────────────────────────────────────
 * The on-disk convention (task-list.json pre-existing; scoped-serialise.ts;
 * ledger-sweep-s269.ts) escapes non-ASCII to `\uXXXX`. Normalising to raw UTF-8
 * instead would cause every subsequent `scopedSerialise`/`escapeSerialise` write
 * to re-escape ~2504 em-dashes — a ~1400-line diff on the next field edit. The
 * opposite of the goal. Fix direction: make `serialise()` escape (done) and
 * converge the files on the escaped form.
 *
 * ── Semantic-identity guarantee ────────────────────────────────────────────────
 * Before writing, the script asserts an order-insensitive deep-equal of
 * JSON.parse(original) vs JSON.parse(new). Any structural diff (added/removed key,
 * changed value, type change) causes the script to THROW and write nothing.
 * A correct run has 0 structural diffs; only key order + escaping bytes change.
 *
 * Usage:
 *   bun scripts/ledger-normalise-oqls2.ts          (apply + report)
 *   bun scripts/ledger-normalise-oqls2.ts --check  (report only, no write)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { detectSchema } from '@/lib/ledger/detect-schema';
import { escapeSerialise } from '@/lib/ledger/scoped-serialise';

const LEDGERS = [
  'docs/reference/task-list.json',
  'docs/reference/product-roadmap.json',
  'docs/reference/product-backlog.json',
] as const;

// ── Order-insensitive deep-equal ──────────────────────────────────────────────

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
      `SEMANTIC DIFF detected for ${path} — normalisation would change values/keys. ` +
        `This means Zod is NOT a pure passthrough. ABORTING — nothing written.`,
    );
  }
}

// ── Per-ledger diff report ────────────────────────────────────────────────────

interface LedgerReport {
  path: string;
  changedLines: number;
  totalLines: number;
  structuralDiffs: 0; // always 0 after assertSemanticIdentity — kept as doc
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

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const checkOnly = process.argv.includes('--check');

  const reports: LedgerReport[] = [];

  for (const path of LEDGERS) {
    const originalText = readFileSync(path, 'utf8');
    const originalParsed: unknown = JSON.parse(originalText);

    const detected = detectSchema(originalParsed);
    if (detected.kind === 'unknown') {
      throw new Error(
        `${path}: detectSchema returned unknown kind. Cannot normalise.`,
      );
    }

    const newText = escapeSerialise(detected.data);
    const newParsed: unknown = JSON.parse(newText);

    // Hard-fail on any structural diff before any byte is written.
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

  // Report
  const mode = checkOnly ? '--check (no writes)' : 'APPLIED';
  console.log(`\nOQ-LS-2 ledger normalisation [${mode}]\n`);
  for (const r of reports) {
    const status = r.noopStable
      ? 'already normalised (noop)'
      : checkOnly
        ? `would change ${r.changedLines} lines`
        : `normalised — changed ${r.changedLines} lines`;
    console.log(`  ${r.path}`);
    console.log(`    changed-lines=${r.changedLines} / total-lines=${r.totalLines}`);
    console.log(`    structural-diffs=${r.structuralDiffs}`);
    console.log(`    noop-stable=${r.noopStable}`);
    console.log(`    status: ${status}\n`);
  }

  const anyChange = reports.some((r) => !r.noopStable);
  if (!anyChange) {
    console.log('All ledgers already in the normalised form. No changes.');
  } else if (checkOnly) {
    console.log('Run without --check to apply normalisation.');
  } else {
    console.log(
      'Done. Run `bash scripts/regen-mirrors.sh` if mirrors need refreshing.',
    );
  }
}

main();
