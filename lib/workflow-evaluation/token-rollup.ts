/**
 * token-rollup — compute real Anthropic token usage from a Claude Code
 * session transcript and (optionally) patch it into an archived
 * `final_report.yaml`.
 *
 * Context (ID-48.17 / RESEARCH §7 metric #1, fixes S280 B3):
 * Every assistant row in a Claude Code session transcript
 * (`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`) carries a real
 * `message.usage` object:
 *   { input_tokens, output_tokens,
 *     cache_creation_input_tokens, cache_read_input_tokens }
 * The worker `meta.json` carries the `session_id`, so the join from a worker
 * to its true token cost is `session_id → transcript → Σ message.usage`.
 *
 * `final_report.yaml` carries ZERO token data today, and `parse-session.py`'s
 * tiktoken count is a cl100k_base (OpenAI) content proxy — neither is the
 * canonical source. This module uses `message.usage` as the canonical source.
 *
 * Durability caveat: transcripts are uncommitted + retention-windowed, so the
 * roll-up MUST run AT ARCHIVE TIME (called from stop-worker.sh teardown), not
 * deferred to evaluator run-time. A purged transcript yields `null` + a note
 * rather than throwing.
 *
 * Role-level (Executor / Checker) attribution is a v2 follow-up: it requires
 * the child `agent-<hash>` / sidechain transcripts (one level deeper,
 * un-archived today). This module attributes at the worker / sub-orchestrator
 * level only — `token_usage_by_role: { sub_orchestrator: { … } }`.
 *
 * CLI-invokable:
 *   bun run lib/workflow-evaluation/token-rollup.ts --session-id <sid> \
 *     [--report <final_report.yaml path>] \
 *     [--transcript <explicit .jsonl path>] \
 *     [--encoded-cwd <encoded dir name>] \
 *     [--role <role key, default sub_orchestrator>] \
 *     [--projects-dir <~/.claude/projects override>]
 *
 * When `--report` is passed, the rollup patches `token_usage_by_role` +
 * `token_usage_total` directly into that YAML file (YAML I/O stays in TS so
 * bash never hand-edits YAML).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** Summed token totals across every assistant turn in a transcript. */
export interface TokenTotals {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  /** input + output + cache_creation + cache_read */
  total: number;
}

/** Per-assistant-turn token detail, ordered as encountered in the transcript. */
export interface TurnUsage {
  /** 0-based index of this assistant turn within the transcript. */
  index: number;
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  total: number;
}

/** Result of a roll-up over one session transcript. */
export interface TokenRollupResult {
  session_id: string;
  /** Resolved transcript path, or null when no transcript could be located. */
  transcript_path: string | null;
  /**
   * Summed totals, or null when the transcript is missing/purged. A null
   * `totals` is the durability signal — emit + note, never throw.
   */
  totals: TokenTotals | null;
  /** Per-turn array for downstream megaturn detection. Empty when null totals. */
  turns: TurnUsage[];
  /** Number of assistant turns summed. */
  turn_count: number;
  /**
   * Human-readable note — populated when the transcript is missing or the
   * rollup is otherwise degraded. null on the clean path.
   */
  note: string | null;
}

const ZERO_TOTALS: TokenTotals = {
  input: 0,
  output: 0,
  cache_creation: 0,
  cache_read: 0,
  total: 0,
};

/**
 * Encode an absolute cwd into the Claude Code projects directory name.
 * Claude Code replaces every `/` and `.` in the absolute path with `-`
 * (e.g. `/Users/x/dev/.claude/worktrees/w` →
 * `-Users-x-dev--claude-worktrees-w`).
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

/** Default `~/.claude/projects` directory (override via --projects-dir). */
function defaultProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Resolve the transcript path for a session id. Resolution order:
 * 1. explicit `transcriptPath` (used verbatim if it exists);
 * 2. `<projectsDir>/<encodedCwd>/<sessionId>.jsonl` when `encodedCwd` given;
 * 3. scan every `<projectsDir>/<dir>/<sessionId>.jsonl` for a match.
 * Returns null when nothing resolves (purged / retention-windowed).
 */
export function resolveTranscriptPath(opts: {
  sessionId: string;
  transcriptPath?: string;
  encodedCwd?: string;
  projectsDir?: string;
}): string | null {
  const { sessionId } = opts;
  if (opts.transcriptPath) {
    return existsSync(opts.transcriptPath) ? opts.transcriptPath : null;
  }

  const projectsDir = opts.projectsDir ?? defaultProjectsDir();

  if (opts.encodedCwd) {
    const direct = join(projectsDir, opts.encodedCwd, `${sessionId}.jsonl`);
    return existsSync(direct) ? direct : null;
  }

  if (!existsSync(projectsDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = join(projectsDir, entry, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Coerce a possibly-missing numeric usage field to a finite non-negative int. */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Sum `message.usage` across every assistant turn in transcript JSONL text.
 * Exposed for unit testing without filesystem coupling.
 */
export function sumUsageFromTranscript(jsonl: string): {
  totals: TokenTotals;
  turns: TurnUsage[];
} {
  const totals: TokenTotals = { ...ZERO_TOTALS };
  const turns: TurnUsage[] = [];

  const lines = jsonl.split('\n');
  let turnIndex = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      // Tolerate a torn final line / non-JSON noise — skip, do not throw.
      continue;
    }
    if (typeof row !== 'object' || row === null) continue;
    const record = row as { type?: unknown; message?: unknown };
    if (record.type !== 'assistant') continue;
    const message = record.message as { usage?: unknown } | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;

    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheCreation = num(usage.cache_creation_input_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const turnTotal = input + output + cacheCreation + cacheRead;

    totals.input += input;
    totals.output += output;
    totals.cache_creation += cacheCreation;
    totals.cache_read += cacheRead;
    totals.total += turnTotal;

    turns.push({
      index: turnIndex,
      input,
      output,
      cache_creation: cacheCreation,
      cache_read: cacheRead,
      total: turnTotal,
    });
    turnIndex += 1;
  }

  return { totals, turns };
}

/**
 * Roll up token usage for a session. Resolves the transcript, sums per-turn
 * `message.usage`, and returns totals + per-turn detail. A missing transcript
 * yields `totals: null` + a `note` (never throws) — the durability contract.
 */
export function rollupSessionTokens(opts: {
  sessionId: string;
  transcriptPath?: string;
  encodedCwd?: string;
  projectsDir?: string;
}): TokenRollupResult {
  const { sessionId } = opts;
  const transcriptPath = resolveTranscriptPath(opts);

  if (!transcriptPath) {
    return {
      session_id: sessionId,
      transcript_path: null,
      totals: null,
      turns: [],
      turn_count: 0,
      note: `transcript not found for session ${sessionId} (purged or retention-windowed); token usage unavailable`,
    };
  }

  let jsonl: string;
  try {
    jsonl = readFileSync(transcriptPath, 'utf8');
  } catch (err) {
    return {
      session_id: sessionId,
      transcript_path: transcriptPath,
      totals: null,
      turns: [],
      turn_count: 0,
      note: `transcript at ${transcriptPath} could not be read (${
        err instanceof Error ? err.message : String(err)
      }); token usage unavailable`,
    };
  }

  const { totals, turns } = sumUsageFromTranscript(jsonl);

  if (turns.length === 0) {
    return {
      session_id: sessionId,
      transcript_path: transcriptPath,
      totals,
      turns,
      turn_count: 0,
      note: `transcript at ${transcriptPath} contained no assistant rows with message.usage; totals are zero`,
    };
  }

  return {
    session_id: sessionId,
    transcript_path: transcriptPath,
    totals,
    turns,
    turn_count: turns.length,
    note: null,
  };
}

/**
 * Patch `token_usage_by_role` + `token_usage_total` into a final_report.yaml
 * file. Keeps YAML I/O in TS so bash never hand-edits YAML. When totals are
 * null (missing transcript) the role entry is set to `null` and a
 * `token_usage_note` is written, so the absence is explicit + machine-readable.
 *
 * Returns true if the file was written, false if the report path was absent.
 */
export function patchReportWithRollup(
  reportPath: string,
  rollup: TokenRollupResult,
  roleKey = 'sub_orchestrator',
): boolean {
  if (!existsSync(reportPath)) return false;

  let doc: Record<string, unknown>;
  try {
    const parsed = parseYaml(readFileSync(reportPath, 'utf8'));
    doc =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    // Unparseable YAML — start from an empty doc rather than destroying nothing.
    doc = {};
  }

  const byRole =
    (doc.token_usage_by_role as Record<string, unknown> | undefined) ?? {};

  if (rollup.totals) {
    byRole[roleKey] = {
      input: rollup.totals.input,
      output: rollup.totals.output,
      cache_creation: rollup.totals.cache_creation,
      cache_read: rollup.totals.cache_read,
      total: rollup.totals.total,
      turn_count: rollup.turn_count,
      session_id: rollup.session_id,
    };
    doc.token_usage_by_role = byRole;
    doc.token_usage_total = rollup.totals.total;
  } else {
    byRole[roleKey] = null;
    doc.token_usage_by_role = byRole;
    doc.token_usage_total = null;
  }

  if (rollup.note) {
    doc.token_usage_note = rollup.note;
  }

  writeFileSync(reportPath, stringifyYaml(doc), 'utf8');
  return true;
}

// ── CLI ────────────────────────────────────────────────────────────────────

interface CliArgs {
  sessionId?: string;
  report?: string;
  transcript?: string;
  encodedCwd?: string;
  role: string;
  projectsDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { role: 'sub_orchestrator' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--session-id':
        args.sessionId = value;
        i += 1;
        break;
      case '--report':
        args.report = value;
        i += 1;
        break;
      case '--transcript':
        args.transcript = value;
        i += 1;
        break;
      case '--encoded-cwd':
        args.encodedCwd = value;
        i += 1;
        break;
      case '--role':
        if (value) args.role = value;
        i += 1;
        break;
      case '--projects-dir':
        args.projectsDir = value;
        i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  if (!args.sessionId) {
    process.stderr.write(
      'Error: --session-id <sid> is required.\n' +
        'Usage: bun run lib/workflow-evaluation/token-rollup.ts --session-id <sid> ' +
        '[--report <final_report.yaml>] [--transcript <path>] [--encoded-cwd <dir>] ' +
        '[--role <key>] [--projects-dir <dir>]\n',
    );
    return 2;
  }

  const rollup = rollupSessionTokens({
    sessionId: args.sessionId,
    transcriptPath: args.transcript,
    encodedCwd: args.encodedCwd,
    projectsDir: args.projectsDir,
  });

  if (args.report) {
    const wrote = patchReportWithRollup(args.report, rollup, args.role);
    if (!wrote) {
      process.stderr.write(
        `Note: report ${args.report} not found — printing rollup to stdout only.\n`,
      );
    } else {
      process.stderr.write(
        `Patched token_usage_by_role.${args.role} + token_usage_total into ${args.report}.\n`,
      );
    }
  }

  // Always emit the rollup as JSON to stdout so callers can capture it.
  process.stdout.write(`${JSON.stringify(rollup, null, 2)}\n`);

  if (rollup.note) {
    process.stderr.write(`Note: ${rollup.note}\n`);
  }
  // Missing transcript is NOT a failure — emit null + note, exit 0.
  return 0;
}

// Execute only when run directly (not when imported by tests).
if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)));
}
