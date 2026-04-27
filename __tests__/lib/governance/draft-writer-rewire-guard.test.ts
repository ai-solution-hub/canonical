/**
 * S202 §5.2 Phase 2.5 (T8b) — AC6.5 draft-writer rewire guard.
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §9.6 AC6.5.
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T8b acceptance criteria.
 *
 * After Phase 2.5 (T8a writers + T8b reads), zero production code paths
 * should write `governance_review_status='draft'`. The canonical save-as-
 * draft writer is `publication_status='draft'`. This guard greps every
 * production file (`app/`, `lib/`, `hooks/`, `scripts/`) for write-position
 * matches and fails if any survive — preventing future regressions where a
 * new entry point silently re-introduces the legacy write.
 *
 * Pattern is dynamic per `feedback_guard_test_iteration_list_drift`: the
 * test never hand-maintains a file list; it walks the production
 * directories at test time, scoped to .ts/.tsx files, with mechanical
 * exclusions for tests, fixtures, comments, and the back-compat schema
 * declaration.
 *
 * After Phase 1f (T9) NULLs the legacy column, this guard remains in place
 * to defend the invariant.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const INCLUDE_DIRS = ['app', 'lib', 'hooks', 'scripts'];

// Directory segments to skip — tests, fixtures, build artefacts, MCP eval
// scaffolding (which exercises legacy back-compat against the MCP tool
// surface and is not production code).
const EXCLUDE_DIR_SEGMENTS = [
  'node_modules',
  '.next',
  '.turbo',
  '__tests__',
  'fixtures',
  'mcp-eval',
  '__pycache__',
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (EXCLUDE_DIR_SEGMENTS.some((seg) => full.includes(seg))) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(tsx|ts)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = INCLUDE_DIRS.flatMap((d) =>
  walk(path.join(REPO_ROOT, d)),
);

/**
 * Write-position pattern. Matches both:
 *
 *   governance_review_status: 'draft'      // object literal key/value
 *   governance_review_status: "draft"      // double-quoted variant
 *   .governance_review_status = 'draft'    // member assignment
 *
 * Filter reads use `.eq(`, `.or(`, `.neq(`, `.is.null` — those never have
 * the structural `:` or `=` token between the column name and the literal.
 * The Zod schema declaration `governance_review_status: z.enum(['draft'])`
 * matches the regex but is excluded below by the `z.enum` filter.
 */
const WRITE_PATTERN = /governance_review_status\s*[:=]\s*['"]draft['"]/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function findWriteHits(filePath: string): Hit[] {
  const content = readFileSync(filePath, 'utf-8');
  const hits: Hit[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!WRITE_PATTERN.test(line)) continue;
    hits.push({ file: filePath, line: i + 1, text: line.trim() });
  }
  return hits;
}

function isExcluded(hit: Hit): boolean {
  const text = hit.text;
  // Schema declaration (back-compat read-side accept; not a write):
  //   governance_review_status: z.enum(['draft']).optional()
  if (/z\.enum\s*\(/.test(text)) return true;
  // Single-line comment lines.
  if (/^\s*\/\//.test(text)) return true;
  // JSDoc / block comment lines (start with `*` after optional whitespace).
  if (/^\s*\*/.test(text)) return true;
  // Inline trailing comment that wraps the match — capture lines where the
  // pattern is preceded by `//` on the same line (very rare in practice but
  // defensive).
  const matchIdx = text.search(WRITE_PATTERN);
  const before = text.slice(0, matchIdx);
  if (before.includes('//')) return true;
  return false;
}

describe('AC6.5 — draft-writer rewire guard (S202 §5.2 Phase 2.5)', () => {
  it("zero production WRITE-sites of governance_review_status='draft' across app/, lib/, hooks/, scripts/", () => {
    const violations: string[] = [];
    for (const file of SOURCE_FILES) {
      const hits = findWriteHits(file);
      for (const hit of hits) {
        if (isExcluded(hit)) continue;
        const rel = hit.file.replace(REPO_ROOT + '/', '');
        violations.push(`${rel}:${hit.line} — ${hit.text}`);
      }
    }
    expect(
      violations,
      "Production WRITE-site of governance_review_status='draft' found.\n" +
        'These must be rewired to publication_status=\'draft\' per S202 §5.2 Phase 2.5.\n' +
        'Hits:\n' +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('canonical writer publication_status=\'draft\' is reachable from at least one production entry point', () => {
    // Sanity-check the inverse: T8a rewired several entry points to write
    // `publication_status: 'draft'`. If every one of those vanished (e.g. a
    // wholesale deletion), the AC6.5 invariant would still hold trivially
    // and the codebase would have no save-as-draft writer at all. Confirm
    // at least one literal `publication_status: 'draft'` write survives.
    const writerPattern = /publication_status\s*:\s*['"]draft['"]/;
    let writerCount = 0;
    for (const file of SOURCE_FILES) {
      const content = readFileSync(file, 'utf-8');
      if (writerPattern.test(content)) writerCount++;
    }
    expect(writerCount).toBeGreaterThan(0);
  });
});
