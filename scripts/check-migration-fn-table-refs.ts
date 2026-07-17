#!/usr/bin/env bun
/**
 * ID-145 {145.37} SLICE B — pre-push gate: catch a function BODY left
 * pointing at a table that a migration on THIS branch renamed/dropped away.
 *
 * ROOT CAUSE THIS GUARDS AGAINST (S476 retro): W1 ({145.6} w1c) renamed
 * `public.form_templates` -> `form_instances`, but Postgres does not track a
 * dependency on a function BODY the way it does on a view — the RENAME
 * silently left four search-RPC functions (hybrid_search,
 * search_for_form_response, get_aggregate_win_rate_stats,
 * get_content_win_rate) throwing `relation "form_templates" does not exist`
 * on every call. tsc never sees SQL string bodies, and no prior gate checked
 * CREATE FUNCTION bodies against a table renamed/dropped earlier in the SAME
 * migration set. This script is that gate.
 *
 * DETECTION CONTRACT:
 *   1. "Removed tables" = tables renamed-away or dropped by the PENDING
 *      migration set (this branch's diff vs `main`), final-state aware (a
 *      table renamed away and then recreated/re-renamed back within the same
 *      pending set is NOT "removed").
 *   2. "Live functions" = the LAST-WRITER `CREATE [OR REPLACE] FUNCTION` body
 *      for every function name across the FULL migration history (not just
 *      the pending set — the whole point of the {145.37} class is that the
 *      stale body usually lives OUTSIDE the pending batch), excluding any
 *      function DROPped at final state.
 *   3. Flag any live function whose body references a removed table's OLD
 *      name as a SQL identifier (schema-qualified or bare, whole-word,
 *      comment-aware — never a CREATE TRIGGER's `ON <table>` clause, which
 *      is attachment-by-OID and follows a rename automatically).
 *
 * Usage:   bun scripts/check-migration-fn-table-refs.ts
 *          (alias: `bun run check:migration-fn-table-refs`)
 * Exit:    0 — clean; 1 — one or more stale-reference offenders found.
 *
 * NOT wired into CI by this Subtask (push-scope only) — see the {145.37}
 * SLICE B executor report for the CI-wiring handoff note.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MigrationFile {
  /** Repo-relative path, e.g. `supabase/migrations/20260716120000_foo.sql`. */
  path: string;
  sql: string;
}

export interface StaleFunctionTableRef {
  /** `schema.function_name`, lower-cased. */
  functionKey: string;
  /** `path:line` of the function's last-writer `CREATE FUNCTION` statement. */
  definedAt: string;
  /** The removed table's bare name (lower-cased), as it appears in the body. */
  removedTable: string;
  /** Path of the pending migration that removed `removedTable`. */
  removedBy: string;
}

/**
 * Allowlist for a documented, verified-safe false positive, keyed
 * `"schema.function_name|table_name"`. Prefer fixing the detector (comment
 * stripping, dollar-quote boundaries, whole-word matching) over adding an
 * entry here — this exists only for a residual case that genuinely can't be
 * distinguished structurally. Empty at time of writing: every false-positive
 * trap identified during {145.37} SLICE A (trigger `ON <table>` bleed,
 * `form_templates_outcome_form_type_check`-style identifier prefixes,
 * squash-baseline table+function co-definition) is handled by the parser
 * itself, not by allowlisting.
 */
export const KNOWN_SAFE: ReadonlySet<string> = new Set<string>([]);

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const QIDENT = `"?(${IDENT})"?`;

/**
 * Strip `--` line comments and block comments, respecting `'...'` string
 * literals (with `''` escaping). Dollar-quoted bodies are extracted by the
 * caller before this runs, so no dollar-quote awareness is needed here.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (inString) {
      out += c;
      if (c === "'") {
        if (next === "'") {
          out += next;
          i += 2;
          continue;
        }
        inString = false;
      }
      i++;
      continue;
    }
    if (c === "'") {
      inString = true;
      out += c;
      i++;
      continue;
    }
    if (c === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function lineOf(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (sql[i] === '\n') line++;
  }
  return line;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Step 1 — removed tables, computed from the PENDING migration set only,
// final-state aware.
// ---------------------------------------------------------------------------

interface TableEvent {
  pos: number;
  kind: 'rename' | 'drop' | 'create';
  oldName?: string;
  newName?: string;
  name?: string;
}

const RENAME_TABLE_RE = new RegExp(
  `ALTER\\s+TABLE\\s+(?:${QIDENT}\\s*\\.\\s*)?${QIDENT}\\s+RENAME\\s+TO\\s+${QIDENT}`,
  'gi',
);
const DROP_TABLE_RE = new RegExp(
  `DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:${QIDENT}\\s*\\.\\s*)?${QIDENT}`,
  'gi',
);
const CREATE_TABLE_RE = new RegExp(
  `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:${QIDENT}\\s*\\.\\s*)?${QIDENT}`,
  'gi',
);

/** Provenance for a removed table: which pending migration removed it. */
interface RemovedTableInfo {
  removedBy: string;
}

export function computeRemovedTables(
  pendingMigrationsInOrder: readonly MigrationFile[],
): Map<string, RemovedTableInfo> {
  const removed = new Map<string, RemovedTableInfo>();
  for (const file of pendingMigrationsInOrder) {
    const clean = stripSqlComments(file.sql);
    const events: TableEvent[] = [];

    for (const m of clean.matchAll(RENAME_TABLE_RE)) {
      // Groups: [1]=schema (optional), [2]=old table, [3]=new table.
      events.push({
        pos: m.index ?? 0,
        kind: 'rename',
        oldName: m[2].toLowerCase(),
        newName: m[3].toLowerCase(),
      });
    }
    for (const m of clean.matchAll(DROP_TABLE_RE)) {
      events.push({
        pos: m.index ?? 0,
        kind: 'drop',
        name: m[2].toLowerCase(),
      });
    }
    for (const m of clean.matchAll(CREATE_TABLE_RE)) {
      events.push({
        pos: m.index ?? 0,
        kind: 'create',
        name: m[2].toLowerCase(),
      });
    }

    events.sort((a, b) => a.pos - b.pos);
    for (const e of events) {
      if (e.kind === 'rename') {
        removed.set(e.oldName!, { removedBy: file.path });
        removed.delete(e.newName!);
      } else if (e.kind === 'drop') {
        removed.set(e.name!, { removedBy: file.path });
      } else {
        removed.delete(e.name!);
      }
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Step 2 — last-writer function bodies across FULL migration history.
// ---------------------------------------------------------------------------

interface FunctionDef {
  body: string;
  path: string;
  line: number;
}

const FUNCTION_HEADER_RE =
  /(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DROP\s+FUNCTION)/gi;
const FUNCTION_NAME_RE = new RegExp(
  `^\\s*(?:IF\\s+EXISTS\\s+)?(?:${QIDENT}\\s*\\.\\s*)?${QIDENT}\\s*\\(`,
  'i',
);
const DOLLAR_TAG_RE = /\$([A-Za-z_]*)\$/g;

/**
 * Walks every migration in chronological order, applying CREATE/REPLACE and
 * DROP FUNCTION events as it goes, so the result is the LIVE (last-writer,
 * not-dropped) definition for every function key. Correctly skips PAST each
 * extracted body (via the matching dollar-quote close tag) before resuming
 * the scan, so text inside a body (dynamic SQL, comments) can never be
 * mistaken for a subsequent CREATE/DROP FUNCTION statement, and a CREATE
 * TRIGGER ... ON <table> clause that follows a function's closing tag is
 * never folded into that function's body.
 */
export function computeLastWriterFunctions(
  migrationsInChronologicalOrder: readonly MigrationFile[],
): Map<string, FunctionDef> {
  const lastWriter = new Map<string, FunctionDef>();

  for (const file of migrationsInChronologicalOrder) {
    const sql = file.sql;
    const headerRe = new RegExp(FUNCTION_HEADER_RE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = headerRe.exec(sql))) {
      const isDrop = /DROP/i.test(m[1]);
      const afterKeyword = m.index + m[0].length;
      const tail = sql.slice(afterKeyword, afterKeyword + 500);
      const nameMatch = FUNCTION_NAME_RE.exec(tail);
      if (!nameMatch) continue; // malformed / not a real function header — skip defensively

      const schema = (nameMatch[1] ?? 'public').toLowerCase();
      const name = nameMatch[2].toLowerCase();
      const key = `${schema}.${name}`;
      const line = lineOf(sql, m.index);

      if (isDrop) {
        lastWriter.delete(key);
        headerRe.lastIndex = afterKeyword + nameMatch[0].length;
        continue;
      }

      // CREATE [OR REPLACE] FUNCTION — locate the body's dollar-quote tag
      // (the first `$tag$` at/after the signature) and its matching close.
      DOLLAR_TAG_RE.lastIndex = afterKeyword;
      const openTag = DOLLAR_TAG_RE.exec(sql);
      if (!openTag) {
        // No body found (e.g. a LANGUAGE SQL one-liner some other shape) —
        // nothing to scan; resume just past the signature.
        headerRe.lastIndex = afterKeyword + nameMatch[0].length;
        continue;
      }
      const tag = openTag[1];
      const bodyStart = openTag.index + openTag[0].length;
      const closeLiteral = `$${tag}$`;
      const closeIdx = sql.indexOf(closeLiteral, bodyStart);
      if (closeIdx === -1) {
        headerRe.lastIndex = bodyStart;
        continue;
      }
      const body = sql.slice(bodyStart, closeIdx);
      lastWriter.set(key, { body, path: file.path, line });
      headerRe.lastIndex = closeIdx + closeLiteral.length;
    }
  }

  return lastWriter;
}

// ---------------------------------------------------------------------------
// Step 3 — flag live functions whose body references a removed table.
// ---------------------------------------------------------------------------

export function detectStaleTableRefsInFunctions(
  allMigrations: readonly MigrationFile[],
  pendingPaths: readonly string[],
  knownSafe: ReadonlySet<string> = KNOWN_SAFE,
): StaleFunctionTableRef[] {
  const sorted = [...allMigrations].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const pendingSet = new Set(pendingPaths);
  const pendingInOrder = sorted.filter((f) => pendingSet.has(f.path));

  const removed = computeRemovedTables(pendingInOrder);
  if (removed.size === 0) return [];

  const lastWriter = computeLastWriterFunctions(sorted);

  const offenders: StaleFunctionTableRef[] = [];
  for (const [key, def] of lastWriter) {
    const cleanBody = stripSqlComments(def.body);
    for (const [table, info] of removed) {
      if (knownSafe.has(`${key}|${table}`)) continue;
      const re = new RegExp(`\\b${escapeRegExp(table)}\\b`, 'i');
      if (re.test(cleanBody)) {
        offenders.push({
          functionKey: key,
          definedAt: `${def.path}:${def.line}`,
          removedTable: table,
          removedBy: info.removedBy,
        });
      }
    }
  }

  offenders.sort(
    (a, b) =>
      a.functionKey.localeCompare(b.functionKey) ||
      a.removedTable.localeCompare(b.removedTable),
  );
  return offenders;
}

// ---------------------------------------------------------------------------
// CLI driver
// ---------------------------------------------------------------------------

function resolveMainRef(): string {
  for (const ref of ['main', 'origin/main']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return ref;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'check-migration-fn-table-refs: could not resolve a main ref (tried "main", "origin/main")',
  );
}

function gitPendingMigrationPaths(): string[] {
  const mainRef = resolveMainRef();
  const mergeBase = execFileSync('git', ['merge-base', 'HEAD', mainRef], {
    encoding: 'utf8',
  }).trim();
  const out = execFileSync(
    'git',
    ['diff', '--name-only', `${mergeBase}..HEAD`, '--', 'supabase/migrations/'],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter((l) => l.length > 0);
}

function readAllMigrations(): MigrationFile[] {
  const dir = 'supabase/migrations';
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const path = join(dir, f);
      return { path, sql: readFileSync(path, 'utf8') };
    });
}

function main(): number {
  console.log(
    '[check-migration-fn-table-refs] auditing pending migrations for stale function-body table refs…',
  );

  const pendingPaths = gitPendingMigrationPaths();
  console.log(
    pendingPaths.length > 0
      ? `  pending migration(s): ${pendingPaths.join(', ')}`
      : '  pending migration(s): none',
  );

  const allMigrations = readAllMigrations();
  const offenders = detectStaleTableRefsInFunctions(
    allMigrations,
    pendingPaths,
  );

  if (offenders.length === 0) {
    console.log(
      '[check-migration-fn-table-refs] OK — no live function references a table removed by the pending migration set.',
    );
    return 0;
  }

  console.error(
    `[check-migration-fn-table-refs] FAIL — ${offenders.length} stale reference(s):`,
  );
  for (const o of offenders) {
    console.error(
      `  ${o.functionKey} (defined ${o.definedAt}) still references "${o.removedTable}", removed by ${o.removedBy}`,
    );
  }
  console.error(
    '\nA pending migration renamed/dropped a table but a live function body ' +
      'elsewhere in migration history still references the old name — the ' +
      '{145.37} class (Postgres does not track a dependency on a function ' +
      'body). Add a CREATE OR REPLACE FUNCTION to this migration set that ' +
      're-points the offending function(s), or escalate if the reference is ' +
      'a genuine false positive.',
  );
  return 1;
}

if (import.meta.main) {
  process.exit(main());
}
