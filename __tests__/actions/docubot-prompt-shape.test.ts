/**
 * ID-9.11 — KH-persona prompt-template shape guard for
 * `.github/actions/docubot/prompt.txt`.
 *
 * The body is embedded VERBATIM from TECH §3.3 (a critical lock: it is the
 * template, not a reference). This guard asserts the six required rule
 * sections are present, the envsubst placeholders survive, no Warp persona
 * leaks through, and the post-S65 ledger amendments (umbrellas.json 4th
 * ledger + roadmap themes[] shape) are present.
 *
 * Spec: TECH §3.3 + Inv-26/27/29/30/31; task-list ID-9.11 POST-S65 amendments.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const promptPath = join(process.cwd(), '.github/actions/docubot/prompt.txt');
const prompt = readFileSync(promptPath, 'utf8');

describe('docubot prompt.txt shape (ID-9.11 / TECH §3.3)', () => {
  it('carries the four envsubst PR-context placeholders', () => {
    expect(prompt).toContain('$PR_OR_ISSUE_TITLE');
    expect(prompt).toContain('$PR_OR_ISSUE_BODY');
    expect(prompt).toContain('$PR_OR_ISSUE_URL');
    expect(prompt).toContain('$PR_CHANGED_FILES');
  });

  it('contains the six required rule sections', () => {
    // persona
    expect(prompt).toMatch(/Your persona: You are \*\*docubot\*\*/);
    // scope
    expect(prompt).toMatch(/- Scope:/);
    // divergence flag
    expect(prompt).toContain('kh_docubot_owned: true');
    // style (loads AGENTS.md + keep-docs-in-sync)
    expect(prompt).toContain('`AGENTS.md`');
    expect(prompt).toContain('.claude/skills/keep-docs-in-sync/SKILL.md');
    // commit + PR conventions
    expect(prompt).toMatch(/Commit & PR conventions:/);
    // output instructions
    expect(prompt).toMatch(/IMPORTANT OUTPUT INSTRUCTIONS:/);
  });

  it('enforces the single-comment guardrail (Inv-27)', () => {
    expect(prompt).toMatch(/ONE comment on the source PR per run/);
  });

  it('writes directly to docs-site, not the docs/ source tree (Inv-30)', () => {
    expect(prompt).toContain('docs-site/src/content/docs/<space>/<file>.md');
    expect(prompt).toMatch(/Do NOT touch the\s+upstream `docs\/` source tree/);
  });

  it('has no Warp persona or GitBook references surviving', () => {
    expect(prompt.toLowerCase()).not.toContain('warp');
    expect(prompt.toLowerCase()).not.toContain('gitbook');
  });

  it('uses Vercel-default-subdomain framing (no prescriptive custom docs domain)', () => {
    // Guard: the prompt must not hardcode a deploy-specific docs domain
    // (docs.<production-domain>). The production domain is per-deploy
    // config (APP_URL), never prompt source.
    expect(prompt).not.toMatch(/docs\.kh\./);
  });

  it('enumerates umbrellas.json as the 4th canonical ledger (amendment 1)', () => {
    expect(prompt).toContain('docs/reference/umbrellas.json');
    for (const field of [
      '`id`',
      '`title`',
      '`substrate_doc`',
      '`task_ids`',
      '`status`',
      '`phase`',
    ]) {
      expect(prompt).toContain(field);
    }
  });

  it('references the roadmap themes[] shape, not legacy sections[] (amendment 2)', () => {
    expect(prompt).toContain('theme.title');
    expect(prompt).toContain('theme.time_horizon');
    expect(prompt).toContain('theme.linked_tasks');
    expect(prompt).toContain('theme.linked_backlog');
    expect(prompt).toContain('theme.status');
    expect(prompt).toContain('capability_theme');
  });
});
