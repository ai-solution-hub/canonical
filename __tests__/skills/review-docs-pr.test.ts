/**
 * ID-9.14 — review-docs-pr skill body + workflow contract guard.
 *
 * Spec: TECH §4.3; PRODUCT Inv-35 (Phase-2 composability) + Inv-38 (review.json
 * + severity prefixes + gh pr comment, no emoji).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const skill = readFileSync(
  join(process.cwd(), '.claude/skills/review-docs-pr/SKILL.md'),
  'utf8',
);
const wfRaw = readFileSync(
  join(process.cwd(), '.github/workflows/review-docs-pr.yml'),
  'utf8',
);
const wf = parse(wfRaw) as Record<string, unknown>;
const on = (wf.on ?? (wf as Record<string, unknown>)['true']) as Record<
  string,
  unknown
>;
const job = (wf.jobs as Record<string, { if?: string }>)['review-docs-pr'];

describe('review-docs-pr SKILL.md contract (ID-9.14 / Inv-38)', () => {
  it('defines the review.json output contract fields', () => {
    expect(skill).toContain('review.json');
    for (const field of ['path', 'line', 'severity', 'body']) {
      expect(skill).toContain(field);
    }
  });

  it('uses the four text severity labels (no emoji glyphs)', () => {
    for (const sev of ['CRITICAL', 'IMPORTANT', 'SUGGESTION', 'NIT']) {
      expect(skill).toContain(sev);
    }
    // No emoji anywhere in the skill body (AGENTS.md §1.4).
    expect(/\p{Extended_Pictographic}/u.test(skill)).toBe(false);
  });

  it('enforces the single-comment guardrail and posts via gh pr comment', () => {
    expect(skill).toMatch(/single.comment/i);
    expect(skill).toContain('gh pr comment');
  });

  it('reviews — does not rewrite (no new PRs / commits)', () => {
    expect(skill).toMatch(/it does not rewrite|does not push commits/i);
  });
});

describe('review-docs-pr.yml trigger override (ID-9.14 / Inv-35)', () => {
  it('triggers on pull_request_review in addition to workflow_dispatch', () => {
    expect(on).toHaveProperty('workflow_dispatch');
    expect(on).toHaveProperty('pull_request_review');
  });

  it('filters to docubot/* head branches or Docs:-titled PRs to main', () => {
    expect(job.if).toContain(
      "startsWith(github.event.pull_request.head.ref, 'docubot/')",
    );
    expect(job.if).toContain(
      "startsWith(github.event.pull_request.title, 'Docs:')",
    );
    expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
  });
});
