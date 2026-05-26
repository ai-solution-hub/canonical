/**
 * ID-9.12 — driver context-loading guard for `scripts/docubot/run-agent.ts`.
 *
 * The driver must read AGENTS.md + keep-docs-in-sync into the agent's context
 * (Inv-31 / Inv-37) and set the agent's working directory to the source-PR
 * repo root ($GITHUB_WORKSPACE). Spec: TECH §3.5.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const driver = readFileSync(
  join(process.cwd(), 'scripts/docubot/run-agent.ts'),
  'utf8',
);

describe('docubot run-agent.ts context loading (ID-9.12 / TECH §3.5)', () => {
  it('reads AGENTS.md into the prompt context', () => {
    expect(driver).toContain('AGENTS.md');
  });

  it('reads the keep-docs-in-sync SKILL.md into the prompt context', () => {
    expect(driver).toContain('.claude/skills/keep-docs-in-sync/SKILL.md');
  });

  it('reads the context files via fs readFile (not only via the agent tools)', () => {
    expect(driver).toMatch(/readFile\(/);
  });

  it('sets the agent cwd to GITHUB_WORKSPACE (the source-PR repo root)', () => {
    expect(driver).toContain('GITHUB_WORKSPACE');
  });

  it('honours the --prompt-file flag the composite action passes', () => {
    expect(driver).toContain("'prompt-file'");
  });
});
