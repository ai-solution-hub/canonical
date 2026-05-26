/**
 * ID-9.18 — audit_seo.py behaviour + ASK-before-fixing guardrail.
 *
 * Non-vacuous: runs the real Python auditor over a fixture tree with
 * deliberate SEO issues across all three tiers and asserts each is detected,
 * and that a clean page produces none. Also asserts the SKILL.md preserves the
 * ASK-before-fixing rule. Spec: TECH §4.7; PRODUCT Inv-42.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  process.cwd(),
  '.claude/skills/docs-seo-audit/scripts/audit_seo.py',
);
const SKILL = readFileSync(
  join(process.cwd(), '.claude/skills/docs-seo-audit/SKILL.md'),
  'utf8',
);

interface Finding {
  path: string;
  issue: string;
  tier: string;
}
let root: string;
let result: { issue_types: Record<string, string>; findings: Finding[] };

const issuesFor = (p: string) =>
  result.findings.filter((f) => f.path === p).map((f) => f.issue);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kh-seo-'));

  // clean.md — good title + description + substantive body. No findings.
  writeFileSync(
    join(root, 'clean.md'),
    `---\ntitle: A Perfectly Reasonable Page Title\ndescription: ${'word '.repeat(15)}\n---\n\n${'content '.repeat(60)}\n`,
  );

  // bad.md — missing description, title too long, image w/o alt,
  // non-descriptive link text.
  writeFileSync(
    join(root, 'bad.md'),
    [
      '---',
      `title: ${'X'.repeat(80)}`,
      '---',
      '',
      '![](/img/diagram.png)',
      '[click here](/reference/other/)',
      'word '.repeat(60),
    ].join('\n') + '\n',
  );

  // dup-a.md + dup-b.md — duplicate title (error tier).
  const dupFm =
    '---\ntitle: Shared Duplicate Title\ndescription: this description is long enough to pass the minimum length check\n---\n';
  writeFileSync(join(root, 'dup-a.md'), dupFm + '\n' + 'word '.repeat(60));
  writeFileSync(join(root, 'dup-b.md'), dupFm + '\n' + 'word '.repeat(60));

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

describe('audit_seo.py (ID-9.18 / Inv-42)', () => {
  it('catalogues at least 11 issue types across three tiers', () => {
    const types = Object.keys(result.issue_types);
    expect(types.length).toBeGreaterThanOrEqual(11);
    const tiers = new Set(Object.values(result.issue_types));
    expect(tiers).toEqual(new Set(['error', 'warning', 'info']));
  });

  it('produces no findings for a clean page', () => {
    expect(issuesFor('clean.md')).toEqual([]);
  });

  it('detects missing-description, title-too-long, image-missing-alt, non-descriptive link', () => {
    const issues = issuesFor('bad.md');
    expect(issues).toContain('missing-description');
    expect(issues).toContain('title-too-long');
    expect(issues).toContain('image-missing-alt');
    expect(issues).toContain('non-descriptive-link-text');
  });

  it('detects duplicate-title across pages (error tier)', () => {
    expect(issuesFor('dup-a.md')).toContain('duplicate-title');
    expect(issuesFor('dup-b.md')).toContain('duplicate-title');
  });
});

describe('docs-seo-audit SKILL.md guardrail (Inv-42)', () => {
  it('preserves the ASK-before-fixing rule', () => {
    expect(SKILL).toMatch(/ASK before fixing/i);
    expect(SKILL).toMatch(/does NOT auto-rewrite|never .*auto-rewrite/i);
  });
});
