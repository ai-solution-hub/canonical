/**
 * ID-9.15 — sync-source-docs skill body + workflow contract guard.
 *
 * Spec: TECH §4.4; PRODUCT Inv-20 + Inv-39 (three KH source pairs, weekly cron,
 * kh_docubot_owned marker on the refreshed pages).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const skill = readFileSync(
  join(process.cwd(), '.claude/skills/sync-source-docs/SKILL.md'),
  'utf8',
);
const wfRaw = readFileSync(
  join(process.cwd(), '.github/workflows/sync-source-docs.yml'),
  'utf8',
);
const wf = parse(wfRaw) as Record<string, unknown>;
const on = (wf.on ?? (wf as Record<string, unknown>)['true']) as {
  schedule?: Array<{ cron: string }>;
  workflow_dispatch?: unknown;
};

describe('sync-source-docs SKILL.md (ID-9.15 / Inv-39)', () => {
  it('documents the three KH source pairs', () => {
    expect(skill).toContain('supabase/types/database.types.ts');
    expect(skill).toContain('schema-quick-reference.md');
    expect(skill).toContain('lib/mcp/');
    expect(skill).toContain('mcp-inventory.md');
    expect(skill).toContain('app/api/**/route.ts');
    expect(skill).toContain('api-routes.md');
  });

  it('marks refreshed pages kh_docubot_owned so sync does not clobber them', () => {
    expect(skill).toContain('kh_docubot_owned: true');
  });

  it('opens a single drift PR (not an empty PR when there is no drift)', () => {
    expect(skill).toMatch(/docs\(reference\): sync .* drift/);
    expect(skill).toMatch(/do not open an\s*\n?\s*empty PR/i);
  });
});

describe('sync-source-docs.yml (ID-9.15 / OQ-T2)', () => {
  it('enables the weekly Monday 06:00 UTC cron and workflow_dispatch', () => {
    expect(on.workflow_dispatch).toBeDefined();
    expect(on.schedule?.some((s) => s.cron === '0 6 * * 1')).toBe(true);
  });
});
