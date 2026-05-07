#!/usr/bin/env bun
/**
 * REVOKE-guard CI lint + cron audit (WP-OPS-43.3).
 *
 * Two modes (single script, mode-flagging via CLI):
 *   --mode=lint  (default) — diff scanner. For every migration file in
 *                 the PR diff (range <baseline>...HEAD), parse out every
 *                 `CREATE FUNCTION public.<name>(<args>)` and assert a
 *                 matching `REVOKE EXECUTE ... FROM PUBLIC, anon` exists
 *                 in the SAME file. Missing REVOKE → exit 1 with
 *                 ::error:: annotation. Allow-listed signatures (§2.5)
 *                 emit ::notice:: instead. PR-blocking.
 *   --mode=cron  — Management API SQL audit query against prod (§2.6).
 *                 Lists every `public.*` function with anon EXECUTE
 *                 privilege outside the static allow-list. Any non-zero
 *                 result = exit 1 + ::error:: annotation + Sentry capture
 *                 (graceful degradation: if SENTRY_AUTH_TOKEN is unset,
 *                 logs to stderr instead — supports local-dev parity per
 *                 AC-9).
 *
 * **Why this script exists:**
 *   Every new PL/pgSQL function in the public schema is silently auto-granted
 *   `anon EXECUTE` by Supabase managed PG via pg_default_acl (memory
 *   feedback_supabase_pg_default_acl_anon_execute). The mitigation is a
 *   per-function `REVOKE EXECUTE ON FUNCTION public.<name>(<args>) FROM
 *   PUBLIC, anon` in the same migration. Today this is enforced via
 *   CLAUDE.md, memory, and migration-author checklist — all attentive-author
 *   rules. With ~ninety functions in scope at OPS-43 audit moment plus
 *   future cumulative growth, attentive-author rules drift. This script
 *   catches the absent REVOKE at the diff-introduction moment.
 *
 *   Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ops43.3-revoke-guard-spec.md
 *
 * **Mechanism:**
 *   - Lint: `git diff --name-only <baseline> HEAD -- 'supabase/migrations/**'`
 *     enumerates changed files; for each, parse SQL → extract CREATE
 *     FUNCTION + REVOKE statements → pair them. Subprocess invoked via
 *     spawnSync (NOT exec) with args-array form (no shell interpolation,
 *     safe by construction; pattern matches scripts/migration-replay-check.ts).
 *   - Cron: direct fetch() against the Supabase Management API
 *     /v1/projects/{ref}/database/query endpoint with the audit SQL.
 *     Pattern lifted from scripts/run-supabase-advisors.ts (Bun 204
 *     hang gotcha rules out supabase-js writes; the query endpoint
 *     returns a JSON array so it is safe).
 *
 * **Required env vars (mode=cron only):**
 *   - SUPABASE_ACCESS_TOKEN — PAT with project read access (same as WP-G4.5/G4.6)
 *   - PROJECT_REF — defaults to prod (rovrymhhffssilaftdwd)
 *   - SENTRY_AUTH_TOKEN — optional; when present, drift events are pushed
 *     to Sentry. When absent, drift events log to stderr only. NEVER
 *     initialise Sentry SDK with `silent: true` (memory
 *     feedback_sentry_turbopack_silent_failure — masks upload errors).
 *
 * **Usage:**
 *   bun run scripts/check-revoke-guard.ts                              # lint mode against origin/main
 *   bun run scripts/check-revoke-guard.ts --mode=lint --baseline=<sha> # CI lint
 *   bun run scripts/check-revoke-guard.ts --mode=lint --files=<glob>   # local manual lint
 *   bun run scripts/check-revoke-guard.ts --mode=cron                  # prod drift audit
 *   bun run scripts/check-revoke-guard.ts --dry-run                    # warn-on-find (week 1)
 *   bun run scripts/check-revoke-guard.ts --help                       # usage
 *
 * **Exit codes:**
 *   - 0  — pass; no missing REVOKEs (lint) or zero anon-callable rows
 *          beyond allow-list (cron); or --dry-run regardless.
 *   - 1  — failures (PR-blocking lint; cron drift detected).
 *   - 2  — infrastructure failure (git unavailable, API unreachable,
 *          missing auth token, allow-list rationale guard tripped).
 *          Transient — re-run.
 *
 * **Scope guardrails (D-OPS-43.3-7):**
 *   - public schema only. auth.*, extensions.*, custom-schema functions
 *     have different default-acl behaviour and threat models — out of
 *     scope.
 *   - `EXECUTE format()`-built functions invisible to lint (rare in KH).
 *     Cron audit catches them post-fact.
 */

import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// ── Constants ──────────────────────────────────────────────────────────────

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';
const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';
const SPEC_PATH =
  'docs/audits/kh-production-readiness-phase-1/specs/wp-ops43.3-revoke-guard-spec.md';

const EXIT_OK = 0;
const EXIT_FAILURES = 1;
const EXIT_INFRA_ERROR = 2;

const RATIONALE_MIN_LEN = 40;

// ── Regex literals (verbatim from spec §2.3) ──────────────────────────────

/**
 * CREATE FUNCTION prologue matcher. Captures the function name only — the
 * argument list is extracted by paren-balancing the input stream from the
 * first `(` after the name (regex alone cannot handle nested types like
 * numeric(10, 2)).
 *
 * Verbatim from spec §2.3.
 */
const CREATE_FUNCTION_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+")\s*\(/gi;

/**
 * REVOKE EXECUTE ON FUNCTION matcher. Verbatim from spec §2.3. The capture
 * group `FROM [^;]+?` is split on `,` and trimmed; the matcher accepts a
 * REVOKE iff the grantee list contains `anon` (with or without `PUBLIC`,
 * with or without `authenticated`).
 */
const REVOKE_FUNCTION_RE =
  /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+")\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s+FROM\s+([^;]+?)(?:;|\s*$)/gim;

// ── Types ──────────────────────────────────────────────────────────────────

export interface CreateFunctionRecord {
  name: string;
  isQuoted: boolean;
  args: string;
  line: number;
}

export interface RevokeRecord {
  name: string;
  isQuoted: boolean;
  args: string;
  grantees: string[];
  line: number;
}

export interface AllowListEntry {
  signature: string;
  rationale: string;
  added_session: string;
}

interface CliFlags {
  mode: 'lint' | 'cron';
  baseline: string;
  files: string | undefined;
  dryRun: boolean;
}

interface LintFinding {
  file: string;
  line: number;
  signature: string;
  kind: 'error' | 'notice';
  message: string;
}

// ── Allow-list (§2.5, D-OPS-43.3-6 = static array) ────────────────────────

/**
 * Functions intentionally callable by anon. Today: exactly one entry,
 * `set_config` — the PostgREST session-config wrapper exposed by design
 * for RLS to set request.jwt.* GUCs during anonymous read paths.
 *
 * **To add a new entry** (per spec §2.5):
 *   1. Open a PR adding the entry to this array.
 *   2. PR description must include: function signature; rationale; threat
 *      model; SECURITY choice (DEFINER vs INVOKER); explicit assertion
 *      that no sensitive data path is reachable.
 *   3. Senior-staff sign-off required (Liam today; "two reviewers" once
 *      team scales — D-OPS-43.3-2).
 *   4. **Replacement migrations MUST re-GRANT EXECUTE TO anon
 *      explicitly** — never rely on default-acl (Finding 9.3).
 *   5. After merge, the cron audit (§2.6) treats the new signature as
 *      legitimate and stops flagging it.
 *
 * **Anti-pattern guard** (§2.5 + AC-10): script refuses to start if any
 * entry has `rationale.length < 40` or contains the placeholder string
 * "TODO". Forces meaningful justification.
 */
export const INTENTIONAL_ANON_ALLOW_LIST: ReadonlyArray<AllowListEntry> = [
  {
    signature: 'public.set_config(setting text, value text, is_local boolean)',
    rationale:
      "Supabase-managed SQL shim wrapping pg_catalog.set_config (owner=postgres; body = SELECT pg_catalog.set_config(setting, value, is_local)). PostgREST session-config wrapper. Exposed to anon by design — used by RLS to set request.jwt.* GUCs during anonymous read paths. Verified S22 (OPS-43 spec §AC-5). kh-prod-readiness-S38 W2 OPS-64 deep-investigation re-affirmed (07/05/2026): ZERO exploitable surface today — live pg_policies scan returned no rows reading app.* GUCs as identity claims, so the GUC-injection-bypass attack vector is inactive. Only consumer of any app.* GUC is the snapshot_bid_response_history() trigger reading app.change_reason for audit-trail capture, reached only via admin/editor-gated UPDATE bid_responses (admin/editor RLS upstream blocks anon). Future-drift guard __tests__/migrations/no-app-guc-rls-policy.test.ts blocks any CREATE POLICY adopting current_setting('app.X') pattern. Replacement migrations MUST re-GRANT EXECUTE TO anon explicitly per Finding 9.3. Revisit if OPS-65 (refactor set_config out of app entirely) ships.",
    added_session:
      'kh-prod-readiness-S22 (carried forward; intent predates audit; rationale extended kh-prod-readiness-S38 W2 OPS-64 close-out)',
  },
];

// ── CLI ────────────────────────────────────────────────────────────────────

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'lint' },
      baseline: { type: 'string', default: 'origin/main' },
      files: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
WP-OPS-43.3 — REVOKE-guard CI lint + cron audit.

Usage:
  bun run scripts/check-revoke-guard.ts                              # lint mode (default)
  bun run scripts/check-revoke-guard.ts --mode=lint --baseline=<sha> # CI lint
  bun run scripts/check-revoke-guard.ts --mode=lint --files=<glob>   # manual local lint
  bun run scripts/check-revoke-guard.ts --mode=cron                  # prod drift audit
  bun run scripts/check-revoke-guard.ts --dry-run                    # warn-on-find (week 1)

Required env vars (cron mode only):
  SUPABASE_ACCESS_TOKEN  Personal Access Token with project read access
  PROJECT_REF            Project ref (default: ${PROD_PROJECT_REF} = prod)
  SENTRY_AUTH_TOKEN      Optional; when present, drift events push to Sentry

Exit codes:
  0  pass (or --dry-run regardless of findings)
  1  failures (missing REVOKEs in lint; drift in cron)
  2  infrastructure failure (transient; re-run)

Spec: ${SPEC_PATH}
`);
    process.exit(EXIT_OK);
  }

  const mode = values.mode as string;
  if (mode !== 'lint' && mode !== 'cron') {
    console.error(`Unknown --mode=${mode}; expected 'lint' or 'cron'.`);
    process.exit(EXIT_INFRA_ERROR);
  }

  return {
    mode: mode as 'lint' | 'cron',
    baseline: (values.baseline as string) ?? 'origin/main',
    files: values.files as string | undefined,
    dryRun: values['dry-run'] ?? false,
  };
}

// ── Comment + dollar-string stripping (§2.4 last 2 rows) ─────────────────

/**
 * Strip line + block comments + dollar-quoted strings from SQL input
 * before running the CREATE-extraction regex. Otherwise the regex
 * false-positives on comments or string literals containing the words
 * "CREATE FUNCTION".
 *
 * Implementation:
 *   1. Block comment text replaced with whitespace (newlines preserved).
 *   2. Single-line `--` comments replaced with whitespace to end-of-line.
 *   3. Dollar-quoted strings ($$...$$ and $tag$...$tag$) bodies blanked.
 *
 * **CRITICAL:** newlines are PRESERVED throughout so `extractCreateFunctions`
 * can report accurate `line` numbers for ::error:: annotations.
 *
 * **Note:** REVOKE statements often live inside DO $$ ... $$ blocks
 * (per OPS-43 migration pattern). For that reason, the script extracts
 * REVOKEs from the RAW input (NOT the dollar-stripped version). See
 * `extractRevokes`.
 */
export function stripCommentsAndDollarStrings(input: string): string {
  let out = input;

  // 1. Block comments — non-greedy, multiline. Replace with whitespace
  //    matching length to preserve column offsets within the line.
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

  // 2. Single-line comments — strip to end of line, keep newline.
  out = out.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));

  // 3. Dollar-quoted strings.
  out = stripDollarStrings(out);

  return out;
}

function stripDollarStrings(input: string): string {
  // PostgreSQL dollar-quote tag: $[A-Za-z_][A-Za-z0-9_]*$ or $$.
  // PostgreSQL itself does not allow nesting of the SAME tag — so a
  // single linear pass suffices.
  const result: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const openMatch = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(input.slice(cursor));
    if (!openMatch) {
      result.push(input.slice(cursor));
      break;
    }
    const openIdx = cursor + openMatch.index;
    const tag = openMatch[0];
    result.push(input.slice(cursor, openIdx));

    // Find the matching close tag.
    const closeIdx = input.indexOf(tag, openIdx + tag.length);
    if (closeIdx === -1) {
      // Unterminated dollar-string; leave the rest alone.
      result.push(input.slice(openIdx));
      break;
    }
    const body = input.slice(openIdx + tag.length, closeIdx);
    const blankedBody = body.replace(/[^\n]/g, ' ');
    result.push(tag, blankedBody, tag);
    cursor = closeIdx + tag.length;
  }

  return result.join('');
}

// ── Parser: extractCreateFunctions ────────────────────────────────────────

/**
 * Extract every `CREATE FUNCTION public.<name>(<args>)` from the input
 * via the regex prologue + paren-balancing for the argument list (per
 * spec §2.3 paren-balancer requirement).
 *
 * Internally strips line + block comments + dollar-quoted strings before
 * the regex pass (per §2.4 last 2 rows). This is idempotent — if the
 * caller already stripped, the second pass is a no-op.
 *
 * **Why strip inside the parser:** the call sites (test fixtures, lint
 * mode, exploratory tooling) all expect the parser to handle realistic
 * SQL files without ceremony. Keeping the public function `stripCommentsAndDollarStrings`
 * exported lets the lint-mode pipeline re-use the cleaned input for the
 * REVOKE pass too (which strips comments only — see `extractRevokes`).
 */
export function extractCreateFunctions(
  rawInput: string,
): CreateFunctionRecord[] {
  const input = stripCommentsAndDollarStrings(rawInput);
  const out: CreateFunctionRecord[] = [];
  // Reset regex state per call (`g` flag is stateful).
  CREATE_FUNCTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREATE_FUNCTION_RE.exec(input)) !== null) {
    const rawName = match[1];
    const isQuoted = rawName.startsWith('"') && rawName.endsWith('"');
    const name = isQuoted ? rawName.slice(1, -1) : rawName;
    // The opening `(` of the argument list is the LAST char of the regex
    // match. Paren-balance from there.
    const openParenIdx = match.index + match[0].length - 1;
    const args = balanceParens(input, openParenIdx);
    if (args === null) {
      // Unbalanced — skip (likely a parse error in the SQL).
      continue;
    }
    const line = lineNumberFor(input, match.index);
    out.push({ name, isQuoted, args, line });
  }
  return out;
}

/**
 * One-pass paren counter. Starts at depth 1 on the opening `(` at
 * `openParenIdx`, increments on every `(`, decrements on every `)`,
 * returns the inner slice (without the outer parens) when depth returns
 * to 0. Returns null on unbalanced input.
 *
 * Per spec §2.3 paren-balancer requirement.
 */
function balanceParens(input: string, openParenIdx: number): string | null {
  if (input[openParenIdx] !== '(') return null;
  let depth = 1;
  let i = openParenIdx + 1;
  while (i < input.length && depth > 0) {
    const ch = input[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  if (depth !== 0) return null;
  // i is now one past the closing `)`. Slice between the two parens.
  return input.slice(openParenIdx + 1, i - 1);
}

function lineNumberFor(input: string, charIdx: number): number {
  let line = 1;
  for (let i = 0; i < charIdx && i < input.length; i++) {
    if (input[i] === '\n') line++;
  }
  return line;
}

// ── Parser: extractRevokes ────────────────────────────────────────────────

/**
 * Extract every `REVOKE EXECUTE ON FUNCTION public.<name>(<args>) FROM
 * <grantees>` from the input.
 *
 * **CRITICAL:** unlike extractCreateFunctions, this scans the input
 * AFTER stripping line + block comments BUT BEFORE stripping
 * dollar-quoted strings. Real-world OPS-43 migrations wrap REVOKEs in
 * `DO $$ BEGIN REVOKE ... END $$;` blocks for fresh-DB-replay
 * idempotency; stripping dollar-strings before this pass would silently
 * drop those REVOKEs, causing massive false positives.
 *
 * The regex is from spec §2.3 verbatim; it tolerates one level of nested
 * parens in the argument list (sufficient for `numeric(10, 2)` etc).
 */
export function extractRevokes(input: string): RevokeRecord[] {
  // Strip line + block comments (avoid commented-out REVOKEs); keep
  // dollar-quoted body intact so REVOKEs inside DO blocks remain visible.
  let scanInput = input;
  scanInput = scanInput.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  scanInput = scanInput.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));

  const out: RevokeRecord[] = [];
  REVOKE_FUNCTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REVOKE_FUNCTION_RE.exec(scanInput)) !== null) {
    const rawName = match[1];
    const isQuoted = rawName.startsWith('"') && rawName.endsWith('"');
    const name = isQuoted ? rawName.slice(1, -1) : rawName;
    const args = match[2] ?? '';
    const granteesRaw = match[3] ?? '';
    const grantees = granteesRaw
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    const line = lineNumberFor(scanInput, match.index);
    out.push({ name, isQuoted, args, grantees, line });
  }
  return out;
}

// ── Matcher ───────────────────────────────────────────────────────────────

/**
 * Whitespace-collapse a function signature for tolerant comparison.
 * Lowercases (case-folds) so that keywords like `IN`/`OUT` match
 * regardless of input casing.
 */
export function normaliseSignature(args: string): string {
  return args.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Extract just the type tokens from a function argument list. PG accepts
 * both `(p_x integer, p_y text)` (named) and `(integer, text)` (types-only)
 * REVOKE signatures — both refer to the same function. The matcher
 * accepts either form by computing both normalisations.
 *
 * Algorithm:
 *   1. Split on top-level commas (depth-aware so `numeric(10, 2)` is
 *      treated as one arg).
 *   2. For each arg, strip leading mode keyword (IN/OUT/INOUT/VARIADIC),
 *      strip leading parameter name (any token before the type), strip
 *      trailing DEFAULT clause.
 *   3. What remains is the type — collapse whitespace, lowercase, join.
 *
 * Returns "" for empty input.
 */
export function extractTypesOnly(args: string): string {
  const trimmed = args.trim();
  if (trimmed.length === 0) return '';
  const parts = splitArgsTopLevel(trimmed);
  const types = parts.map((p) => extractTypeFromArg(p));
  return types.join(', ').toLowerCase();
}

function splitArgsTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (start < input.length) {
    out.push(input.slice(start).trim());
  }
  return out.filter((p) => p.length > 0);
}

function extractTypeFromArg(arg: string): string {
  let s = arg.trim();
  // Strip leading mode keyword.
  s = s.replace(/^(in|out|inout|variadic)\s+/i, '');
  // Strip trailing DEFAULT clause.
  s = s.replace(/\s+default\s+.+$/i, '');
  // If the arg is just a single token (already types-only), return it.
  // Otherwise, the first whitespace-delimited token is the parameter name
  // and the rest is the type.
  const firstSpaceIdx = s.search(/\s/);
  if (firstSpaceIdx === -1) {
    // Could be either: types-only single token (e.g. `integer`) or
    // a parameter name with no type (invalid SQL — treat as type).
    return s.replace(/\s+/g, ' ');
  }
  // If the first token looks like a known PG type (heuristic: starts with
  // a letter and is followed by `(` or by whitespace + another type
  // keyword), assume it's already types-only. Otherwise strip first token
  // (parameter name) and return the rest.
  const firstToken = s.slice(0, firstSpaceIdx);
  const restAfterFirst = s.slice(firstSpaceIdx + 1).trim();
  // PG type heuristic: if the rest starts with `(` (e.g. `numeric(10, 2)`
  // would be `numeric` followed by `(10, 2)`), we treat the firstToken as
  // the type and re-attach. But that case is impossible because we already
  // matched whitespace; so if there's whitespace then firstToken is the
  // param name OR it's a multi-word type like `double precision`,
  // `character varying`, `timestamp with time zone`.
  const MULTIWORD_TYPE_HEADS = new Set([
    'double',
    'character',
    'bit',
    'timestamp',
    'time',
    'interval',
  ]);
  if (MULTIWORD_TYPE_HEADS.has(firstToken.toLowerCase())) {
    // Already types-only multi-word.
    return s.replace(/\s+/g, ' ');
  }
  // Otherwise: first token = param name, rest = type.
  return restAfterFirst.replace(/\s+/g, ' ');
}

/**
 * Pair a CREATE FUNCTION record against the REVOKE records from the same
 * file. Returns true iff at least one REVOKE matches by:
 *   - identifier name (case-insensitive for bare; case-sensitive for quoted),
 *   - signature-normalised args (whitespace-collapsed, case-folded) OR
 *     types-only-normalised args (PG accepts `(p_x integer)` and
 *     `(integer)` as equivalent REVOKE signatures),
 *   - grantee list contains `anon` (with or without PUBLIC/authenticated).
 *
 * **Why two normalisations:** real-world OPS-43 migrations use a mix of
 * named-with-types REVOKE signatures (`(p_x integer)`, the canonical form
 * matching `pg_get_function_arguments()`) and types-only REVOKE
 * signatures (`(integer)`, matching `pg_get_function_identity_arguments()`).
 * Both refer to the same function. Strict normalisation alone would
 * false-positive on the types-only form.
 */
export function matchRevokeForCreate(
  create: CreateFunctionRecord,
  revokes: RevokeRecord[],
): boolean {
  const createNamed = normaliseSignature(create.args);
  const createTypesOnly = extractTypesOnly(create.args);
  const targetName = create.isQuoted ? create.name : create.name.toLowerCase();
  for (const r of revokes) {
    const rName = r.isQuoted ? r.name : r.name.toLowerCase();
    if (create.isQuoted !== r.isQuoted) continue;
    if (rName !== targetName) continue;
    const revokeNamed = normaliseSignature(r.args);
    const revokeTypesOnly = extractTypesOnly(r.args);
    // Three acceptable matches:
    //   1. Both sides named-with-types and identical (whitespace-normalised).
    //   2. Both sides reduce to the same types-only signature (handles the
    //      mixed case where REVOKE is types-only and CREATE is named).
    //   3. CREATE named, REVOKE named, but one had argument-name drift —
    //      types-only fallback resolves it.
    // Comparing types-only on both sides is the universal lower-bound match
    // since PG itself uses pg_get_function_identity_arguments() (types only).
    const argsMatch =
      revokeNamed === createNamed || revokeTypesOnly === createTypesOnly;
    if (!argsMatch) continue;
    if (!r.grantees.some((g) => g.toLowerCase() === 'anon')) continue;
    return true;
  }
  return false;
}

// ── Allow-list checks ─────────────────────────────────────────────────────

/**
 * Validate the static allow-list against the spec §2.5 anti-pattern
 * guard: every entry must have `rationale.length >= 40` and must NOT
 * contain the placeholder string "TODO". `added_session` must be
 * non-empty.
 *
 * Throws on violation (caller exits 2 = infra failure).
 */
export function validateAllowList(list: ReadonlyArray<AllowListEntry>): void {
  for (const entry of list) {
    if (!entry.added_session || entry.added_session.trim().length === 0) {
      throw new Error(
        `Allow-list entry ${entry.signature} has missing added_session.`,
      );
    }
    if (entry.rationale.length < RATIONALE_MIN_LEN) {
      throw new Error(
        `Allow-list entry ${entry.signature} has rationale ` +
          `of length ${entry.rationale.length} < ${RATIONALE_MIN_LEN}. ` +
          `Spec §2.5 requires meaningful justification.`,
      );
    }
    if (/\bTODO\b/i.test(entry.rationale)) {
      throw new Error(
        `Allow-list entry ${entry.signature} contains placeholder ` +
          `string "TODO" in rationale. Spec §2.5: write a real ` +
          `rationale before merging.`,
      );
    }
  }
}

/**
 * Build the canonical signature for a CREATE record and check it against
 * the allow-list (whitespace-tolerant via normaliseSignature on args).
 */
export function isAllowListed(create: CreateFunctionRecord): boolean {
  const targetArgs = normaliseSignature(create.args);
  const targetName = create.isQuoted ? create.name : create.name.toLowerCase();
  for (const entry of INTENTIONAL_ANON_ALLOW_LIST) {
    // Parse the allow-list signature into name + args for tolerant comparison.
    // Format: `public.<name>(<args>)`.
    const m =
      /^public\.([a-zA-Z_][a-zA-Z0-9_]*|"[^"]+")\s*\(([\s\S]*)\)\s*$/.exec(
        entry.signature,
      );
    if (!m) continue;
    const rawName = m[1];
    const isQuoted = rawName.startsWith('"') && rawName.endsWith('"');
    const eName = isQuoted ? rawName.slice(1, -1) : rawName.toLowerCase();
    const eArgs = normaliseSignature(m[2]);
    if (isQuoted !== create.isQuoted) continue;
    if (eName !== targetName) continue;
    if (eArgs !== targetArgs) continue;
    return true;
  }
  return false;
}

// ── Formatter ─────────────────────────────────────────────────────────────

export function formatCreateSignature(create: CreateFunctionRecord): string {
  const name = create.isQuoted ? `"${create.name}"` : create.name;
  return `public.${name}(${create.args})`;
}

// ── Lint mode ─────────────────────────────────────────────────────────────

function listChangedMigrations(baseline: string): string[] {
  // spawnSync with args-array — no shell interpolation, safe by construction.
  // Pattern matches scripts/migration-replay-check.ts:454.
  const result = spawnSync(
    'git',
    [
      'diff',
      '--name-only',
      '--diff-filter=AM',
      `${baseline}...HEAD`,
      '--',
      'supabase/migrations/',
    ],
    { encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `git diff failed (status ${result.status}): ${result.stderr}`,
    );
  }
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.endsWith('.sql'));
}

function listFilesByGlob(glob: string): string[] {
  // For --files override, support either an explicit relative path or a
  // simple recursive glob. Use git ls-files to enumerate.
  const result = spawnSync('git', ['ls-files', glob], { encoding: 'utf-8' });
  if (result.status !== 0) {
    // Fallback: treat the glob as a literal path.
    return [glob];
  }
  const matches = result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.endsWith('.sql'));
  return matches.length > 0
    ? matches
    : [glob].filter((s) => s.endsWith('.sql'));
}

function lintFile(filePath: string): LintFinding[] {
  if (!existsSync(filePath)) {
    // File deleted in HEAD — nothing to lint.
    return [];
  }
  const raw = readFileSync(filePath, 'utf-8');
  const creates = extractCreateFunctions(raw);
  const revokes = extractRevokes(raw);

  const findings: LintFinding[] = [];
  for (const create of creates) {
    if (matchRevokeForCreate(create, revokes)) continue;
    const signature = formatCreateSignature(create);
    if (isAllowListed(create)) {
      findings.push({
        file: filePath,
        line: create.line,
        signature,
        kind: 'notice',
        message: `Allow-listed anon-callable function (no REVOKE required): ${signature}. See ${SPEC_PATH} §2.5.`,
      });
    } else {
      findings.push({
        file: filePath,
        line: create.line,
        signature,
        kind: 'error',
        message: `Missing REVOKE for ${signature} — see ${SPEC_PATH}`,
      });
    }
  }
  return findings;
}

function emitFinding(finding: LintFinding): void {
  const annotation = finding.kind === 'error' ? '::error' : '::notice';
  // GitHub Actions workflow command. console.log so both error and
  // notice annotations appear on stdout; GHA picks them up by prefix.
  console.log(
    `${annotation} file=${finding.file},line=${finding.line}::${finding.message}`,
  );
}

async function runLint(flags: CliFlags): Promise<number> {
  let files: string[];
  try {
    if (flags.files) {
      files = listFilesByGlob(flags.files);
    } else {
      files = listChangedMigrations(flags.baseline);
    }
  } catch (err) {
    console.error(
      `Failed to enumerate migration files: ${(err as Error).message}`,
    );
    return EXIT_INFRA_ERROR;
  }

  console.log(
    `REVOKE-guard lint (WP-OPS-43.3)\n` +
      `  baseline=${flags.baseline}\n` +
      `  files=${files.length}\n` +
      `  dry-run=${flags.dryRun}\n`,
  );

  if (files.length === 0) {
    console.log(
      `No migration files changed in diff. Nothing to lint. Exit OK.`,
    );
    return EXIT_OK;
  }

  // Stable ordering — ascending file path so re-runs produce identical
  // annotation order (AC-5 idempotency).
  files.sort();

  const allFindings: LintFinding[] = [];
  for (const file of files) {
    const findings = lintFile(file);
    findings.sort((a, b) => a.line - b.line);
    for (const f of findings) {
      emitFinding(f);
      allFindings.push(f);
    }
  }

  const errorCount = allFindings.filter((f) => f.kind === 'error').length;
  const noticeCount = allFindings.filter((f) => f.kind === 'notice').length;
  console.log(
    `\nFindings: ${errorCount} error(s), ${noticeCount} notice(s) ` +
      `across ${files.length} file(s).`,
  );

  if (errorCount === 0) {
    return EXIT_OK;
  }
  if (flags.dryRun) {
    console.log(
      `\n--dry-run set; would have exited ${EXIT_FAILURES}. Returning 0 ` +
        `(warn-on-find mode per D-OPS-43.3-3).`,
    );
    return EXIT_OK;
  }
  return EXIT_FAILURES;
}

// ── Cron mode ─────────────────────────────────────────────────────────────

interface CronAuditRow {
  schema_name: string;
  function_name: string;
  function_args: string;
  is_security_definer: boolean;
}

/**
 * Cron audit query (verbatim from spec §2.6). Read-only `SELECT`. The
 * allow-list IN-clause is built dynamically from `INTENTIONAL_ANON_ALLOW_LIST`
 * so adding a static-array entry automatically extends the cron filter.
 */
export function buildCronQuery(): string {
  const allowListLiterals = INTENTIONAL_ANON_ALLOW_LIST.map(
    (e) => `'${e.signature.replace(/'/g, "''")}'`,
  ).join(', ');
  return `SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS function_args,
       p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
       NOT IN (${allowListLiterals})
ORDER BY n.nspname, p.proname;`;
}

async function runCronQuery(
  accessToken: string,
  projectRef: string,
): Promise<CronAuditRow[]> {
  const url = `${MANAGEMENT_API_BASE}/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: buildCronQuery() }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Management API POST /database/query failed: HTTP ${res.status} — ` +
        `${body.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as CronAuditRow[];
  if (!Array.isArray(json)) {
    throw new Error(
      `Unexpected Management API response shape (expected array): ` +
        `${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

/**
 * Push a drift event to Sentry when SENTRY_AUTH_TOKEN + NEXT_PUBLIC_SENTRY_DSN
 * are both set. Uses the Sentry "store" REST endpoint directly — no SDK
 * init needed (avoids the silent: true masking class per memory
 * feedback_sentry_turbopack_silent_failure). For local-dev parity (AC-9)
 * the absence of either env var is graceful: log to stderr only.
 */
async function captureDriftToSentry(rows: CronAuditRow[]): Promise<void> {
  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

  if (!sentryAuthToken || !sentryDsn) {
    console.error(
      `[Sentry capture skipped] SENTRY_AUTH_TOKEN or NEXT_PUBLIC_SENTRY_DSN ` +
        `missing — drift events log to stderr only (local-dev parity).`,
    );
    for (const r of rows) {
      console.error(
        `[DRIFT] public.${r.function_name}(${r.function_args}) ` +
          `secdef=${r.is_security_definer}`,
      );
    }
    return;
  }

  // Parse the DSN to get the public key + project id + ingest host.
  const dsnMatch = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(sentryDsn);
  if (!dsnMatch) {
    console.error(
      `[Sentry capture skipped] NEXT_PUBLIC_SENTRY_DSN parse failed.`,
    );
    return;
  }
  const [, publicKey, host, projectId] = dsnMatch;
  const auditRunId = `revoke-guard-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  for (const r of rows) {
    const event = {
      message:
        `WP-OPS-43.3 drift: public.${r.function_name}(${r.function_args}) ` +
        `is anon-callable but not in allow-list.`,
      level: 'error',
      tags: {
        audit: 'revoke-guard-cron',
        function_name: r.function_name,
        is_security_definer: String(r.is_security_definer),
        audit_run_id: auditRunId,
      },
      extra: {
        schema_name: r.schema_name,
        function_args: r.function_args,
      },
    };
    const ingestUrl = `https://${host}/api/${projectId}/store/`;
    try {
      const response = await fetch(ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Auth': `Sentry sentry_version=7,sentry_key=${publicKey},sentry_client=kh-revoke-guard/1.0`,
        },
        body: JSON.stringify(event),
      });
      if (!response.ok) {
        // Surface upload failure to GHA logs (memory
        // feedback_sentry_turbopack_silent_failure — no silent: true).
        const body = await response.text();
        console.error(
          `[Sentry upload failed] HTTP ${response.status}: ${body.slice(0, 200)}`,
        );
      }
    } catch (err) {
      console.error(`[Sentry upload exception] ${(err as Error).message}`);
    }
  }
}

async function runCron(flags: CliFlags): Promise<number> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error(`Missing SUPABASE_ACCESS_TOKEN env var. See script header.`);
    return EXIT_INFRA_ERROR;
  }
  const projectRef = process.env.PROJECT_REF || PROD_PROJECT_REF;

  console.log(
    `REVOKE-guard cron audit (WP-OPS-43.3)\n` +
      `  project_ref=${projectRef}\n` +
      `  allow-list size=${INTENTIONAL_ANON_ALLOW_LIST.length}\n` +
      `  dry-run=${flags.dryRun}\n`,
  );

  let rows: CronAuditRow[];
  try {
    rows = await runCronQuery(accessToken, projectRef);
  } catch (err) {
    console.error(`Cron query failed: ${(err as Error).message}`);
    return EXIT_INFRA_ERROR;
  }

  console.log(`Drift rows returned: ${rows.length}`);

  if (rows.length === 0) {
    console.log(`No drift detected. Exit OK.`);
    return EXIT_OK;
  }

  // Emit ::error:: annotations + push to Sentry.
  for (const r of rows) {
    const sig = `public.${r.function_name}(${r.function_args})`;
    console.log(
      `::error::WP-OPS-43.3 cron drift — ${sig} is anon-callable but not in allow-list. See ${SPEC_PATH} §2.5 + §2.6.`,
    );
  }
  try {
    await captureDriftToSentry(rows);
  } catch (err) {
    // Sentry capture failure is logged but does not change exit code:
    // the drift itself is the signal we care about.
    console.error(`Sentry capture failed: ${(err as Error).message}`);
  }

  if (flags.dryRun) {
    console.log(
      `--dry-run set; would have exited ${EXIT_FAILURES}. Returning 0 ` +
        `(warn-on-find mode per D-OPS-43.3-3).`,
    );
    return EXIT_OK;
  }
  return EXIT_FAILURES;
}

// ── Orchestration ─────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const flags = parseCli();

  // Anti-pattern guard MUST run before any mode-specific work — refuses
  // to start if the allow-list contains placeholder rationale (AC-10).
  try {
    validateAllowList(INTENTIONAL_ANON_ALLOW_LIST);
  } catch (err) {
    console.error(`Allow-list validation failed: ${(err as Error).message}`);
    return EXIT_INFRA_ERROR;
  }

  if (flags.mode === 'lint') {
    return runLint(flags);
  }
  return runCron(flags);
}

// Guard top-level execution so the file is safely importable for unit
// testing of pure helpers (extractCreateFunctions, matchRevokeForCreate,
// validateAllowList, etc.).
const isMain =
  process.argv[1]?.endsWith('check-revoke-guard.ts') ||
  process.argv[1]?.endsWith('check-revoke-guard');
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Unhandled exception: ${(err as Error).message}`);
      process.exit(EXIT_INFRA_ERROR);
    });
}
