/**
 * ID-9.17 — check_links.py behaviour, exercised against fixtures.
 *
 * Non-vacuous: builds a fixture content tree containing one link of each
 * deterministic error type (file-not-found, case-mismatch, missing-mdx-ext,
 * cross-space-relative) plus valid links that must NOT be flagged, runs the
 * real Python walker, and asserts the classification. The external-error type
 * (HTTP 4xx/timeout) needs network and is covered by the taxonomy assertion +
 * the --check-external flag's presence rather than a live probe.
 *
 * Spec: TECH §4.6; PRODUCT Inv-41.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  process.cwd(),
  '.claude/skills/check-for-broken-links/scripts/check_links.py',
);

interface Finding {
  path: string;
  line: number;
  href: string;
  error_type: string;
}

let root: string;
let result: { error_types: string[]; findings: Finding[] };

function byType(t: string): Finding[] {
  return result.findings.filter((f) => f.error_type === t);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kh-links-'));
  const ref = join(root, 'reference');
  const runbooks = join(root, 'runbooks');
  mkdirSync(ref, { recursive: true });
  mkdirSync(runbooks, { recursive: true });
  mkdirSync(join(ref, 'guide'), { recursive: true });

  // Real targets.
  writeFileSync(join(ref, 'other.md'), '# Other\n');
  writeFileSync(join(ref, 'guide', 'index.md'), '# Guide\n');
  writeFileSync(join(runbooks, 'local.md'), '# Local\n');

  // good.md — all links resolve; must produce zero findings for this file.
  writeFileSync(
    join(ref, 'good.md'),
    [
      '# Good',
      '[other](./other.md)',
      '[guide](./guide/)', // directory link with index.md → ok
      '[absolute runbook](/runbooks/local/)', // cross-space, but ABSOLUTE → ok
    ].join('\n') + '\n',
  );

  // file-not-found.
  writeFileSync(join(ref, 'fnf.md'), '# FNF\n[missing](./missing.md)\n');
  // case-mismatch — target stored as other.md.
  writeFileSync(join(ref, 'case.md'), '# Case\n[wrong case](./Other.md)\n');
  // missing-mdx-ext — directory link with no .md/index.md target.
  writeFileSync(join(ref, 'dir.md'), '# Dir\n[nodir](./nodir/)\n');
  // cross-space-relative — relative link climbing into another space.
  writeFileSync(
    join(ref, 'cross.md'),
    '# Cross\n[runbook](../runbooks/local.md)\n',
  );

  // Exit code is 1 when findings exist; capture stdout regardless.
  let out = '';
  try {
    out = execFileSync('python3', [SCRIPT, '--root', root], {
      encoding: 'utf8',
    });
  } catch (err) {
    out = (err as { stdout?: string }).stdout ?? '';
  }
  result = JSON.parse(out);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check_links.py (ID-9.17 / Inv-41)', () => {
  it('declares all five error types in its taxonomy', () => {
    expect(result.error_types).toEqual([
      'file-not-found',
      'case-mismatch',
      'missing-mdx-ext',
      'cross-space-relative',
      'external-error',
    ]);
  });

  it('detects file-not-found', () => {
    expect(byType('file-not-found').map((f) => f.path)).toContain(
      'reference/fnf.md',
    );
  });

  it('detects case-mismatch even on a case-insensitive host filesystem', () => {
    expect(byType('case-mismatch').map((f) => f.path)).toContain(
      'reference/case.md',
    );
  });

  it('detects missing-mdx-ext directory links', () => {
    expect(byType('missing-mdx-ext').map((f) => f.path)).toContain(
      'reference/dir.md',
    );
  });

  it('detects cross-space-relative links (Inv-6)', () => {
    expect(byType('cross-space-relative').map((f) => f.path)).toContain(
      'reference/cross.md',
    );
  });

  it('does NOT flag valid links (resolving relative, dir-with-index, absolute cross-space)', () => {
    expect(
      result.findings.filter((f) => f.path === 'reference/good.md'),
    ).toEqual([]);
  });
});
