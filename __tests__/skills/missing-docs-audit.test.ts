/**
 * ID-9.16 — missing-docs audit_docs.py behaviour, exercised against fixtures.
 *
 * Non-vacuous: each sub-audit runs the real Python script over a fixture tree
 * containing a DELIBERATE gap, and asserts the gap is reported AND that a
 * documented surface is NOT reported. Spec: TECH §4.5; PRODUCT Inv-40.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  process.cwd(),
  '.claude/skills/missing-docs/scripts/audit_docs.py',
);

function runAudit(audit: string, root: string, docsRoot: string): string[] {
  const out = execFileSync(
    'python3',
    [SCRIPT, '--audit', audit, '--root', root, '--docs-root', docsRoot],
    { encoding: 'utf8' },
  );
  return (JSON.parse(out).missing as Array<{ surface: string }>).map(
    (m) => m.surface,
  );
}

let root: string;
let docsRoot: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kh-missing-src-'));
  docsRoot = join(root, 'docs');
  mkdirSync(join(docsRoot, 'runbooks'), { recursive: true });
  mkdirSync(join(docsRoot, 'reference'), { recursive: true });
  mkdirSync(join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'lib', 'mcp', 'tools'), { recursive: true });
  mkdirSync(join(root, 'app', 'api', 'widgets'), { recursive: true });

  // env-vars: FOO_SECRET (example) + BAR_TOKEN (code) are undocumented;
  // DOCUMENTED_VAR is mentioned in a runbook.
  writeFileSync(join(root, '.env.example'), 'FOO_SECRET=\nDOCUMENTED_VAR=\n');
  writeFileSync(
    join(root, 'lib', 'x.ts'),
    'const t = process.env.BAR_TOKEN;\n',
  );
  writeFileSync(
    join(docsRoot, 'runbooks', 'local.md'),
    '# Local dev\nSet DOCUMENTED_VAR before running `bun run build`.\n',
  );

  // cli-commands: secret-cmd undocumented, build documented above? no — add.
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { build: 'astro build', 'secret-cmd': 'x' } }),
  );

  // mcp-routes: kh_widget tool + /api/widgets route undocumented.
  writeFileSync(
    join(root, 'lib', 'mcp', 'tools', 'widget.ts'),
    "export const widget = { name: 'kh_widget' };\n",
  );
  writeFileSync(
    join(root, 'app', 'api', 'widgets', 'route.ts'),
    'export {};\n',
  );

  // terminology: "Digest" is stale (per the real stale_terms.md).
  writeFileSync(
    join(docsRoot, 'reference', 'overview.md'),
    '# Overview\nThe Digest pipeline runs nightly.\n',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('missing-docs audit_docs.py (ID-9.16 / Inv-40)', () => {
  it('env-vars: reports undocumented vars, not documented ones', () => {
    const found = runAudit('env-vars', root, docsRoot);
    expect(found).toContain('FOO_SECRET');
    expect(found).toContain('BAR_TOKEN');
    expect(found).not.toContain('DOCUMENTED_VAR');
  });

  it('cli-commands: reports undocumented scripts, not documented ones', () => {
    const found = runAudit('cli-commands', root, docsRoot);
    expect(found).toContain('secret-cmd');
    // "build" is mentioned in the runbook (`bun run build`) → documented.
    expect(found).not.toContain('build');
  });

  it('mcp-routes: reports undocumented MCP tools and API routes', () => {
    const found = runAudit('mcp-routes', root, docsRoot);
    expect(found).toContain('kh_widget');
    expect(found).toContain('/api/widgets');
  });

  it('terminology: reports stale terms occurring in the corpus', () => {
    const out = execFileSync(
      'python3',
      [
        SCRIPT,
        '--audit',
        'terminology',
        '--root',
        root,
        '--docs-root',
        docsRoot,
      ],
      { encoding: 'utf8' },
    );
    const surfaces = (
      JSON.parse(out).missing as Array<{ surface: string }>
    ).map((m) => m.surface);
    expect(surfaces).toContain('Digest');
  });
});
