/**
 * Spec: docs/audits/kh-production-readiness-phase-1/specs/wp-ci-res2-staging-live-mirror-spec.md
 *
 * AC-20 grep test + workflow-injection unit checks (spec §2.6 / §2.8 / AC-19 / §2.5).
 *
 * - AC-20: orchestrator + workflow files contain ZERO non-comment references
 *   to MCP supabase tooling. The orchestrator is CLI-only (pg_dump | psql
 *   shell-outs); MCP imports would break the cron-runner shape per spec §4.2.
 * - Workflow-injection mitigation: every `${{ github.* }}` reference appears
 *   inside an `env:` block, never inline in `run:`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const REPO_ROOT = process.cwd();
const WORKFLOW_PATH = path.join(
  REPO_ROOT,
  '.github/workflows/staging-live-mirror.yml',
);

// AC-20 file set per spec §3 AC-20. Sibling agents WP2a/b/c own the three
// scripts/* files; this test gracefully falls back to the present subset
// so the AC remains enforceable from any single agent's branch.
const AC20_FILES = [
  'scripts/staging-mirror-and-scrub.ts',
  'scripts/scrub-staging-pii.sql',
  'scripts/verify-scrub.ts',
  '.github/workflows/staging-live-mirror.yml',
];

describe('Staging live-mirror — AC-20 CLI-only orchestrator', () => {
  it('zero non-comment MCP references across orchestrator + workflow files', () => {
    const presentFiles = AC20_FILES.filter((f) =>
      existsSync(path.join(REPO_ROOT, f)),
    );
    expect(
      presentFiles.length,
      `AC-20 expects at least one of [${AC20_FILES.join(', ')}] to exist.`,
    ).toBeGreaterThan(0);

    // Per spec §3 AC-20:
    //   grep -inE "(mcp__supabase|from ['\"]@modelcontextprotocol|require\(['\"]@modelcontextprotocol)" <files>
    //     | grep -vE "^[0-9]+:(\s*)(--|//|\#)"
    //   returns zero hits. grep exits 1 on no-match, which execFileSync throws
    //   on; we treat exit 1 as the success path.
    let raw = '';
    try {
      raw = execFileSync(
        'grep',
        [
          '-inE',
          '(mcp__supabase|from [\'"]@modelcontextprotocol|require\\([\'"]@modelcontextprotocol)',
          ...presentFiles,
        ],
        { cwd: REPO_ROOT, encoding: 'utf-8' },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string };
      if (e.status === 1) raw = e.stdout ?? '';
      else throw err;
    }

    // Strip comment lines. grep multi-file output: `<file>:<lineno>:<src>`.
    // grep single-file output: `<lineno>:<src>`. Find the source segment
    // and check its leading non-whitespace chars.
    const offending = raw
      .split('\n')
      .filter((l) => l.length > 0)
      .filter((line) => {
        const parts = line.split(':');
        // Source segment is everything from index 2 onward in multi-file mode,
        // or index 1 onward in single-file mode. Heuristic: if parts[0] is a
        // path (contains '.' or '/'), source starts at index 2; else index 1.
        const isMultiFile = /[./]/.test(parts[0] ?? '');
        const sourceLine = parts.slice(isMultiFile ? 2 : 1).join(':');
        const trimmed = sourceLine.trimStart();
        return !(
          trimmed.startsWith('--') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('#')
        );
      });

    expect(
      offending,
      `AC-20 violation — non-comment MCP reference(s):\n${offending.join('\n')}`,
    ).toEqual([]);
  });
});

describe('Staging live-mirror — workflow-injection mitigation', () => {
  it('workflow file exists at canonical path', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it('no `${{ github.* }}` reference appears inside a `run:` block (spec §2.6)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    const lines = yaml.split('\n');
    let inRunBlock = false;
    let runIndent = -1;
    const violations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const indent = line.length - line.trimStart().length;
      const trimmed = line.trim();

      if (
        inRunBlock &&
        trimmed.length > 0 &&
        indent <= runIndent &&
        !trimmed.startsWith('|') &&
        !trimmed.startsWith('-')
      ) {
        inRunBlock = false;
        runIndent = -1;
      }

      const runMatch = trimmed.match(/^run:\s*(\||>|.*)$/);
      if (runMatch) {
        const tail = runMatch[1] ?? '';
        if (tail !== '|' && tail !== '>' && tail.length > 0) {
          if (/\$\{\{\s*github\./.test(tail))
            violations.push(`L${i + 1}: ${line}`);
        } else {
          inRunBlock = true;
          runIndent = indent;
        }
        continue;
      }

      if (inRunBlock && /\$\{\{\s*github\./.test(line)) {
        violations.push(`L${i + 1}: ${line}`);
      }
    }

    expect(
      violations,
      `\`\${{ github.* }}\` must arrive via env:, never inline in run:.\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('contains concurrency.cancel-in-progress: false (spec §2.8)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(yaml).toMatch(/concurrency:\s*\n\s+group:\s+staging-live-mirror/);
    expect(yaml).toMatch(/cancel-in-progress:\s+false/);
  });

  it('environment: Staging is present, case-sensitive (spec §2.5)', () => {
    const yaml = readFileSync(WORKFLOW_PATH, 'utf-8');
    // Per docs/runbooks/github-environments.md §4.1 the slot name is case-
    // sensitive — `staging` (lowercase) would silently fail to resolve secrets.
    expect(yaml).toMatch(/^\s+environment:\s+Staging\s*$/m);
  });
});
