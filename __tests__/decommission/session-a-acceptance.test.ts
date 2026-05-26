/**
 * ID-9.20 — Session A decommission gate (acceptance assertions).
 *
 * Inv-47 / OQ-PLAN-1: docubot must open >= 3 sample docs PRs (synthetically via
 * workflow_dispatch against 3 historical source-PR numbers) with the correct
 * branch / title / commit shapes and exactly ONE source-PR comment each, and
 * review-docs-pr must have run against each. Liam manually reviews (a)+(b)+(d)
 * workload faithfulness.
 *
 * This gate depends on LIVE workflow runs + a human review and therefore CANNOT
 * be produced in a headless worker. The test reads an evidence file the live
 * gate writes —
 *   .claude/cmux-events/session-a-results.json
 *     { "prs": [ { "number", "branch", "title", "commit", "source_pr",
 *                  "comment_count", "review_docs_pr_ran" } ] }
 * — and asserts the shapes. When the evidence file is absent (headless / gate
 * not yet run), the suite skips with a clear note so it never silently passes
 * (the brief's non-vacuous-acceptance rule). The parent session / Liam runs the
 * three workflow_dispatch invocations, captures the evidence file, and the
 * gate then asserts for real.
 *
 * Spec: TECH §5.3 Session A; PRODUCT Inv-44 + Inv-47.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EVIDENCE = join(
  process.cwd(),
  '.claude/cmux-events/session-a-results.json',
);

interface DocsPr {
  number: number;
  branch: string;
  title: string;
  commit: string;
  source_pr: number;
  comment_count: number;
  review_docs_pr_ran: boolean;
}

const haveEvidence = existsSync(EVIDENCE);
const prs: DocsPr[] = haveEvidence
  ? (JSON.parse(readFileSync(EVIDENCE, 'utf8')).prs as DocsPr[])
  : [];

const suite = haveEvidence ? describe : describe.skip;

if (!haveEvidence) {
  console.warn(
    '[ID-9.20] Session A gate SKIPPED: no .claude/cmux-events/session-a-results.json. ' +
      'This gate requires 3 live docubot workflow_dispatch runs + Liam manual review ' +
      '(cannot run headless). Parent/Liam runs the gate, writes the evidence file, re-runs.',
  );
}

suite('Session A decommission gate (ID-9.20 / Inv-47)', () => {
  it('opened at least 3 sample docs PRs', () => {
    expect(prs.length).toBeGreaterThanOrEqual(3);
  });

  it('each docs PR uses a docubot/* branch', () => {
    for (const pr of prs) expect(pr.branch).toMatch(/^docubot\//);
  });

  it('each docs PR title matches "Docs: <summary> (from #<N>)"', () => {
    for (const pr of prs) {
      expect(pr.title).toMatch(/^Docs: .+ \(from #\d+\)$/);
      expect(pr.title).toContain(`#${pr.source_pr}`);
    }
  });

  it('each docs PR commit matches "docs(<area>): <summary>"', () => {
    for (const pr of prs) expect(pr.commit).toMatch(/^docs\([a-z-]+\): .+/);
  });

  it('each source PR received exactly ONE docubot comment (single-comment guardrail)', () => {
    for (const pr of prs) expect(pr.comment_count).toBe(1);
  });

  it('review-docs-pr ran against each docubot-opened PR', () => {
    for (const pr of prs) expect(pr.review_docs_pr_ran).toBe(true);
  });
});
