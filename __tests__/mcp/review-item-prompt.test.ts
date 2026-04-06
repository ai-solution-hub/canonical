/**
 * Verifies that the MCP `review_item` prompt template injects the governance
 * skill content from `lib/ai/skills/governance.md` into the prompt text that
 * is delivered to external LLM clients (Claude Desktop / Claude.ai).
 *
 * This test deliberately uses the REAL `loadSkill` loader (no mock) so that
 * it asserts the actual file contents flow into the prompt. The skill file is
 * small and read from disk, so this is feasible and meaningful.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { registerPrompts } from '@/lib/mcp/resources';

type PromptHandler = (
  args: Record<string, unknown>,
) => Promise<{
  messages: Array<{
    role: string;
    content: { type: string; text: string };
  }>;
}>;

interface PromptRegistration {
  config: Record<string, unknown>;
  handler: PromptHandler;
}

function createMockMcpServer() {
  const prompts: Record<string, PromptRegistration> = {};
  return {
    prompts,
    registerPrompt(
      name: string,
      config: Record<string, unknown>,
      handler: PromptHandler,
    ) {
      prompts[name] = { config, handler };
    },
    getPrompt(name: string): PromptRegistration | undefined {
      return prompts[name];
    },
  };
}

describe('MCP review_item prompt — governance skill wiring', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    server = createMockMcpServer();
    // registerPrompts is synchronous; the per-prompt handler is async.
    registerPrompts(server as never);
  });

  it('registers a review_item prompt', () => {
    const prompt = server.getPrompt('review_item');
    expect(prompt).toBeDefined();
    expect(prompt!.config.title).toBe('Review Content Item');
  });

  it('inlines the governance skill freshness lifecycle definitions', async () => {
    const prompt = server.getPrompt('review_item');
    expect(prompt).toBeDefined();

    const result = await prompt!.handler({
      item_id: '11111111-1111-4111-8111-111111111111',
    });
    const text = result.messages[0]?.content.text ?? '';

    // The governance skill defines the four freshness states and the four
    // lifecycle types. These strings live in `lib/ai/skills/governance.md`
    // and must reach the LLM verbatim through the prompt template.
    expect(text).toContain('fresh → aging → stale → expired');
    expect(text).toContain('Evergreen');
    expect(text).toContain('Date-Bound');
    expect(text).toContain('Regulation');
    expect(text).toContain('Bid-Discovered');
  });

  it('inlines the governance principles and review triggers', async () => {
    const prompt = server.getPrompt('review_item');
    const result = await prompt!.handler({
      item_id: '22222222-2222-4222-8222-222222222222',
    });
    const text = result.messages[0]?.content.text ?? '';

    // Governance principles and review trigger definitions.
    expect(text).toContain('Observe and intervene');
    expect(text).toContain('Quality score < 60');
    expect(text).toContain('Classification confidence < 0.5');
  });

  it('contains the entire governance.md file content verbatim', async () => {
    // This is the strongest assertion: read the real skill file from disk and
    // confirm it appears character-for-character inside the prompt text. This
    // catches any future regression that drops or transforms the skill payload.
    const skillPath = join(
      process.cwd(),
      'lib',
      'ai',
      'skills',
      'governance.md',
    );
    const realSkill = readFileSync(skillPath, 'utf-8');

    const prompt = server.getPrompt('review_item');
    const result = await prompt!.handler({
      item_id: '33333333-3333-4333-8333-333333333333',
    });
    const text = result.messages[0]?.content.text ?? '';

    expect(text).toContain(realSkill);
  });

  it('still includes the per-item review instructions and item id', async () => {
    const prompt = server.getPrompt('review_item');
    const itemId = '44444444-4444-4444-8444-444444444444';
    const result = await prompt!.handler({ item_id: itemId });
    const text = result.messages[0]?.content.text ?? '';

    expect(text).toContain(itemId);
    expect(text).toContain('get_content_item');
    // Confirms the prompt asks the LLM to APPLY the governance content rather
    // than ignore it.
    expect(text).toContain('governance');
  });
});
