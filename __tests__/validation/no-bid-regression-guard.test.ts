/**
 * Guard test — T4 procurement umbrella rename regression prevention.
 *
 * Per `docs/specs/0.9-canonical-pipeline/TECH.md` P-40 + P-42 validation:
 *
 * - **P-40:** `grep -rn "project_id" lib/ scripts/ app/ components/`
 *   returns zero hits; CI test prevents regression.
 * - **P-42:** `grep -rn "BID_STATES\|bid_workspaces\|lib/bid" lib/ scripts/
 *   app/ components/` returns zero hits post-rename; CI test prevents
 *   regression.
 *
 * Shipped S248 WP2 (T4) — `lib/bid/* → lib/procurement/*`, `BID_STATES →
 * PROCUREMENT_WORKFLOW_STATES`, `bid_workspaces → procurement_workspaces`
 * (T2 migration S246/S247); `bid_questions.project_id →
 * bid_questions.workspace_id` + `templates.project_id → templates.workspace_id`
 * (T2 migration).
 *
 * If a future change reintroduces any forbidden pattern, this guard fails
 * loudly. The fix is to rename to the canonical form, NOT to extend the
 * allowlist below.
 *
 * Allowlist scope (intentional historical refs only):
 * - `__tests__/validation/no-bid-regression-guard.test.ts` (this file —
 *   embeds the forbidden patterns as string constants for grep).
 * - `lib/ast-dataflow/` — internal test fixtures may reference project_id
 *   as a demo column name (out of procurement scope).
 * - `lib/mcp/formatters/bids.ts` — deferred per Liam S248 ratification
 *   pending form_type investigation.
 * - `lib/ai/skills/bid-writing.md` — deferred per same ratification.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'scripts', 'app', 'components'] as const;

/**
 * Files allowed to contain forbidden patterns. Path relative to REPO_ROOT.
 * Keep narrow — each entry needs a comment citing the carve-out reason.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  // This guard test embeds the patterns as string constants.
  '__tests__/validation/no-bid-regression-guard.test.ts',
  // ast-dataflow internal test fixtures (out of procurement scope).
  'lib/ast-dataflow/queries/column-reads.ts',
  'lib/ast-dataflow/queries/column-writes.ts',
  'lib/ast-dataflow/queries/flow-trace.ts',
  'lib/ast-dataflow/types.ts',
  'scripts/ast-dataflow-cli.ts',
  // Deferred renames per Liam S248 ratification (pending form_type
  // investigation — see continuation prompt WP2 scope answers).
  'lib/mcp/formatters/bids.ts',
  'lib/ai/skills/bid-writing.md',
  // RPC `get_bid_question_stats_batch` returns a `project_id` field in
  // its return shape (DB function signature unchanged at T2 — only the
  // backing column was renamed). Code reads `row.project_id` from the
  // RPC payload — semantically a column-name accessor on the RPC return
  // type, not the bid_questions column.
  'lib/procurement/procurement-queries.ts',
  'app/api/procurement/route.ts',
]);

/**
 * Forbidden patterns. Each MUST be paired with a corrected form below.
 * Patterns are matched as substrings (not regex) for simplicity.
 */
const FORBIDDEN_PATTERNS = [
  'BID_STATES',
  'bid_workspaces',
  // 'lib/bid' deliberately not included — it's a substring of acceptable
  // strings like 'lib/bid-library' (renamed but might appear in archived
  // migration notes) or library names. Path/import-style checks happen
  // at the module-resolver layer (tsc).
] as const;

/**
 * Recursively enumerate .ts/.tsx files under a directory, skipping
 * node_modules and .next.
 */
function* walkSync(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkSync(full);
    } else if (stat.isFile() && /\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

describe('no-bid-regression-guard', () => {
  it.each(FORBIDDEN_PATTERNS)(
    'no production file contains forbidden pattern: %s',
    (pattern) => {
      const offenders: string[] = [];
      for (const dir of SCAN_DIRS) {
        for (const file of walkSync(join(REPO_ROOT, dir))) {
          const rel = relative(REPO_ROOT, file);
          if (ALLOWLIST.has(rel)) continue;
          const contents = readFileSync(file, 'utf-8');
          if (contents.includes(pattern)) {
            offenders.push(rel);
          }
        }
      }
      expect(
        offenders,
        `Pattern "${pattern}" found in ${offenders.length} unallowlisted file(s) — T4 procurement rename regression. Fix: rename per docs/specs/0.9-canonical-pipeline/TECH.md P-42 (BID_STATES → PROCUREMENT_WORKFLOW_STATES; bid_workspaces → procurement_workspaces).`,
      ).toEqual([]);
    },
  );

  it('no production file contains `project_id` column reference (T4 P-40)', () => {
    // Targeted check: `project_id` is the dropped DB column name post-T2.
    // RPC param names (`p_project_id`, `p_project_ids`) are allowed —
    // those are DB function signatures, not column reads.
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walkSync(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file);
        if (ALLOWLIST.has(rel)) continue;
        const contents = readFileSync(file, 'utf-8');
        // Match `project_id` only when NOT preceded by `p_` (i.e. exclude
        // RPC params `p_project_id` and `p_project_ids`).
        if (/(?<!p_)project_id/.test(contents)) {
          offenders.push(rel);
        }
      }
    }
    expect(
      offenders,
      `Bare \`project_id\` found in ${offenders.length} unallowlisted file(s) — T4 P-40 regression. Fix: rename to \`workspace_id\` per T2 schema migration. RPC params \`p_project_id\` / \`p_project_ids\` are allowed (DB function signatures unchanged).`,
    ).toEqual([]);
  });
});
