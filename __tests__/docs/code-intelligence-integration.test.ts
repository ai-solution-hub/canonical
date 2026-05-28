/**
 * code-intelligence-integration.test.ts — CI freshness guard (ID-23.16).
 *
 * Asserts that the 12 named HTML comment anchor pairs introduced by Task ID-23
 * are present in their respective surface files, and that each anchor block
 * contains the required code-intelligence content strings.
 *
 * Additionally asserts standalone content requirements for:
 * - implement-subtask/SKILL.md journal-block schema literals
 * - workflow-curator.md caller-count pre-grep mentions
 * - lifecycle-detail.md cite-the-impact-verdict paragraphs
 * - task-checker.md JSON axis_scores keys
 * - docs/reference/skill-routing-map.md tilt row 11
 * - skill-routing-map.md canonical location (positive + negative)
 * - write-tech-spec/SKILL.md Code-intelligence orientation header position
 *
 * Failure recovery: if an anchor is missing, restore it via the
 * `update-skill` or `agent-development` skill per
 * docs/specs/id-23-code-intelligence-integration/TECH.md §3.
 *
 * Per docs/reference/test-philosophy.md — pure file-read + regex asserts,
 * no Supabase fixtures, no chain-method asserts.
 *
 * ID-23.16 (kh-prod-readiness-S277).
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = join(__dirname, '../..');

function r(relativePath: string): string {
  return join(PROJECT_ROOT, relativePath);
}

// ---------------------------------------------------------------------------
// Anchor inventory — 12 entries, one per TECH.md §4 anchor-inventory row.
// ---------------------------------------------------------------------------

const REQUIRED_ANCHORS: ReadonlyArray<{
  file: string;
  anchorKey: string;
  requiredContent: ReadonlyArray<RegExp>;
}> = [
  // 1 — workflow-orchestration baseline
  {
    file: '.claude/skills/workflow-orchestration/SKILL.md',
    anchorKey: 'baseline',
    requiredContent: [
      /gitnexus_impact/,
      /gitnexus_detect_changes/,
      /gitnexus_query/,
      /ast-dataflow/,
      /ccc/,
    ],
  },
  // 2 — workflow-orchestration planner-block
  {
    file: '.claude/skills/workflow-orchestration/SKILL.md',
    anchorKey: 'planner-block',
    requiredContent: [
      /gitnexus_query/,
      /gitnexus_context/,
      /(spec's Context|Problem)/,
    ],
  },
  // 3 — workflow-orchestration executor-block
  {
    file: '.claude/skills/workflow-orchestration/SKILL.md',
    anchorKey: 'executor-block',
    requiredContent: [
      /gitnexus_impact/,
      /gitnexus_detect_changes/,
      /HIGH or CRITICAL/,
    ],
  },
  // 4 — workflow-orchestration allowlist
  {
    file: '.claude/skills/workflow-orchestration/SKILL.md',
    anchorKey: 'allowlist',
    requiredContent: [
      /\.ts/,
      /\.tsx/,
      /app\//,
      /lib\//,
      /scripts\//,
      /\.md/,
      /\.py/,
      /\.sql/,
    ],
  },
  // 5 — task-planner planner-block (same patterns as #2 — duplicated by design)
  {
    file: '.claude/agents/task-planner.md',
    anchorKey: 'planner-block',
    requiredContent: [
      /gitnexus_query/,
      /gitnexus_context/,
      /(spec's Context|Problem)/,
    ],
  },
  // 6 — task-executor executor-block
  {
    file: '.claude/agents/task-executor.md',
    anchorKey: 'executor-block',
    requiredContent: [
      /gitnexus_impact/,
      /gitnexus_detect_changes/,
      /HIGH or CRITICAL/,
    ],
  },
  // 7 — task-checker checker-axes
  {
    file: '.claude/agents/task-checker.md',
    anchorKey: 'checker-axes',
    requiredContent: [
      /scope-containment/,
      /rename-sweep/,
      /gitnexus_detect_changes/,
      /ast-dataflow.*Q1.*Q2.*Q3/,
    ],
  },
  // 8 — triage-finding curator-pregrep
  {
    file: '.claude/skills/triage-finding/SKILL.md',
    anchorKey: 'curator-pregrep',
    requiredContent: [
      /gitnexus_context/,
      /ast-dataflow callers/,
      /≥ 10/,
      /≥ 3 modules/,
    ],
  },
  // 9 — write-product-spec planner-citation
  {
    file: '.claude/skills/write-product-spec/SKILL.md',
    anchorKey: 'planner-citation',
    requiredContent: [
      /Code-intelligence orientation/,
      /greenfield surface/,
    ],
  },
  // 10 — write-tech-spec planner-citation
  {
    file: '.claude/skills/write-tech-spec/SKILL.md',
    anchorKey: 'planner-citation',
    requiredContent: [
      /Code-intelligence orientation/,
      /greenfield surface/,
    ],
  },
  // 11 — .gitnexus/CLAUDE.md propagation
  {
    file: '.gitnexus/CLAUDE.md',
    anchorKey: 'propagation',
    requiredContent: [
      /Propagation discipline/,
      /Inv 2/,
      /Inv 3/,
      /Inv 7/,
      /Inv 8/,
    ],
  },
  // 12 — .ast-dataflow/CLAUDE.md propagation
  {
    file: '.ast-dataflow/CLAUDE.md',
    anchorKey: 'propagation',
    requiredContent: [
      /Propagation discipline/,
      /Inv 2/,
      /Inv 3/,
      /Inv 7/,
      /Inv 8/,
    ],
  },
];

// ---------------------------------------------------------------------------
// Anchor-based tests
// ---------------------------------------------------------------------------

describe('code-intelligence integration anchors (ID-23)', () => {
  for (const spec of REQUIRED_ANCHORS) {
    const anchorStart = `<!-- code-intel:${spec.anchorKey}-start -->`;
    const anchorEnd = `<!-- code-intel:${spec.anchorKey}-end -->`;

    it(`${spec.file} contains ${anchorStart} … ${anchorEnd}`, async () => {
      const filePath = r(spec.file);
      expect(
        existsSync(filePath),
        `File not found: ${spec.file}. Restore via update-skill / agent-development per docs/specs/id-23-code-intelligence-integration/TECH.md §3.`,
      ).toBe(true);

      const body = await readFile(filePath, 'utf8');

      expect(
        body,
        `Anchor ${anchorStart}/${anchorEnd} missing from ${spec.file}. Restore via update-skill / agent-development per docs/specs/id-23-code-intelligence-integration/TECH.md §3.`,
      ).toContain(anchorStart);

      expect(
        body,
        `Anchor ${anchorStart}/${anchorEnd} missing from ${spec.file}. Restore via update-skill / agent-development per docs/specs/id-23-code-intelligence-integration/TECH.md §3.`,
      ).toContain(anchorEnd);

      const startIndex = body.indexOf(anchorStart) + anchorStart.length;
      const endIndex = body.indexOf(anchorEnd);

      expect(
        endIndex,
        `Anchor ${anchorEnd} appears before ${anchorStart} in ${spec.file}. Restore via update-skill / agent-development per docs/specs/id-23-code-intelligence-integration/TECH.md §3.`,
      ).toBeGreaterThan(startIndex);

      const block = body.slice(startIndex, endIndex);

      for (const required of spec.requiredContent) {
        expect(
          block,
          `Anchor ${anchorStart}/${anchorEnd} missing from ${spec.file}. Restore via update-skill / agent-development per docs/specs/id-23-code-intelligence-integration/TECH.md §3.`,
        ).toMatch(required);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Part 2 — standalone assertions (not anchor-based)
  // ---------------------------------------------------------------------------

  it('implement-subtask/SKILL.md contains journal-block schema literals (Inv 6 + Inv 14)', async () => {
    const body = await readFile(r('.claude/skills/implement-subtask/SKILL.md'), 'utf8');
    expect(body).toContain('Blast radius:');
    expect(body).toContain('Scope verified:');
    expect(body).toContain('Pre-commit scope check (manual gate)');
    expect(body).toContain('gitnexus_detect_changes');
  });

  it('workflow-curator.md contains caller-count pre-grep mentions (Inv 8)', async () => {
    const body = await readFile(r('.claude/agents/workflow-curator.md'), 'utf8');
    expect(body).toContain('gitnexus_context');
    expect(body).toContain('ast-dataflow callers');
  });

  it('lifecycle-detail.md cites the gitnexus_impact verdict in both PRODUCT and TECH sub-sections (Inv 15)', async () => {
    const body = await readFile(
      r('.claude/skills/workflow-orchestration/references/lifecycle-detail.md'),
      'utf8',
    );
    const occurrences = (body.match(/cites the gitnexus_impact verdict/g) ?? []).length;
    expect(
      occurrences,
      'Expected "cites the gitnexus_impact verdict" to appear at least twice in lifecycle-detail.md (once in PRODUCT sub-section, once in TECH sub-section).',
    ).toBeGreaterThanOrEqual(2);
  });

  it('task-checker.md axis_scores JSON includes "scope-containment": and "rename-sweep": keys (Inv 7)', async () => {
    const body = await readFile(r('.claude/agents/task-checker.md'), 'utf8');
    expect(body).toMatch(/"scope-containment":/);
    expect(body).toMatch(/"rename-sweep":/);
  });

  it('skill-routing-map.md contains Refactor / Rename / Type-evolution row with all five Required skills (Inv 12)', async () => {
    const body = await readFile(r('docs/reference/skill-routing-map.md'), 'utf8');
    expect(body).toMatch(/Refactor \/ Rename \/ Type-evolution/);
    expect(body).toContain('gitnexus-refactoring');
    expect(body).toContain('gitnexus-impact-analysis');
    expect(body).toContain('ast-dataflow');
    expect(body).toContain('ast-dataflow-rename-sweep');
    expect(body).toContain('ast-dataflow-call-chain-pin');
  });

  it('skill-routing-map.md exists at docs/reference/ and NOT at .claude/skills/workflow-orchestration/references/ (Inv 13)', () => {
    expect(
      existsSync(r('docs/reference/skill-routing-map.md')),
      'docs/reference/skill-routing-map.md not found — file was moved or deleted.',
    ).toBe(true);
    expect(
      existsSync(r('.claude/skills/workflow-orchestration/references/skill-routing-map.md')),
      'skill-routing-map.md must NOT exist at .claude/skills/workflow-orchestration/references/ — canonical location is docs/reference/.',
    ).toBe(false);
  });

  it('write-tech-spec/SKILL.md: first ### heading after "Research before writing" is "### Code-intelligence orientation" (Inv 9)', async () => {
    const body = await readFile(r('.claude/skills/write-tech-spec/SKILL.md'), 'utf8');
    const researchBeforeWritingIndex = body.indexOf('## Research before writing');
    expect(
      researchBeforeWritingIndex,
      '"## Research before writing" section not found in write-tech-spec/SKILL.md.',
    ).toBeGreaterThanOrEqual(0);

    const afterSection = body.slice(researchBeforeWritingIndex + '## Research before writing'.length);
    const firstH3Match = afterSection.match(/^### (.+)$/m);
    expect(
      firstH3Match,
      'No ### heading found after "## Research before writing" in write-tech-spec/SKILL.md.',
    ).not.toBeNull();

    expect(
      firstH3Match![1].trim(),
      'First ### heading after "Research before writing" must be "Code-intelligence orientation" (Inv 9 header-position).',
    ).toBe('Code-intelligence orientation');
  });
});
