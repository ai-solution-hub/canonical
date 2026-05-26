/**
 * ID-9.12 — Claude Agent SDK dependency + import guard.
 *
 * The docubot (and five-skill) drivers depend on `@anthropic-ai/claude-agent-sdk`,
 * which must be declared (pinned) in devDependencies so the composite action's
 * `bun install --frozen-lockfile` resolves it. The driver imports the SDK
 * directly (no barrel re-export, per the CLAUDE.md rule) and uses the real
 * `query()` entry point — NOT the fictional `Agent` class TECH §3.5 sketched.
 *
 * Spec: TECH §3.5; PRODUCT Inv-32.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { devDependencies?: Record<string, string> };

const driver = readFileSync(
  join(process.cwd(), 'scripts/docubot/run-agent.ts'),
  'utf8',
);

describe('claude-agent-sdk dependency + import (ID-9.12 / Inv-32)', () => {
  it('declares @anthropic-ai/claude-agent-sdk in devDependencies', () => {
    expect(
      pkg.devDependencies?.['@anthropic-ai/claude-agent-sdk'],
    ).toBeDefined();
  });

  it('pins the SDK to an exact version (no ^ / ~ range)', () => {
    const v = pkg.devDependencies?.['@anthropic-ai/claude-agent-sdk'] ?? '';
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('imports the SDK directly (no barrel re-export)', () => {
    expect(driver).toMatch(
      /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*'@anthropic-ai\/claude-agent-sdk'/,
    );
  });

  it('uses the real query() entry point, not the fictional Agent class', () => {
    expect(driver).toContain('query({');
    expect(driver).not.toMatch(/new Agent\(/);
  });
});
