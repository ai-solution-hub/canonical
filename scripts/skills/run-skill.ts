#!/usr/bin/env bun
/**
 * Shared Claude Agent SDK driver for the five ported KH docs-maintenance
 * skills (ID-9.13). ONE driver, five workflows — each workflow invokes this
 * with a different `--skill` (Inv-43 canonical shape).
 *
 *   bun scripts/skills/run-skill.ts --skill <name> --skill-md <path-to-SKILL.md>
 *
 * Loads, into the agent's system prompt: the docs-corpus style guide
 * (`AGENTS.md`, Inv-37), the IA conventions
 * (`.claude/skills/keep-docs-in-sync/SKILL.md`), the per-skill `SKILL.md`
 * body, and any per-skill `references/*.md`. Then drives the SDK's `query()`
 * (the real entry point — see scripts/docubot/run-agent.ts for the same note
 * on why this is NOT the `Agent` class TECH §3.5 sketched).
 *
 * Spec: TECH §4.1 (canonical shape) + §4.2 (skill set); PRODUCT Inv-37/43.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    skill: { type: 'string' },
    'skill-md': { type: 'string' },
  },
});

const skill = values.skill;
const skillMdPath = values['skill-md'];
if (!skill || !skillMdPath) {
  console.error('[run-skill] --skill and --skill-md are both required');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[run-skill] ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
const model = process.env.CLAUDE_MODEL ?? 'claude-opus-4-7';

// Required context. A missing AGENTS.md / keep-docs-in-sync / SKILL.md is a
// misconfiguration that must fail the run loudly (readFile rejects → non-zero
// exit), not silently produce off-convention output.
const skillMd = await readFile(skillMdPath, 'utf8');
const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf8');
const keepDocsMd = await readFile(
  join(root, '.claude/skills/keep-docs-in-sync/SKILL.md'),
  'utf8',
);

// Optional per-skill references/*.md.
let references = '';
const refsDir = join(dirname(skillMdPath), 'references');
if (existsSync(refsDir)) {
  for (const entry of (await readdir(refsDir)).sort()) {
    if (entry.endsWith('.md')) {
      references += `\n===== references/${entry} =====\n${await readFile(
        join(refsDir, entry),
        'utf8',
      )}`;
    }
  }
}

const targetPr = process.env.TARGET_PR_NUMBER?.trim();
const promptOverride = process.env.PROMPT_OVERRIDE?.trim();

const systemPrompt = [
  `You are running the Knowledge Hub docs-maintenance skill "${skill}".`,
  'Follow AGENTS.md for voice, terminology, the frontmatter contract, and',
  'AI-invisibility; follow keep-docs-in-sync for IA conventions, commit + PR',
  'conventions, and the single-comment guardrail. The skill body below defines',
  'your task and its output contract.',
  '',
  '===== AGENTS.md =====',
  agentsMd,
  '',
  '===== .claude/skills/keep-docs-in-sync/SKILL.md =====',
  keepDocsMd,
  '',
  `===== .claude/skills/${skill}/SKILL.md =====`,
  skillMd,
  references,
].join('\n');

const prompt =
  promptOverride ||
  `Run the ${skill} skill against the Knowledge Hub docs corpus` +
    (targetPr ? ` scoped to PR #${targetPr}.` : '.') +
    ` Write any outputs under .skills/${skill}/output/ and follow the skill` +
    " body's contract exactly.";

await mkdir(join(root, `.skills/${skill}/output`), { recursive: true });
const logPath = join(root, `.skills/${skill}/run.log`);
const logLines: string[] = [];

let resultText = '';
let isError = false;

for await (const message of query({
  prompt,
  options: {
    model,
    cwd: root,
    systemPrompt,
    permissionMode: 'bypassPermissions',
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  },
})) {
  logLines.push(JSON.stringify(message));
  if (message.type === 'result') {
    isError = message.is_error === true;
    if ('result' in message && typeof message.result === 'string') {
      resultText = message.result;
    }
    console.log(
      `[run-skill:${skill}] done subtype=${message.subtype} ` +
        `cost_usd=${message.total_cost_usd.toFixed(4)} turns=${message.num_turns}`,
    );
  }
}

await writeFile(logPath, `${logLines.join('\n')}\n`, 'utf8');
if (resultText) console.log(resultText);
if (isError) process.exit(1);
