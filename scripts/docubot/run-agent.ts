#!/usr/bin/env bun
/**
 * docubot Claude Agent SDK driver (ID-9.12).
 *
 * Invoked by `.github/actions/docubot/action.yml`:
 *   bun scripts/docubot/run-agent.ts --prompt-file prompt.output.txt
 *
 * Reads the rendered KH-persona prompt (TECH §3.3), injects the docs-corpus
 * style guide (`AGENTS.md`) + IA conventions
 * (`.claude/skills/keep-docs-in-sync/SKILL.md`) as the system prompt, then
 * drives `@anthropic-ai/claude-agent-sdk`'s `query()` to read source context,
 * write docs-site pages, and open the follow-up docs PR via gh/git.
 *
 * IMPLEMENTATION NOTE: TECH §3.5 sketched an `Agent` class (constructed with a
 * client + tools + cwd) that does NOT exist in the published SDK. This driver
 * is written against the REAL installed API (validated against
 * `@anthropic-ai/claude-agent-sdk@0.3.150`):
 * the entry point is the `query()` async generator, the API key is read from
 * `process.env.ANTHROPIC_API_KEY` by the SDK, and the terminal `result`
 * message carries `result` / `is_error` / `total_cost_usd`.
 *
 * Spec: TECH §3.2 + §3.5 + §3.7; PRODUCT Inv-32 (Claude Agent SDK, NOT Claude
 * Code headless), Inv-28 (timeout/observability), Inv-33 (secrets contract).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'prompt-file': { type: 'string' },
  },
});

const promptPath = values['prompt-file'];
if (!promptPath) {
  console.error('[docubot] --prompt-file is required');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[docubot] ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
const model = process.env.CLAUDE_MODEL ?? 'claude-opus-4-7';

// The rendered prompt plus the two context files the docubot persona relies
// on. These context files are REQUIRED: a missing AGENTS.md or
// keep-docs-in-sync SKILL.md is a misconfiguration that must fail the run
// loudly, not silently produce off-convention docs (readFile rejects → the
// process exits non-zero).
const renderedPrompt = await readFile(promptPath, 'utf8');
const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf8');
const keepDocsMd = await readFile(
  join(root, '.claude/skills/keep-docs-in-sync/SKILL.md'),
  'utf8',
);

const systemPrompt = [
  'You are docubot for the Knowledge Hub repository. The project context below',
  'is authoritative: follow AGENTS.md for voice, terminology, the frontmatter',
  'contract, and AI-invisibility; follow keep-docs-in-sync for IA conventions,',
  'commit + PR conventions, and the single-comment guardrail.',
  '',
  '===== AGENTS.md =====',
  agentsMd,
  '',
  '===== .claude/skills/keep-docs-in-sync/SKILL.md =====',
  keepDocsMd,
].join('\n');

await mkdir(join(root, '.docubot'), { recursive: true });
const logPath = join(root, '.docubot/run.log');
const logLines: string[] = [];

let resultText = '';
let isError = false;

for await (const message of query({
  prompt: renderedPrompt,
  options: {
    model,
    cwd: root,
    systemPrompt,
    // Unattended CI run — no human is present to approve tool calls.
    permissionMode: 'bypassPermissions',
    // docubot reads source context, writes docs-site pages, and drives
    // gh/git through the shell.
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
      `[docubot] done subtype=${message.subtype} ` +
        `cost_usd=${message.total_cost_usd.toFixed(4)} turns=${message.num_turns}`,
    );
  }
}

await writeFile(logPath, `${logLines.join('\n')}\n`, 'utf8');
if (resultText) console.log(resultText);
if (isError) process.exit(1);
