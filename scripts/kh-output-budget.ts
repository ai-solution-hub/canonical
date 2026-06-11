#!/usr/bin/env bun
/**
 * kh-output-budget — tool-boundary output-budget wrapper CLI (ID-92 §A1.W).
 *
 * Spawns a wrapped command, captures its stdout/stderr/exit-code, and enforces
 * an output budget on STDOUT ONLY (stderr always passes through verbatim). When
 * stdout exceeds the budget it is truncated with a machine-visible receipt that
 * carries a ready-to-run `--full` escape re-invocation — nothing is silently
 * dropped. This is the durable form of the A1 result-size discipline, grounded
 * in the `read-turn.sh --full` truncate-default / `--full`-recover prior art.
 *
 * Invocation:
 *   bun scripts/kh-output-budget.ts [--budget <bytes>] [--full] \
 *     [--mode diff|log|generic] -- <command> [args...]
 *
 * Contract (PRODUCT §A1.W.1–A1.W.5 / TECH §A1.W):
 *   - A1.W.2 over-budget → truncate-with-receipt (truncated:true, original_length,
 *     shown, escape= the exact --full re-invocation).
 *   - A1.W.3 truncation shape: --mode diff keeps the --stat summary first then
 *     leading hunks; --mode log/generic keeps a head+tail split (60/40) so the
 *     tail (where failures surface) is never dropped — never head-only.
 *   - A1.W.4 degrade-safe: on wrapped-command failure surface the REAL exit code
 *     + stderr verbatim (no swallow — KH no-silent-failure doctrine); under-budget
 *     output passes through unchanged with no marker; opt-in only (no raw-git
 *     aliasing / global shell interception).
 *
 * Self-contained: no barrel re-exports, no shared-helper imports.
 */

import { spawnSync } from 'node:child_process';

/**
 * Default STDOUT budget in bytes. A single named constant so the value is
 * one-line auditable. ~32 KB — well under the 64K tool-output cap (A1.3),
 * leaving headroom for the receipt envelope.
 */
export const DEFAULT_BUDGET_BYTES = 32 * 1024;

/** Fraction of the budget given to the head when doing a head+tail split. */
const HEAD_FRACTION = 0.6;

/** The receipt fence/marker lines (A1.W.2). */
const RECEIPT_OPEN = '--- kh-output-budget: truncated ---';
const ELISION_MARKER = '--- kh-output-budget: … elided … ---';

export type BudgetMode = 'diff' | 'log' | 'generic';

export interface ParsedArgs {
  budget: number;
  full: boolean;
  /** Explicit --mode, or null when it should be inferred from the command. */
  mode: BudgetMode | null;
  command: string;
  args: string[];
}

/** A wrapped-command argv is `git diff …` or `git show …` → diff mode. */
function isDiffCommand(command: string, args: string[]): boolean {
  if (command !== 'git') return false;
  const sub = args[0];
  return sub === 'diff' || sub === 'show';
}

/**
 * Resolve the effective mode: an explicit --mode wins; otherwise infer `diff`
 * for `git diff`/`git show`, else `generic`. The inference is a small allowlist,
 * not a general parser (TECH §A1.W.3 "--mode defaulting").
 */
export function resolveMode(
  explicit: BudgetMode | null,
  command: string,
  args: string[],
): BudgetMode {
  if (explicit) return explicit;
  return isDiffCommand(command, args) ? 'diff' : 'generic';
}

/**
 * Parse the wrapper argv (everything after the script name). Throws a usage
 * error for malformed input — the CLI surface maps that to a non-zero exit with
 * the message on stderr (no silent failure).
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let budget = DEFAULT_BUDGET_BYTES;
  let full = false;
  let mode: BudgetMode | null = null;

  // `bun scripts/x.ts -- cmd` strips a LEADING `--` (it is bun's own
  // end-of-options separator), so the script may never see it. To keep the
  // canonical `-- <command>` invocation working we treat the FIRST token that
  // is neither a recognised wrapper flag nor a flag's value as the start of the
  // wrapped command — an explicit `--` still works when bun preserves it.
  let i = 0;
  for (; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      i++;
      break;
    }
    if (token === '--full') {
      full = true;
      continue;
    }
    if (token === '--budget') {
      const value = argv[++i];
      const parsed = Number(value);
      if (
        !Number.isFinite(parsed) ||
        parsed <= 0 ||
        !Number.isInteger(parsed)
      ) {
        throw new Error(
          `--budget requires a positive integer byte count, got: ${value ?? '(missing)'}`,
        );
      }
      budget = parsed;
      continue;
    }
    if (token === '--mode') {
      const value = argv[++i];
      if (value !== 'diff' && value !== 'log' && value !== 'generic') {
        throw new Error(
          `--mode must be one of diff|log|generic, got: ${value ?? '(missing)'}`,
        );
      }
      mode = value;
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(
        `Unknown flag before \`--\`: ${token}. Usage: kh-output-budget [--budget <bytes>] [--full] [--mode diff|log|generic] -- <command> [args...]`,
      );
    }
    // A non-flag token with no preceding `--` separator (bun stripped it): this
    // is the start of the wrapped command. Stop flag parsing here.
    break;
  }

  const rest = argv.slice(i);
  if (rest.length === 0) {
    throw new Error(
      'No wrapped command supplied. Usage: kh-output-budget [--budget <bytes>] [--full] [--mode diff|log|generic] -- <command> [args...]',
    );
  }

  const [command, ...args] = rest;
  return { budget, full, mode, command, args };
}

/**
 * Build the exact, ready-to-run `--full` escape re-invocation (A1.W.2). Echoes
 * the resolved mode and the original command argv so the consumer can copy-paste
 * it to recover the untruncated output.
 */
export function buildEscapeCommand(
  mode: BudgetMode,
  command: string,
  args: string[],
): string {
  const parts = [
    'bun',
    'scripts/kh-output-budget.ts',
    '--full',
    '--mode',
    mode,
    '--',
    command,
    ...args,
  ];
  return parts.join(' ');
}

/** Locate the byte offset of the start of `git diff`'s first hunk header. */
function firstHunkOffset(text: string): number {
  // Diff bodies begin at the first "diff --git" line; the --stat summary (if
  // present) precedes it. We treat everything up to the first per-file diff
  // block as the summary to retain.
  const diffStart = text.indexOf('\ndiff --git ');
  if (diffStart >= 0) return diffStart + 1; // keep the leading newline with the stat block
  return text.startsWith('diff --git ') ? 0 : -1;
}

export interface TruncationResult {
  shownText: string;
  shownBytes: number;
}

/**
 * Diff-mode truncation: always retain the `--stat` summary that precedes the
 * first per-file diff block, then append as many leading hunk bytes as fit the
 * remaining budget (A1.W.3). If there is no recognisable stat/diff boundary we
 * fall back to a leading-bytes slice (still budgeted).
 */
export function truncateDiff(text: string, budget: number): TruncationResult {
  const encoder = new TextEncoder();
  const hunkOffset = firstHunkOffset(text);

  if (hunkOffset > 0) {
    const summary = text.slice(0, hunkOffset);
    const summaryBytes = encoder.encode(summary).length;
    const remaining = budget - summaryBytes;
    if (remaining <= 0) {
      // Summary alone exceeds budget — keep it whole anyway so the file-level
      // overview is never lost (A1.W.3 "always shows the file-level summary").
      return { shownText: summary, shownBytes: summaryBytes };
    }
    const body = text.slice(hunkOffset);
    const bodyHead = sliceBytesFromHead(body, remaining);
    const shownText = summary + bodyHead;
    return { shownText, shownBytes: encoder.encode(shownText).length };
  }

  // No stat boundary detected — degrade to a leading-bytes slice.
  const head = sliceBytesFromHead(text, budget);
  return { shownText: head, shownBytes: encoder.encode(head).length };
}

/**
 * Head+tail truncation for log/generic mode (A1.W.3): split the budget 60/40
 * with an elision marker between, so the tail (where failures surface) is never
 * dropped. Head-only is explicitly wrong here.
 */
export function truncateHeadTail(
  text: string,
  budget: number,
): TruncationResult {
  const encoder = new TextEncoder();
  const headBudget = Math.max(1, Math.floor(budget * HEAD_FRACTION));
  const tailBudget = Math.max(1, budget - headBudget);

  const head = sliceBytesFromHead(text, headBudget);
  const tail = sliceBytesFromTail(text, tailBudget);
  const shownText = `${head}\n${ELISION_MARKER}\n${tail}`;
  return { shownText, shownBytes: encoder.encode(shownText).length };
}

/** Take the leading bytes of `text` up to `maxBytes`, not splitting a UTF-8 codepoint. */
function sliceBytesFromHead(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const slice = bytes.slice(0, maxBytes);
  return new TextDecoder('utf-8', { fatal: false })
    .decode(slice)
    .replace(/�+$/, '');
}

/** Take the trailing bytes of `text` up to `maxBytes`, not splitting a UTF-8 codepoint. */
function sliceBytesFromTail(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const slice = bytes.slice(bytes.length - maxBytes);
  return new TextDecoder('utf-8', { fatal: false })
    .decode(slice)
    .replace(/^�+/, '');
}

/** Format the receipt block (A1.W.2). */
export function formatReceipt(
  originalBytes: number,
  shownBytes: number,
  escape: string,
): string {
  return [
    RECEIPT_OPEN,
    'truncated: true',
    `original_length: ${originalBytes}`,
    `shown: ${shownBytes}`,
    `escape: ${escape}`,
  ].join('\n');
}

export interface WrapperOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Pure core: given the wrapped command's captured output and the parsed args,
 * produce the wrapper's own stdout/stderr/exit-code. Kept side-effect-free so
 * behaviour is testable both at the function boundary and via the spawned CLI.
 */
export function applyBudget(
  parsed: ParsedArgs,
  captured: { stdout: string; stderr: string; exitCode: number },
): WrapperOutcome {
  const { stdout, stderr, exitCode } = captured;
  const mode = resolveMode(parsed.mode, parsed.command, parsed.args);
  const encoder = new TextEncoder();
  const originalBytes = encoder.encode(stdout).length;

  // Degrade-safe: stderr always passes through verbatim; exit code is the
  // wrapped command's real code. We never swallow a failure behind truncation.
  // --full disables the budget entirely (the escape path).
  if (parsed.full || originalBytes <= parsed.budget) {
    return { stdout, stderr, exitCode };
  }

  const truncated =
    mode === 'diff'
      ? truncateDiff(stdout, parsed.budget)
      : truncateHeadTail(stdout, parsed.budget);

  const escape = buildEscapeCommand(mode, parsed.command, parsed.args);
  const receipt = formatReceipt(originalBytes, truncated.shownBytes, escape);
  const budgetedStdout = `${truncated.shownText}\n${receipt}`;

  return { stdout: budgetedStdout, stderr, exitCode };
}

/** CLI entry point — spawns the wrapped command and emits the budgeted result. */
export function main(argv: string[]): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`kh-output-budget: ${(err as Error).message}\n`);
    return 2;
  }

  const child = spawnSync(parsed.command, parsed.args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256,
  });

  if (child.error) {
    // Spawn itself failed (e.g. command not found). Surface verbatim, no swallow.
    process.stderr.write(
      `kh-output-budget: failed to spawn ${parsed.command}: ${child.error.message}\n`,
    );
    return 127;
  }

  const captured = {
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    exitCode: child.status ?? 0,
  };

  const outcome = applyBudget(parsed, captured);
  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  return outcome.exitCode;
}

// Execute only when run directly (not when imported by tests).
if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
