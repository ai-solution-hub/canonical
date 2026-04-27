#!/usr/bin/env bun
/**
 * Codebase Statistics Generator
 *
 * Collects file-countable and code-parsable statistics from the Knowledge Hub
 * codebase. Outputs JSON and Markdown to docs/generated/.
 *
 * Usage:
 *   bun run scripts/generate-codebase-stats.ts [options]
 *
 * Options:
 *   --full        Run test suites and lint to collect runtime stats
 *   --db          Query Supabase for database stats (needs env vars)
 *   --json-only   Only output JSON (skip Markdown generation)
 *   --stdout      Print JSON to stdout instead of writing files
 *   --check       Compare against existing stats file, exit 1 if changed
 */

import { globSync } from 'glob';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'generated');
const JSON_OUTPUT = path.join(OUTPUT_DIR, 'codebase-stats.json');
const MD_OUTPUT = path.join(OUTPUT_DIR, 'codebase-stats.md');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count files matching a glob pattern (relative to ROOT). */
export function countFiles(pattern: string): number {
  return globSync(pattern, { cwd: ROOT }).length;
}

/** Count top-level directories under a given path (relative to ROOT). */
export function countTopLevelDirs(dir: string): number {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return 0;
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory()).length;
}

/** Read a file and count occurrences of patterns (simple string match). */
function countPatternsInFiles(filePattern: string, patterns: string[]): number {
  const files = globSync(filePattern, { cwd: ROOT });
  let total = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    for (const pat of patterns) {
      let idx = 0;
      while (true) {
        const found = content.indexOf(pat, idx);
        if (found === -1) break;
        total++;
        idx = found + pat.length;
      }
    }
  }
  return total;
}

/** Count entries in a JS/TS array literal by extracting quoted strings. */
function countArrayEntries(filePath: string, arrayName: string): number {
  const abs = path.join(ROOT, filePath);
  if (!fs.existsSync(abs)) return 0;
  const content = fs.readFileSync(abs, 'utf-8');

  const startMarker = `${arrayName} = [`;
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return 0;

  const bracketStart = content.indexOf('[', startIdx);
  let depth = 0;
  let bracketEnd = -1;
  for (let i = bracketStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    if (content[i] === ']') {
      depth--;
      if (depth === 0) {
        bracketEnd = i;
        break;
      }
    }
  }
  if (bracketEnd === -1) return 0;

  const arrayBody = content.slice(bracketStart + 1, bracketEnd);
  const matches = arrayBody.match(/['"][^'"]+['"]/g);
  return matches ? matches.length : 0;
}

/** Format a date in UK English format (DD/MM/YYYY HH:mm). */
function formatUKDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// ---------------------------------------------------------------------------
// File-countable stats (spec section 3.1)
// ---------------------------------------------------------------------------

export function collectFileStats(): Record<string, number> {
  const componentsTotal = countFiles('components/**/*.tsx');
  const componentsShadcn = countFiles('components/ui/*.tsx');

  const libTotal = countFiles('lib/**/*.ts');
  const libGenerated =
    countFiles('lib/mcp/app-bundles.ts') +
    countFiles('lib/mcp/plugin-bundle.ts');

  return {
    vitest_test_files: countFiles('__tests__/**/*.test.*'),
    e2e_spec_files: countFiles('e2e/tests/*.spec.ts'),
    python_test_files: countFiles('scripts/tests/test_*.py'),
    migrations: countFiles('supabase/migrations/*.sql'),
    api_route_files: countFiles('app/api/**/route.ts'),
    api_route_groups: countTopLevelDirs('app/api'),
    page_routes: countFiles('app/**/page.tsx'),
    components_total: componentsTotal,
    components_custom: componentsTotal - componentsShadcn,
    components_shadcn: componentsShadcn,
    hooks: countFiles('hooks/*.ts'),
    contexts: countFiles('contexts/*.tsx'),
    lib_modules_toplevel: countFiles('lib/*.ts'),
    lib_modules_total: libTotal - libGenerated,
    type_files: countFiles('types/*.ts'),
    ai_modules: countFiles('lib/ai/*.ts'),
    ai_skill_files: countFiles('lib/ai/skills/*.md'),
    validation_files: countFiles('lib/validation/*.ts'),
    extraction_files: countFiles('lib/extraction/*.ts'),
    pipeline_modules: countFiles('scripts/kb_pipeline/*.py'),
    mcp_tool_category_files:
      countFiles('lib/mcp/tools/*.ts') -
      (fs.existsSync(path.join(ROOT, 'lib/mcp/tools/index.ts')) ? 1 : 0) -
      (fs.existsSync(path.join(ROOT, 'lib/mcp/tools/shared.ts')) ? 1 : 0),
    mcp_apps: countTopLevelDirs('mcp-apps'),
    quality_checks: countFiles('.claude/checks/*.md'),
    cron_routes: countFiles('app/api/cron/**/route.ts'),
  };
}

// ---------------------------------------------------------------------------
// Code-parsable stats (spec section 3.2)
// ---------------------------------------------------------------------------

export function collectCodeStats(): Record<string, number> {
  return {
    mcp_tools: countPatternsInFiles('lib/mcp/tools/*.ts', [
      'defineTool(',
      'defineAppTool(',
    ]),
    mcp_resources: countPatternsInFiles('lib/mcp/resources.ts', [
      'registerResource(',
      'registerAppResource(',
    ]),
    mcp_prompts: countPatternsInFiles('lib/mcp/resources.ts', [
      'registerPrompt(',
    ]),
    content_types: countArrayEntries(
      'lib/validation/schemas.ts',
      'VALID_CONTENT_TYPES',
    ),
  };
}

// ---------------------------------------------------------------------------
// Runtime stats (spec section 3.3, --full flag)
// ---------------------------------------------------------------------------

export interface RuntimeStats {
  vitest_test_count: number | null;
  python_test_count: number | null;
  lint_errors: number | null;
  lint_warnings: number | null;
}

/**
 * Collect runtime stats by executing test and lint commands.
 * Uses execFileSync with explicit argument arrays (no shell injection risk).
 */
export function collectRuntimeStats(): RuntimeStats {
  const stats: RuntimeStats = {
    vitest_test_count: null,
    python_test_count: null,
    lint_errors: null,
    lint_warnings: null,
  };

  // Vitest count
  try {
    const result = execFileSync(
      'bun',
      ['run', 'test', '--run', '--reporter=json'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 300_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const jsonLines = result
      .split('\n')
      .filter((l) => l.trim().startsWith('{'));
    for (const line of jsonLines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.numTotalTests !== undefined) {
          stats.vitest_test_count = parsed.numTotalTests;
          break;
        }
      } catch {
        // Not valid JSON line, skip
      }
    }
    if (stats.vitest_test_count === null) {
      try {
        const parsed = JSON.parse(result);
        if (parsed.numTotalTests !== undefined) {
          stats.vitest_test_count = parsed.numTotalTests;
        }
      } catch {
        // Could not parse full output
      }
    }
  } catch {
    console.warn('  Warning: Could not collect vitest test count');
  }

  // Python test count
  try {
    const result = execFileSync(
      'python3',
      ['-m', 'pytest', 'scripts/tests/', '--co', '-q'],
      {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const testLines = result.split('\n').filter((l) => l.includes('::')).length;
    if (testLines > 0) {
      stats.python_test_count = testLines;
    }
  } catch {
    console.warn('  Warning: Could not collect python test count');
  }

  // Lint
  try {
    const result = execFileSync('bun', ['lint', '--format', 'json'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        let errors = 0;
        let warnings = 0;
        for (const file of parsed) {
          if (file.messages) {
            for (const msg of file.messages) {
              if (msg.severity === 2) errors++;
              else if (msg.severity === 1) warnings++;
            }
          }
        }
        stats.lint_errors = errors;
        stats.lint_warnings = warnings;
      }
    } catch {
      // Could not parse lint output
    }
  } catch {
    console.warn('  Warning: Could not collect lint stats');
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Database stats (spec section 3.4, --db flag)
// ---------------------------------------------------------------------------

export interface DbStats {
  tables: number | null;
  rls_policies: number | null;
  rpc_functions: number | null;
  domains_count: number | null;
  subtopics_count: number | null;
  content_items_count: number | null;
  entity_count: number | null;
}

export async function collectDbStats(): Promise<DbStats> {
  const stats: DbStats = {
    tables: null,
    rls_policies: null,
    rpc_functions: null,
    domains_count: null,
    subtopics_count: null,
    content_items_count: null,
    entity_count: null,
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('  Warning: Supabase env vars not set, skipping DB stats');
    return stats;
  }

  async function countTable(table: string): Promise<number | null> {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=count`, {
        method: 'HEAD',
        headers: {
          apikey: key!,
          Authorization: `Bearer ${key}`,
          Prefer: 'count=exact',
        },
      });
      const range = res.headers.get('content-range');
      if (range) {
        const match = range.match(/\/(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
      return null;
    } catch {
      return null;
    }
  }

  try {
    stats.content_items_count = await countTable('content_items');
    stats.domains_count = await countTable('taxonomy_domains');
    stats.subtopics_count = await countTable('taxonomy_subtopics');
  } catch (e) {
    console.warn(
      '  Warning: Could not collect some DB stats:',
      (e as Error).message,
    );
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Markdown generation
// ---------------------------------------------------------------------------

export function generateMarkdown(
  stats: Record<string, number>,
  codeStats: Record<string, number>,
  runtimeStats: RuntimeStats,
  dbStats: DbStats,
  generatedAt: string,
): string {
  const ukDate = formatUKDate(new Date(generatedAt));

  const fmt = (v: number | null): string =>
    v !== null ? v.toLocaleString('en-GB') : '\u2014';

  return `<!-- AUTO-GENERATED \u2014 do not edit manually -->
<!-- Run: bun run scripts/generate-codebase-stats.ts -->

# Codebase Statistics

Generated: ${ukDate}

## Frontend

| Stat | Count |
|------|-------|
| Page routes | ${fmt(stats.page_routes)} |
| Components (total) | ${fmt(stats.components_total)} |
| Components (custom) | ${fmt(stats.components_custom)} |
| Components (shadcn/ui) | ${fmt(stats.components_shadcn)} |
| Hooks | ${fmt(stats.hooks)} |
| Contexts | ${fmt(stats.contexts)} |

## Backend

| Stat | Count |
|------|-------|
| API route files | ${fmt(stats.api_route_files)} |
| API route groups | ${fmt(stats.api_route_groups)} |
| Cron routes | ${fmt(stats.cron_routes)} |
| Migrations | ${fmt(stats.migrations)} |

## Testing

| Stat | Count |
|------|-------|
| Vitest test files | ${fmt(stats.vitest_test_files)} |
| Vitest test count | ${fmt(runtimeStats.vitest_test_count)} |
| E2E spec files | ${fmt(stats.e2e_spec_files)} |
| Python test files | ${fmt(stats.python_test_files)} |
| Python test count | ${fmt(runtimeStats.python_test_count)} |
| Lint errors | ${fmt(runtimeStats.lint_errors)} |
| Lint warnings | ${fmt(runtimeStats.lint_warnings)} |

## MCP

| Stat | Count |
|------|-------|
| MCP tools | ${fmt(codeStats.mcp_tools)} |
| MCP resources | ${fmt(codeStats.mcp_resources)} |
| MCP prompts | ${fmt(codeStats.mcp_prompts)} |
| MCP tool category files | ${fmt(stats.mcp_tool_category_files)} |
| MCP apps | ${fmt(stats.mcp_apps)} |

## Library

| Stat | Count |
|------|-------|
| Lib modules (top-level) | ${fmt(stats.lib_modules_toplevel)} |
| Lib modules (total) | ${fmt(stats.lib_modules_total)} |
| AI modules | ${fmt(stats.ai_modules)} |
| AI skill files | ${fmt(stats.ai_skill_files)} |
| Validation files | ${fmt(stats.validation_files)} |
| Extraction files | ${fmt(stats.extraction_files)} |
| Type files | ${fmt(stats.type_files)} |
| Content types | ${fmt(codeStats.content_types)} |

## Pipeline

| Stat | Count |
|------|-------|
| Pipeline modules | ${fmt(stats.pipeline_modules)} |

## Quality & Checks

| Stat | Count |
|------|-------|
| Quality checks | ${fmt(stats.quality_checks)} |

## Database

| Stat | Count |
|------|-------|
| Tables | ${fmt(dbStats.tables)} |
| RLS policies | ${fmt(dbStats.rls_policies)} |
| RPC functions | ${fmt(dbStats.rpc_functions)} |
| Domains | ${fmt(dbStats.domains_count)} |
| Subtopics | ${fmt(dbStats.subtopics_count)} |
| Content items | ${fmt(dbStats.content_items_count)} |
| Entities | ${fmt(dbStats.entity_count)} |
`;
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(
  stats: Record<string, number>,
  codeStats: Record<string, number>,
  runtimeStats: RuntimeStats,
  dbStats: DbStats,
): void {
  console.log('\n  Codebase Statistics Summary');
  console.log('  ===========================\n');

  const rows: [string, number | null][] = [
    ['Vitest test files', stats.vitest_test_files],
    ['E2E spec files', stats.e2e_spec_files],
    ['Python test files', stats.python_test_files],
    ['Migrations', stats.migrations],
    ['API route files', stats.api_route_files],
    ['API route groups', stats.api_route_groups],
    ['Page routes', stats.page_routes],
    ['Components (total)', stats.components_total],
    ['Components (custom)', stats.components_custom],
    ['Components (shadcn/ui)', stats.components_shadcn],
    ['Hooks', stats.hooks],
    ['Contexts', stats.contexts],
    ['Lib modules (top-level)', stats.lib_modules_toplevel],
    ['Lib modules (total)', stats.lib_modules_total],
    ['Type files', stats.type_files],
    ['MCP tools', codeStats.mcp_tools],
    ['MCP resources', codeStats.mcp_resources],
    ['MCP prompts', codeStats.mcp_prompts],
    ['MCP tool category files', stats.mcp_tool_category_files],
    ['MCP apps', stats.mcp_apps],
    ['AI modules', stats.ai_modules],
    ['AI skill files', stats.ai_skill_files],
    ['Validation files', stats.validation_files],
    ['Extraction files', stats.extraction_files],
    ['Pipeline modules', stats.pipeline_modules],
    ['Quality checks', stats.quality_checks],
    ['Cron routes', stats.cron_routes],
    ['Content types', codeStats.content_types],
  ];

  if (runtimeStats.vitest_test_count !== null) {
    rows.push(['Vitest test count', runtimeStats.vitest_test_count]);
  }
  if (runtimeStats.python_test_count !== null) {
    rows.push(['Python test count', runtimeStats.python_test_count]);
  }
  if (runtimeStats.lint_errors !== null) {
    rows.push(['Lint errors', runtimeStats.lint_errors]);
  }
  if (runtimeStats.lint_warnings !== null) {
    rows.push(['Lint warnings', runtimeStats.lint_warnings]);
  }

  const dbEntries: [string, number | null][] = [
    ['Tables', dbStats.tables],
    ['RLS policies', dbStats.rls_policies],
    ['RPC functions', dbStats.rpc_functions],
    ['Domains', dbStats.domains_count],
    ['Subtopics', dbStats.subtopics_count],
    ['Content items', dbStats.content_items_count],
    ['Entities', dbStats.entity_count],
  ];

  for (const [label, value] of dbEntries) {
    if (value !== null) rows.push([label, value]);
  }

  const maxLabel = Math.max(...rows.map(([l]) => l.length));
  for (const [label, value] of rows) {
    const valStr = value !== null ? value.toLocaleString('en-GB') : '\u2014';
    console.log(`  ${label.padEnd(maxLabel + 2)}${valStr}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Check mode
// ---------------------------------------------------------------------------

export function checkStats(newOutput: object): boolean {
  if (!fs.existsSync(JSON_OUTPUT)) {
    console.error('No existing stats file found at', JSON_OUTPUT);
    return false;
  }

  const existing = JSON.parse(fs.readFileSync(JSON_OUTPUT, 'utf-8'));

  const keysToCompare = ['stats', 'code_stats', 'runtime_stats', 'db_stats'];
  const newObj = newOutput as Record<string, unknown>;

  for (const key of keysToCompare) {
    if (JSON.stringify(existing[key]) !== JSON.stringify(newObj[key])) {
      console.error(`Stats differ in "${key}" section.`);
      console.error(
        '  Existing:',
        JSON.stringify(existing[key], null, 2).slice(0, 200),
      );
      console.error(
        '  Current:',
        JSON.stringify(newObj[key], null, 2).slice(0, 200),
      );
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = new Set(argv.slice(2));
  const fullMode = args.has('--full');
  const dbMode = args.has('--db');
  const jsonOnly = args.has('--json-only');
  const stdoutMode = args.has('--stdout');
  const checkMode = args.has('--check');

  console.log('Collecting file statistics...');
  const fileStats = collectFileStats();

  console.log('Collecting code-parsable statistics...');
  const codeStats = collectCodeStats();

  let runtimeStats: RuntimeStats = {
    vitest_test_count: null,
    python_test_count: null,
    lint_errors: null,
    lint_warnings: null,
  };

  if (fullMode) {
    console.log('Collecting runtime statistics (this may take a while)...');
    runtimeStats = collectRuntimeStats();
  }

  let dbStats: DbStats = {
    tables: null,
    rls_policies: null,
    rpc_functions: null,
    domains_count: null,
    subtopics_count: null,
    content_items_count: null,
    entity_count: null,
  };

  if (dbMode) {
    console.log('Collecting database statistics...');
    dbStats = await collectDbStats();
  }

  const generatedAt = new Date().toISOString();

  const output = {
    generated_at: generatedAt,
    generator: 'scripts/generate-codebase-stats.ts',
    stats: fileStats,
    code_stats: codeStats,
    runtime_stats: runtimeStats,
    db_stats: dbStats,
  };

  // Check mode: compare and exit
  if (checkMode) {
    const matches = checkStats(output);
    if (matches) {
      console.log('Stats are up to date.');
      process.exit(0);
    } else {
      console.error(
        'Stats have changed. Run `bun run scripts/generate-codebase-stats.ts` to update.',
      );
      process.exit(1);
    }
  }

  // stdout mode: print JSON and exit
  if (stdoutMode) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Write files
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const jsonContent = JSON.stringify(output, null, 2) + '\n';
  fs.writeFileSync(JSON_OUTPUT, jsonContent, 'utf-8');
  console.log(`Written: ${path.relative(ROOT, JSON_OUTPUT)}`);

  if (!jsonOnly) {
    const mdContent = generateMarkdown(
      fileStats,
      codeStats,
      runtimeStats,
      dbStats,
      generatedAt,
    );
    fs.writeFileSync(MD_OUTPUT, mdContent, 'utf-8');
    console.log(`Written: ${path.relative(ROOT, MD_OUTPUT)}`);
  }

  // Print summary
  printSummary(fileStats, codeStats, runtimeStats, dbStats);
}

// Run when executed directly
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('generate-codebase-stats.ts');

if (isMainModule) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
