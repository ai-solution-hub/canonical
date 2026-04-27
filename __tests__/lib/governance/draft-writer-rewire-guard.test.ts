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
 * Wave-3 V2-M2 strengthening: switched from per-line scanning to
 * whole-file `matchAll()` so multi-line declarations like
 *
 *   {
 *     governance_review_status:
 *       'draft',
 *   }
 *
 * are caught — the `:` and the `'draft'` literal land on different lines,
 * which the prior per-line regex missed (false-negative). The line-aware
 * comment-exclusion logic is preserved by mapping each match's start
 * offset back to its containing line.
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
 *   governance_review_status:\n  'draft'   // multi-line key/value (V2-M2)
 *   .governance_review_status =\n  'draft' // multi-line assignment (V2-M2)
 *
 * Filter reads use `.eq('governance_review_status', 'draft')` /
 * `.or('governance_review_status.eq.draft')` — neither has `:` or `=` as
 * the separator between the column name and the literal value, so the
 * `[:=]` token in the regex naturally excludes them.
 *
 * The Zod schema declaration `governance_review_status: z.enum(['draft'])`
 * matches structurally on the column-name + `:` + something-then-`'draft'`,
 * but `\s*` between `:` and the quoted literal cannot span the `z.enum([`
 * non-whitespace tokens, so the regex correctly does NOT match the schema.
 *
 * `\s*` in JavaScript regex matches newlines without the `s` (dotAll)
 * flag (the `s` flag affects only `.`, not `\s`). The `s` flag is also
 * unavailable at the project's TS target (ES2017 → TS1501 if we used it),
 * which is fine — we don't need it.
 *
 * `g` flag is required for `matchAll()` (whole-file scan).
 */
const WRITE_PATTERN = /\bgovernance_review_status\s*[:=]\s*['"]draft['"]/g;

interface Hit {
  file: string;
  line: number;
  text: string;
}

/**
 * Scan a single file end-to-end with `matchAll`. For each match, locate
 * the containing line by counting `\n` chars before the match offset, and
 * return the trimmed line text for downstream comment-exclusion + violation
 * reporting. Whole-file scanning (rather than per-line) is the V2-M2 fix:
 * declarations whose `:`/`=` and `'draft'` literal land on different lines
 * are now caught.
 */
function findWriteHits(filePath: string): Hit[] {
  const content = readFileSync(filePath, 'utf-8');
  const hits: Hit[] = [];
  for (const match of content.matchAll(WRITE_PATTERN)) {
    const offset = match.index ?? 0;
    // Count newlines BEFORE the match offset to derive 1-based line number.
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (content.charCodeAt(i) === 10) line++;
    }
    // Compute the line text containing the match start. We use the line
    // start as `lastIndexOf('\n', offset - 1) + 1` (handles offset=0).
    const lineStart =
      offset === 0 ? 0 : content.lastIndexOf('\n', offset - 1) + 1;
    let lineEnd = content.indexOf('\n', offset);
    if (lineEnd === -1) lineEnd = content.length;
    const text = content.slice(lineStart, lineEnd).trim();
    hits.push({ file: filePath, line, text });
  }
  return hits;
}

function isExcluded(hit: Hit): boolean {
  const text = hit.text;
  // Schema declaration (back-compat read-side accept; not a write):
  //   governance_review_status: z.enum(['draft']).optional()
  // Note: the regex no longer matches Zod schemas naturally (because `\s*`
  // can't span `z.enum([`), but we keep the explicit exclusion for
  // defence-in-depth in case the regex relaxes in future.
  if (/z\.enum\s*\(/.test(text)) return true;
  // Single-line comment lines.
  if (/^\s*\/\//.test(text)) return true;
  // JSDoc / block comment lines (start with `*` after optional whitespace).
  if (/^\s*\*/.test(text)) return true;
  // Inline trailing comment that wraps the match — exclude if the match
  // is preceded by `//` on the same line.
  const matchIdx = text.search(WRITE_PATTERN);
  // Reset lastIndex on the global regex so the next search() call starts
  // fresh — `search()` does NOT consume `lastIndex`, but other call sites
  // using `test()` do.
  WRITE_PATTERN.lastIndex = 0;
  if (matchIdx > 0) {
    const before = text.slice(0, matchIdx);
    if (before.includes('//')) return true;
  }
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

  // -------------------------------------------------------------------------
  // V2-M2 — Inline regex behaviour suite. Verifies the WRITE_PATTERN catches
  // every write shape we care about and rejects every read/declaration shape
  // it must NOT flag. These are unit-level checks against the regex itself,
  // independent of the file walker — they would fail loudly if a future
  // refactor regresses the multi-line catch or relaxes the read exclusions.
  // -------------------------------------------------------------------------

  describe('WRITE_PATTERN regex behaviour (V2-M2)', () => {
    const cases: ReadonlyArray<{
      input: string;
      shouldMatch: boolean;
      label: string;
    }> = [
      // POSITIVE — writes that MUST match.
      {
        input: "governance_review_status: 'draft'",
        shouldMatch: true,
        label: 'single-line key/value',
      },
      {
        input: "  governance_review_status: 'draft',",
        shouldMatch: true,
        label: 'indented single-line key/value with trailing comma',
      },
      {
        input: 'body.governance_review_status = \'draft\';',
        shouldMatch: true,
        label: 'single-line assignment',
      },
      {
        input: "  governance_review_status:\n    'draft'",
        shouldMatch: true,
        label: 'multi-line key/value (newline + indent)',
      },
      {
        input: "  body.governance_review_status =\n    'draft'",
        shouldMatch: true,
        label: 'multi-line assignment (newline + indent)',
      },
      {
        input: 'governance_review_status: "draft"',
        shouldMatch: true,
        label: 'double-quoted literal',
      },
      // NEGATIVE — reads / declarations that must NOT match.
      {
        input: ".eq('governance_review_status', 'draft')",
        shouldMatch: false,
        label: 'PostgREST .eq() filter read',
      },
      {
        input: ".or('governance_review_status.eq.draft')",
        shouldMatch: false,
        label: 'PostgREST .or() filter read',
      },
      {
        input: ".neq('governance_review_status', 'draft')",
        shouldMatch: false,
        label: 'PostgREST .neq() filter read',
      },
      {
        input: "governance_review_status: z.enum(['draft'])",
        shouldMatch: false,
        label: 'Zod schema declaration (single value)',
      },
      {
        input: "governance_review_status: z.enum(['draft', 'pending'])",
        shouldMatch: false,
        label: 'Zod schema declaration (multi value)',
      },
    ];

    it.each(cases)(
      '$label — match=$shouldMatch',
      ({ input, shouldMatch }) => {
        // Reset lastIndex on the global regex before every test so prior
        // `test()` calls don't poison the result.
        WRITE_PATTERN.lastIndex = 0;
        expect(WRITE_PATTERN.test(input)).toBe(shouldMatch);
        WRITE_PATTERN.lastIndex = 0;
      },
    );

    it('comment lines are excluded by isExcluded() even when the regex matches', () => {
      // Comments inside production files would syntactically match the
      // WRITE_PATTERN regex (e.g. a JSDoc example showing the legacy form);
      // the line-level filter in isExcluded() must still drop them so the
      // guard does not false-positive.
      const commentLine = "// governance_review_status: 'draft' is the legacy form";
      const blockCommentLine = " * governance_review_status: 'draft'";
      const inlineTrailingComment =
        "const x = 1; // governance_review_status: 'draft'";

      WRITE_PATTERN.lastIndex = 0;
      expect(
        WRITE_PATTERN.test(commentLine),
        'precondition: regex matches comment-line content',
      ).toBe(true);
      WRITE_PATTERN.lastIndex = 0;
      expect(
        WRITE_PATTERN.test(blockCommentLine),
        'precondition: regex matches block-comment-line content',
      ).toBe(true);
      WRITE_PATTERN.lastIndex = 0;
      expect(
        WRITE_PATTERN.test(inlineTrailingComment),
        'precondition: regex matches inline-trailing-comment content',
      ).toBe(true);
      WRITE_PATTERN.lastIndex = 0;

      // isExcluded operates on the trimmed line text + a synthetic `Hit`
      // wrapper; reuse the same hit shape the file-walker emits.
      expect(
        isExcluded({ file: 'synthetic.ts', line: 1, text: commentLine }),
      ).toBe(true);
      expect(
        isExcluded({
          file: 'synthetic.ts',
          line: 1,
          text: blockCommentLine,
        }),
      ).toBe(true);
      expect(
        isExcluded({
          file: 'synthetic.ts',
          line: 1,
          text: inlineTrailingComment,
        }),
      ).toBe(true);
    });

    it('multi-line write spanning two lines is reported on the line containing the column name', () => {
      // The reporting contract: when a multi-line declaration is caught,
      // the `Hit.line` field points at the line where `governance_review_status`
      // appears (where a developer would land after grep/IDE navigation),
      // not the line where `'draft'` lives. This locks the line-mapping
      // arithmetic so a future refactor doesn't silently shift to the
      // value-line.
      const synthetic =
        "/* preamble */\n" +
        "const payload = {\n" +
        "  governance_review_status:\n" +
        "    'draft',\n" +
        "};\n";
      // Re-implement the file-walker's offset → line arithmetic on the
      // synthetic source (we can't easily mock readFileSync here, so we
      // exercise the same algorithm against an in-memory string).
      WRITE_PATTERN.lastIndex = 0;
      const matches = Array.from(synthetic.matchAll(WRITE_PATTERN));
      WRITE_PATTERN.lastIndex = 0;
      expect(matches).toHaveLength(1);
      const offset = matches[0]!.index ?? 0;
      let line = 1;
      for (let i = 0; i < offset; i++) {
        if (synthetic.charCodeAt(i) === 10) line++;
      }
      // `governance_review_status:` lives on line 3 of the synthetic
      // (1-indexed: preamble=1, opening brace=2, key=3, value=4, close=5).
      expect(line).toBe(3);
    });
  });
});
