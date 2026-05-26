/**
 * ID-9.13 — canonical workflow-shape guard for the five ported skills (Inv-43).
 *
 * ONE template, five workflows: each `.github/workflows/<skill>.yml` shares the
 * same shape (workflow_dispatch inputs, ubuntu-latest + timeout 30,
 * contents/pull-requests/issues write, the shared run-skill.ts invocation, and
 * the if:always() upload-artifact contract). Spec: TECH §4.1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const SKILLS = [
  'review-docs-pr',
  'sync-source-docs',
  'missing-docs',
  'check-for-broken-links',
  'docs-seo-audit',
] as const;

type Workflow = {
  jobs: Record<
    string,
    {
      'runs-on'?: string;
      'timeout-minutes'?: number;
      permissions?: Record<string, string>;
      steps?: Array<{ name?: string; uses?: string; run?: string }>;
    }
  >;
} & Record<string, unknown>;

function load(skill: string): { wf: Workflow; on: Record<string, unknown> } {
  const raw = readFileSync(
    join(process.cwd(), `.github/workflows/${skill}.yml`),
    'utf8',
  );
  const wf = parse(raw) as Workflow;
  const on = (wf.on ?? (wf as Record<string, unknown>)['true']) as Record<
    string,
    unknown
  >;
  return { wf, on };
}

describe.each(SKILLS)('canonical workflow shape — %s (Inv-43)', (skill) => {
  const { wf, on } = load(skill);
  const job = wf.jobs[skill];

  it('exposes workflow_dispatch with target_pr_number + prompt_override inputs', () => {
    const wd = on.workflow_dispatch as { inputs?: Record<string, unknown> };
    expect(wd).toBeDefined();
    expect(wd.inputs).toHaveProperty('target_pr_number');
    expect(wd.inputs).toHaveProperty('prompt_override');
  });

  it('defines the job on ubuntu-latest with a 30-minute timeout', () => {
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBe(30);
  });

  it('grants contents/pull-requests/issues write', () => {
    expect(job.permissions?.contents).toBe('write');
    expect(job.permissions?.['pull-requests']).toBe('write');
    expect(job.permissions?.issues).toBe('write');
  });

  it('invokes the shared run-skill.ts driver with the matching --skill', () => {
    const runScript = (job.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(runScript).toContain('scripts/skills/run-skill.ts');
    expect(runScript).toContain(`--skill ${skill}`);
    expect(runScript).toContain(`--skill-md .claude/skills/${skill}/SKILL.md`);
  });

  it('uploads run artefacts with if:always()', () => {
    const upload = (job.steps ?? []).find((s) =>
      (s.uses ?? '').startsWith('actions/upload-artifact'),
    );
    expect(upload).toBeDefined();
  });
});
