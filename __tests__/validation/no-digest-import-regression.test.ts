/**
 * CI Guard: No Legacy `lib/digest` or `lib/ai/digest` Import Paths
 *
 * Prevents regression to the old `lib/digest/*` and `lib/ai/digest` import
 * paths after the S248 T5 code rename (PLAN.md §4.5).
 *
 * After the rename:
 *   lib/digest/digest-export.ts  → lib/change-reports/change-reports-export.ts
 *   lib/digest/digest-helpers.ts → lib/change-reports/change-reports-helpers.ts
 *   lib/ai/digest.ts             → lib/ai/change-reports.ts
 *
 * Any new import using the old paths should fail this guard and prompt the
 * author to use the `lib/change-reports/` equivalents.
 *
 * Allowlist: ast-dataflow query tooling uses the old path as an illustrative
 * example string in help output (not a real import). Those files are excluded.
 */

import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const PROJECT_ROOT = join(__dirname, '../..');

/**
 * Forbidden import path patterns — any `from` or `import()` statement
 * referencing these paths indicates a regression.
 * NOTE: Stored as strings and compiled at runtime to prevent this test file
 * from matching its own pattern strings.
 */
const FORBIDDEN_PATTERN_STRINGS = [
  String.raw`@` + `/lib/digest/`,
  `from ['"]` + String.raw`@` + `/lib/digest/`,
  `from ['"]` + String.raw`@` + `/lib/ai/digest['"]`,
  `vi\\.mock\\(['"]` + String.raw`@` + `/lib/digest/`,
  `vi\\.mock\\(['"]` + String.raw`@` + `/lib/ai/digest['"]`,
];
const FORBIDDEN_PATTERNS = FORBIDDEN_PATTERN_STRINGS.map((s) => new RegExp(s));

/**
 * Directories to scan for source files.
 * Excludes: node_modules, .next, supabase/migrations, .planning, .archive,
 * lib/ast-dataflow (tooling examples), scripts/ast-dataflow-cli.ts (tooling).
 */
const SCAN_DIRS = ['lib', 'app', 'components', 'hooks', '__tests__'];

/**
 * Files excluded from the guard (known-intentional references).
 * These are tooling files that reference the old path as example strings,
 * not real imports.
 */
const EXCLUDE_FILES = new Set([
  'lib/ast-dataflow/queries/importers.ts',
  'lib/ast-dataflow/types.ts',
  'scripts/ast-dataflow-cli.ts',
  // This guard file itself contains the forbidden strings as pattern strings
  '__tests__/validation/no-digest-import-regression.test.ts',
]);

/**
 * Recursively collect all .ts and .tsx files under a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const abs = join(PROJECT_ROOT, dir);
  const results: string[] = [];
  try {
    const entries = readdirSync(abs);
    for (const entry of entries) {
      const rel = `${dir}/${entry}`;
      const full = join(PROJECT_ROOT, rel);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        // Skip node_modules, .next, and archive directories
        if (
          entry === 'node_modules' ||
          entry === '.next' ||
          entry.startsWith('.')
        )
          continue;
        results.push(...collectSourceFiles(rel));
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        results.push(rel);
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
  return results;
}

describe('No legacy lib/digest import regression guard (S248 T5)', () => {
  it('no source file imports from @/lib/digest/* (old path)', () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRS) {
      const files = collectSourceFiles(dir);
      for (const relPath of files) {
        if (EXCLUDE_FILES.has(relPath)) continue;

        const content = readFileSync(join(PROJECT_ROOT, relPath), 'utf8');

        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(content)) {
            violations.push(
              `${relPath} — matches forbidden pattern: ${pattern.toString()}`,
            );
            break; // One violation per file is enough
          }
        }
      }
    }

    expect(
      violations,
      'Found files importing from old lib/digest/* or lib/ai/digest paths. ' +
        'Use lib/change-reports/* and lib/ai/change-reports instead (S248 T5 rename). ' +
        'Violations:\n' +
        violations.join('\n'),
    ).toHaveLength(0);
  });
});
