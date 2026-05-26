/**
 * ID-9.13/9.14-9.18 — five-skill inventory guard (Inv-36).
 *
 * The five ported skills each have a SKILL.md; update-changelog is NOT ported
 * (OQ-3 override). Spec: TECH §4.2; PRODUCT Inv-36.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS = [
  'review-docs-pr',
  'sync-source-docs',
  'missing-docs',
  'check-for-broken-links',
  'docs-seo-audit',
];

describe('five-skill inventory (Inv-36 / OQ-3)', () => {
  it.each(SKILLS)('skill %s has a SKILL.md', (skill) => {
    expect(
      existsSync(join(process.cwd(), '.claude/skills', skill, 'SKILL.md')),
    ).toBe(true);
  });

  it('does NOT port update-changelog (OQ-3 override)', () => {
    expect(
      existsSync(join(process.cwd(), '.claude/skills/update-changelog')),
    ).toBe(false);
    expect(
      existsSync(join(process.cwd(), '.github/workflows/update-changelog.yml')),
    ).toBe(false);
  });
});
