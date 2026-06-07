/**
 * ID-68.26 — workflow shape guard for `.github/workflows/docs-dispatch.yml`.
 *
 * The docs operators (docubot + the five docs skills) live in the PRIVATE
 * knowledge-hub-docs-site repo (TECH PC-27 / PRODUCT Inv 27). This thin
 * public-side bridge is the ONLY remnant: on every merged PR to `main` it
 * mints a GitHub App installation token and fires a `repository_dispatch`
 * (`kh-public-pr-merged`) into the private repo, where docubot.yml consumes
 * the event.
 *
 * Guards:
 *   1. Trigger surface is exactly pull_request closed on main (thin — no
 *      issue_comment / pull_request_review_comment per the Inv-25 lesson).
 *   2. Job filters to merged==true (closed-without-merge must not dispatch).
 *   3. App-token mint via actions/create-github-app-token, scoped to the
 *      private docs-site repo.
 *   4. Dispatch targets knowledge-hub-docs-site with event_type
 *      kh-public-pr-merged and carries the PR number in client_payload.
 *   5. AC-D2 hygiene: the public workflow never mentions the private-lane
 *      public-repo-checkout knob (it exists only in the private docubot
 *      lane; the literal is split below so this guard itself stays out of
 *      the AC-D2 repo-wide grep).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const wfPath = join(process.cwd(), '.github/workflows/docs-dispatch.yml');
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
    steps?: Array<{
      name?: string;
      uses?: string;
      run?: string;
      with?: Record<string, unknown>;
      env?: Record<string, unknown>;
    }>;
  }
>;
const job = jobs.dispatch;

describe('docs-dispatch.yml workflow shape (ID-68.26 / TECH PC-27)', () => {
  it('YAML-parses with a single dispatch job', () => {
    expect(doc).toBeTypeOf('object');
    expect(Object.keys(jobs)).toEqual(['dispatch']);
  });

  it('triggers on pull_request closed against main (only)', () => {
    expect(Object.keys(on)).toEqual(['pull_request']);
    const pr = on.pull_request as { types?: string[]; branches?: string[] };
    expect(pr.types).toEqual(['closed']);
    expect(pr.branches).toEqual(['main']);
  });

  it('filters the job to merged==true (closed-without-merge must not dispatch)', () => {
    expect(job.if).toContain('github.event.pull_request.merged == true');
  });

  it('runs on ubuntu-latest with a short timeout and read-only permissions', () => {
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBeLessThanOrEqual(10);
    expect(job.permissions).toEqual({ contents: 'read' });
  });

  it('mints a GitHub App token scoped to the private docs-site repo', () => {
    const mint = (job.steps ?? []).find((s) =>
      (s.uses ?? '').startsWith('actions/create-github-app-token'),
    );
    expect(mint).toBeDefined();
    expect(mint?.with?.owner).toBe('ai-solution-hub');
    expect(mint?.with?.repositories).toBe('knowledge-hub-docs-site');
    expect(mint?.with?.['app-id']).toBe('${{ secrets.APP_ID }}');
    expect(mint?.with?.['private-key']).toBe('${{ secrets.APP_PRIVATE_KEY }}');
  });

  it('sends repository_dispatch kh-public-pr-merged with the PR number payload', () => {
    const dispatch = (job.steps ?? []).find((s) =>
      (s.run ?? '').includes('dispatches'),
    );
    expect(dispatch).toBeDefined();
    const run = dispatch?.run ?? '';
    expect(run).toContain(
      'repos/ai-solution-hub/knowledge-hub-docs-site/dispatches',
    );
    expect(run).toContain('event_type=kh-public-pr-merged');
    expect(run).toContain('client_payload[pr_number]');
    // Injection hygiene: the PR number is routed through an env var, never
    // interpolated directly into the run body.
    expect(run).not.toContain('${{');
    expect(dispatch?.env?.PR_NUMBER).toBe(
      '${{ github.event.pull_request.number }}',
    );
  });

  it('never mentions the private-lane checkout knob (AC-D2)', () => {
    // Literal assembled at runtime so this guard does not itself appear in
    // the AC-D2 repo-wide grep for the knob name.
    const knob = ['KH_PUBLIC', 'REPO_DIR'].join('_');
    expect(raw).not.toContain(knob);
  });
});
