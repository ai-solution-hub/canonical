/**
 * ID-9.12 — workflow shape guard for `.github/workflows/docubot.yml`.
 *
 * Spec: TECH §3.2; PRODUCT Inv-25 (trigger surface: workflow_dispatch +
 * pull_request closed, filtered to merged==true; NO issue_comment /
 * pull_request_review_comment), Inv-28 (timeout 30), Inv-33 (ubuntu-latest).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const wfPath = join(process.cwd(), '.github/workflows/docubot.yml');
const raw = readFileSync(wfPath, 'utf8');
const doc = parse(raw) as Record<string, unknown>;
// YAML 1.2 keeps `on` as a string key; some parsers fold it to boolean true.
const on = (doc.on ?? (doc as Record<string, unknown>)['true']) as Record<
  string,
  unknown
>;
const jobs = doc.jobs as Record<
  string,
  {
    if?: string;
    'runs-on'?: string;
    'timeout-minutes'?: number;
    permissions?: Record<string, string>;
    steps?: Array<{ uses?: string; name?: string }>;
  }
>;
const job = jobs.docubot;

describe('docubot.yml workflow shape (ID-9.12 / TECH §3.2)', () => {
  it('triggers on workflow_dispatch and pull_request closed (only)', () => {
    expect(on).toHaveProperty('workflow_dispatch');
    expect(on).toHaveProperty('pull_request');
    const pr = on.pull_request as { types?: string[]; branches?: string[] };
    expect(pr.types).toEqual(['closed']);
  });

  it('does NOT use issue_comment or pull_request_review_comment triggers (Inv-25)', () => {
    expect(on).not.toHaveProperty('issue_comment');
    expect(on).not.toHaveProperty('pull_request_review_comment');
  });

  it('filters the job to merged==true (closed-without-merge must not run)', () => {
    expect(job.if).toContain('github.event.pull_request.merged == true');
    expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
  });

  it('runs on ubuntu-latest with a 30-minute timeout (Inv-28 / Inv-33)', () => {
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBe(30);
  });

  it('grants the contents/pull-requests/issues write permissions', () => {
    expect(job.permissions?.contents).toBe('write');
    expect(job.permissions?.['pull-requests']).toBe('write');
    expect(job.permissions?.issues).toBe('write');
  });

  it('invokes the docubot composite action', () => {
    const uses = (job.steps ?? []).map((s) => s.uses ?? '');
    expect(uses).toContain('./.github/actions/docubot');
  });
});
