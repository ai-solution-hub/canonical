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
import type { z } from 'zod';
import { registerPrompts } from '@/lib/mcp/resources';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

describe('MCP sector_briefing prompt', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    server = createMockMcpServer();
    registerPrompts(server.server as never);
  });

  it('registers a sector_briefing prompt', () => {
    const prompt = server.getPrompt('sector_briefing');
    expect(prompt).toBeDefined();
    expect(prompt!.config.title).toBe('Sector Briefing');
  });

  it('declares domain (required) + period_days (optional) args', () => {
    const prompt = server.getPrompt('sector_briefing');
    const argsSchema = prompt!.config.argsSchema as Record<
      string,
      z.ZodTypeAny
    >;
    expect(argsSchema).toBeDefined();
    expect(argsSchema.domain).toBeDefined();
    expect(argsSchema.period_days).toBeDefined();
    // Enforce optionality semantics so a future `.optional()` change on
    // `domain` (or removal of `.optional()` from `period_days`) is caught.
    expect(argsSchema.domain.isOptional()).toBe(false);
    expect(argsSchema.period_days.isOptional()).toBe(true);
  });

  it('includes the KB system context prelude', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';
    expect(text).toContain('Knowledge Hub');
    expect(text).toContain('UK English');
  });

  it('orchestrates over the consolidated tool set (ID-71.11 thin-orchestrator)', async () => {
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';

    // The briefing composes against the consolidated Wave-1 surface: kept
    // entries by name, the search trio collapsed into `find`, and the
    // governance queue collapsed into `whats_in_my_queue` (governance facet).
    expect(text).toContain('list_guides');
    expect(text).toContain('find(');
    expect(text).toContain('get_intelligence_summary');
    expect(text).toContain('get_change_report');
    expect(text).toContain('whats_in_my_queue');
    // Retired read names must not survive in the orchestration text.
    expect(text).not.toContain('search_knowledge_base');
    expect(text).not.toContain('search_qa_library');
    expect(text).not.toContain('get_governance_queue');
  });

  it('reuses the consolidated find entry for both items and Q&A', async () => {
    // The search trio (search_knowledge_base / search_qa_library /
    // search_content_chunks) collapsed into one `find` entry — the briefing
    // must reach Q&A via find(type: 'q_a_pair'), not a separate Q&A tool.
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';

    expect(text).toContain('type: "q_a_pair"');
  });

  it('instructs graceful fallback when a later-shipping tool is unavailable', async () => {
    // get_change_report (WP6 / P1-35) ships later in the same release train;
    // if missing at invocation time the prompt must instruct Claude to skip
    // that step and continue with the remaining data sources.
    const prompt = server.getPrompt('sector_briefing');
    const result = await prompt!.handler({ domain: 'audit-content' });
    const text = result.messages[0]?.content.text ?? '';

    expect(text).toContain('Change report tool not yet available');
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
