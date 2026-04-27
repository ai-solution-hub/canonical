/**
 * Verifies the MCP `bid_pipeline_review` prompt template.
 *
 * Asserts registration, args schema (stale_threshold_days optional),
 * tool-name references (list_active_bids + get_bid_detail), the five
 * output sections, the default stale threshold (5 days), and that it
 * coexists with the prior 6 prompts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { z } from 'zod';
import { registerPrompts } from '@/lib/mcp/resources';

type PromptHandler = (args: Record<string, unknown>) => Promise<{
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

describe('MCP bid_pipeline_review prompt', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    server = createMockMcpServer();
    registerPrompts(server as never);
  });

  it('registers a bid_pipeline_review prompt', () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    expect(prompt).toBeDefined();
    expect(prompt!.config.title).toBe('Bid Pipeline Review');
  });

  it('declares an optional stale_threshold_days arg', () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const argsSchema = prompt!.config.argsSchema as Record<
      string,
      z.ZodTypeAny
    >;
    expect(argsSchema).toBeDefined();
    expect(argsSchema.stale_threshold_days).toBeDefined();
    // Enforce optionality so a future breaking change is caught.
    expect(argsSchema.stale_threshold_days.isOptional()).toBe(true);
  });

  it('includes the KB system context', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({});
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('Knowledge Hub');
    expect(text).toContain('UK English');
  });

  it('references the two core bid tools', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({});
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('list_active_bids');
    expect(text).toContain('get_bid_detail');
  });

  it('frames output as cross-bid action review, not per-bid status', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({});
    const text = result.messages[0]?.content.text ?? '';
    // Differentiator from /kb:bid-status
    expect(text).toContain('NOT per-bid status');
    expect(text).toContain('/kb:bid-status');
  });

  it('specifies the 5 output sections', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({});
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('### Critical blockers');
    expect(text).toContain('### Stalled drafts');
    expect(text).toContain('### SME input needed');
    expect(text).toContain('### Recent activity');
    expect(text).toContain('### Prioritised next actions');
  });

  it('references the confidence posture values the prompt must filter on', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({});
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('no_content');
    expect(text).toContain('needs_sme');
  });

  it('defaults stale_threshold_days to 5 when omitted', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({});
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('more than 5 days ago');
    expect(text).toContain('threshold 5');
  });

  it('honours a non-default stale_threshold_days', async () => {
    const prompt = server.getPrompt('bid_pipeline_review');
    const result = await prompt!.handler({ stale_threshold_days: '10' });
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('more than 10 days ago');
    expect(text).toContain('threshold 10');
    expect(text).not.toContain('more than 5 days ago');
  });

  it('leaves all 6 prior prompts registered', () => {
    expect(server.getPrompt('reorient')).toBeDefined();
    expect(server.getPrompt('bid_briefing')).toBeDefined();
    expect(server.getPrompt('coverage_analysis')).toBeDefined();
    expect(server.getPrompt('draft_response')).toBeDefined();
    expect(server.getPrompt('review_item')).toBeDefined();
    expect(server.getPrompt('sector_briefing')).toBeDefined();
  });
});
