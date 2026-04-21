/**
 * Verifies the MCP `sector_briefing` prompt template.
 *
 * Asserts the prompt is registered, accepts `domain` (required) and
 * `period_days` (optional) args, injects the KB system context, and
 * references the full tool set a sector briefing needs (guides, search,
 * SI, change report, governance). Also asserts the `period_days` default
 * (7) applies when the arg is omitted.
 */
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('MCP sector_briefing prompt', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    server = createMockMcpServer();
    registerPrompts(server as never);
  });

  it('registers a sector_briefing prompt', () => {
    const prompt = server.getPrompt('sector_briefing');
    expect(prompt).toBeDefined();
    expect(prompt!.config.title).toBe('Sector Briefing');
  });

  it('declares domain (required) + period_days (optional) args', () => {
    const prompt = server.getPrompt('sector_briefing');
    const argsSchema = prompt!.config.argsSchema as Record<string, unknown>;
    expect(argsSchema).toBeDefined();
    expect(argsSchema.domain).toBeDefined();
    expect(argsSchema.period_days).toBeDefined();
  });

  it('includes the KB system context prelude', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('Knowledge Hub');
    expect(text).toContain('UK English');
  });

  it('references the full tool set a sector briefing needs', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';

    // All six tool name references must be present so the LLM composes the
    // briefing against the intended data sources. This catches drift if any
    // tool is renamed.
    expect(text).toContain('list_guides');
    expect(text).toContain('search_knowledge_base');
    expect(text).toContain('search_qa_library');
    expect(text).toContain('get_intelligence_summary');
    expect(text).toContain('get_change_report');
    expect(text).toContain('get_governance_queue');
  });

  it('interpolates the domain argument into the prompt body', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({
      domain: 'social-housing-compliance',
    });
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('social-housing-compliance');
  });

  it('defaults period_days to 7 when omitted', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('the last 7 days');
    expect(text).toContain('period: "7d"');
    expect(text).toContain('period_days: 7');
  });

  it('honours a non-default period_days argument', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({
      domain: 'audit-content',
      period_days: '14',
    });
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('the last 14 days');
    expect(text).toContain('period: "14d"');
    expect(text).toContain('period_days: 14');
    expect(text).not.toContain('the last 7 days');
  });

  it('specifies the output structure (At a glance / What changed / Sector intelligence / Governance queue / Recommendations)', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';

    expect(text).toContain('### At a glance');
    expect(text).toContain('### What changed');
    expect(text).toContain('### Sector intelligence');
    expect(text).toContain('### Governance queue');
    expect(text).toContain('### Recommendations');
  });

  it('leaves the previously registered prompts intact', () => {
    // Defensive: confirm WP1 did not accidentally replace an earlier prompt.
    expect(server.getPrompt('reorient')).toBeDefined();
    expect(server.getPrompt('bid_briefing')).toBeDefined();
    expect(server.getPrompt('coverage_analysis')).toBeDefined();
    expect(server.getPrompt('draft_response')).toBeDefined();
    expect(server.getPrompt('review_item')).toBeDefined();
  });
});
