#!/usr/bin/env bun
/**
 * `wrap-define-route` — OPS-T1 codemod scaffold.
 *
 * Spec:
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md
 *   - docs/specs/ast-dataflow-tool/ops-t1-codemod/TECH.md
 *
 * Scope (Subtask 32.5): SCAFFOLD ONLY. This file implements:
 *   - CLI argv parsing via `node:util` `parseArgs` (TECH §5 / §9).
 *   - `--help` output and exit 0.
 *   - ts-morph `Project` initialisation from the working tree's
 *     `tsconfig.json` (TECH §2.1).
 *   - Route enumeration via `app/api/.*\/route.ts$` regex over
 *     `project.getSourceFiles()` (TECH §2.2) with optional `--scope` filter.
 *   - Exit code 0 on success / 1 on fatal init failure (TECH §5).
 *
 * Downstream Subtasks add:
 *   - 32.6 shape classifier
 *   - 32.8 ResponseSchema inference (Source A)
 *   - 32.10 / 32.11 handler rewrite (single / multi-method)
 *   - 32.12 dry-run + needs-manual artefact emitters
 *   - 32.13 idempotency check
 *   - 32.14 apply mode + format pass
 *
 * This scaffold MUST NOT rewrite any file. It is purely a discovery walk.
 *
 * Usage:
 *   bun scripts/codemods/wrap-define-route.ts [--apply] [--scope <path>]
 *   bun scripts/codemods/wrap-define-route.ts --help
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { Project, type SourceFile } from 'ts-morph';

// ── Constants ──────────────────────────────────────────────────────────────

const ROUTE_FILE_PATTERN = /app\/api\/.*\/route\.ts$/;

const EXIT_OK = 0;
const EXIT_FATAL = 1;

const USAGE = `wrap-define-route — OPS-T1 codemod for Knowledge Hub

Usage:
  bun scripts/codemods/wrap-define-route.ts [options]

Options:
  --apply          Write changes to disk (default: dry-run only)
  --scope <path>   Restrict to routes whose path contains this fragment
                   (e.g. 'app/api/intelligence')
  --help           Show this message

Output files (always written by full implementation, NOT by this scaffold):
  docs/generated/codemod-dry-run.md         Human-readable diff preview
  docs/generated/codemod-needs-manual.json  Structured MANUAL/NEEDS-REVIEW report

Status: SCAFFOLD ONLY (Subtask 32.5). This invocation enumerates routes but
performs no rewrite. Downstream Subtasks add the classifier, inference,
rewrite, idempotency check, and apply-mode logic.
`;

// ── CLI argv parsing ──────────────────────────────────────────────────────

interface ParsedCliArgs {
  apply: boolean;
  help: boolean;
  scope: string | undefined;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      scope: { type: 'string' },
    },
    allowPositionals: false,
  });
  return {
    apply: values.apply === true,
    help: values.help === true,
    scope: values.scope,
  };
}

// ── ts-morph Project init ─────────────────────────────────────────────────

/**
 * Initialise a ts-morph `Project` from the working tree's `tsconfig.json`.
 * `skipAddingFilesFromTsConfig: false` (the default) is preserved per TECH
 * §2.1 so `app/**\/*.ts` (which includes `app/api/**\/route.ts`) loads
 * automatically.
 *
 * Throws if the tsconfig cannot be located or parsed — the CLI converts the
 * exception into exit code 1.
 */
export function createCodemodProject(tsConfigFilePath = 'tsconfig.json'): Project {
  return new Project({
    tsConfigFilePath: resolve(process.cwd(), tsConfigFilePath),
    skipAddingFilesFromTsConfig: false,
  });
}

// ── Route enumeration ─────────────────────────────────────────────────────

/**
 * Enumerate the API route files in the project, optionally filtered by a
 * path-fragment scope.
 *
 * Per TECH §2.2 the regex `app/api/.*\/route\.ts$` is the canonical route
 * matcher (excludes pages, page-route segments, and non-route helpers
 * inside `app/api/`). Match against the file's POSIX path so the same
 * filter works on macOS / Linux CI / Windows-style paths uniformly.
 */
export function enumerateRouteFiles(
  project: Project,
  scope?: string,
): SourceFile[] {
  const all = project.getSourceFiles().filter((sf) => {
    const posixPath = sf.getFilePath().replace(/\\/g, '/');
    return ROUTE_FILE_PATTERN.test(posixPath);
  });
  if (!scope) return all;
  const scopeNormalised = scope.replace(/\\/g, '/');
  return all.filter((sf) => {
    const posixPath = sf.getFilePath().replace(/\\/g, '/');
    return posixPath.includes(scopeNormalised);
  });
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Run the codemod scaffold against the working tree.
 *
 * Returns the discovered route count (0+) on success; throws on fatal init
 * failure (ts-morph cannot load tsconfig, etc.). The CLI wrapper converts
 * thrown errors into exit code 1.
 */
export async function runScaffold(
  args: ParsedCliArgs,
): Promise<{ routeCount: number; apply: boolean }> {
  if (args.apply) {
    // Apply mode is not implemented in the scaffold — emit a notice and
    // continue with dry-run enumeration so the scaffold's exit-code-0
    // contract is preserved. Downstream Subtask 32.14 wires real apply
    // behaviour.
    console.log(
      '[scaffold] --apply not yet implemented (Subtask 32.14); running discovery only.',
    );
  }

  const project = createCodemodProject();
  const routeFiles = enumerateRouteFiles(project, args.scope);

  // Discovery-only output. The full dry-run report (PRODUCT §5 / TECH §6.1)
  // is emitted by Subtask 32.12. For Subtask 32.5 we only need the count
  // to confirm enumeration works against the live corpus.
  console.log(
    `${routeFiles.length} route(s) discovered${args.scope ? ` (scoped to ${args.scope})` : ''}.`,
  );

  return { routeCount: routeFiles.length, apply: args.apply };
}

// ── CLI bootstrap ──────────────────────────────────────────────────────────

/**
 * Detect whether this module is being executed directly (vs imported by a
 * test). When imported, `process.argv[1]` will be the test runner's path,
 * not this file's path.
 */
function isDirectInvocation(): boolean {
  const argv1 = process.argv[1] ?? '';
  return argv1.endsWith('wrap-define-route.ts');
}

if (isDirectInvocation()) {
  (async () => {
    try {
      const args = parseCliArgs(process.argv.slice(2));
      if (args.help) {
        console.log(USAGE);
        process.exit(EXIT_OK);
      }
      await runScaffold(args);
      process.exit(EXIT_OK);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[wrap-define-route] fatal: ${message}`);
      process.exit(EXIT_FATAL);
    }
  })();
}
