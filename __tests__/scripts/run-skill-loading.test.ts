/**
 * ID-9.13 — shared skill-driver context-loading guard for
 * `scripts/skills/run-skill.ts`.
 *
 * The single driver (Inv-43) must load AGENTS.md + keep-docs-in-sync + the
 * per-skill SKILL.md + per-skill references/*.md, be parameterised by --skill
 * and --skill-md, and drive the real SDK query() entry point. Spec: TECH §4.1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const driver = readFileSync(
  join(process.cwd(), 'scripts/skills/run-skill.ts'),
  'utf8',
);

describe('run-skill.ts shared driver (ID-9.13 / TECH §4.1)', () => {
  it('is parameterised by --skill and --skill-md', () => {
    expect(driver).toContain('skill');
    expect(driver).toContain("'skill-md'");
  });

  it('loads AGENTS.md into the prompt context', () => {
    expect(driver).toContain('AGENTS.md');
  });

  it('loads the keep-docs-in-sync SKILL.md into the prompt context', () => {
    expect(driver).toContain('.claude/skills/keep-docs-in-sync/SKILL.md');
  });

  it('loads per-skill references/*.md', () => {
    expect(driver).toContain('references');
  });

  it('imports the SDK directly and uses the real query() entry point', () => {
    expect(driver).toMatch(
      /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*'@anthropic-ai\/claude-agent-sdk'/,
    );
    expect(driver).toContain('query({');
    expect(driver).not.toMatch(/new Agent\(/);
  });

  it('runs the agent with cwd at the repo root (GITHUB_WORKSPACE)', () => {
    expect(driver).toContain('GITHUB_WORKSPACE');
  });
});
