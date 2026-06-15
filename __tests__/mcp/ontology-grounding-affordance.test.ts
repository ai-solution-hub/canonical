/**
 * ID-71.11 (M28/M34, B-INV-28/34) — ontology-grounding affordance + prompts as
 * thin orchestrators.
 *
 * B-INV-28: ontology-grounded answering (O1 W1.3) is a first-class affordance —
 * `get_entity_relationships` + `kb://entities` are deliberately presented as a
 * grounding affordance of the *answering* outcome (alongside `find`), not
 * mis-grouped under content management.
 *
 * B-INV-34: prompts are thin orchestrators over the consolidated tool surface —
 * they must reference the surviving consolidated entries (`find`,
 * `where_are_we_exposed`, `whats_in_my_queue`, `get`) and must NOT instruct
 * callers to use any retired tool name.
 *
 * These tests assert observable surface behaviour (the discoverable descriptions
 * and the rendered prompt text an LLM client receives), not implementation
 * detail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registerPrompts } from '@/lib/mcp/resources';
import { registerEntityTools } from '@/lib/mcp/tools/entities';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';

// Retired read tools collapsed by the ID-71 Wave-1 consolidation. No prompt
// should instruct a caller to use any of these names.
const RETIRED_TOOL_NAMES = [
  'search_knowledge_base',
  'search_qa_library',
  'search_content_chunks',
  'find_similar_items',
  'get_content_item',
  'get_content_items',
  'get_coverage_gaps',
  'get_quality_summary',
  'get_freshness_report',
  'get_expiring_content',
  'audit_content',
  'get_quality_actions',
  'get_certification_status',
  'get_governance_queue',
  'get_review_queue',
  'get_assignments_for_user',
  'get_dashboard_summary',
  'find_duplicate_candidates',
  'find_all_duplicates',
  'assign_content_owner',
  'bulk_assign_owner',
];

describe('ID-71.11 ontology-grounding affordance (B-INV-28)', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    server = createMockMcpServer();
    await registerEntityTools(server.server);
  });

  it('exposes get_entity_relationships as an answering/grounding affordance', () => {
    const tool = server.getTool('get_entity_relationships');
    expect(tool).toBeDefined();
    const description = String(tool!.config.description);
    // The description must frame the tool as a grounding affordance of the
    // answering outcome — discoverable alongside `find`, not curation-only.
    expect(description).toContain('find');
    expect(description.toLowerCase()).toContain('ground');
  });
});

describe('ID-71.11 kb://entities answering cross-reference (B-INV-28)', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    server = createMockMcpServer();
    const { registerResources } = await import('@/lib/mcp/resources');
    await registerResources(server.server);
  });

  it('points kb://entities at the answering surface (find + get_entity_relationships)', () => {
    const resource = server.resources['entities'];
    expect(resource).toBeDefined();
    const description = String(
      (resource!.metadata as { description?: string }).description ?? '',
    );
    // The entity overview resource is a grounding entry on the answering
    // surface — its description cross-references find and the relationships tool.
    expect(description).toContain('find');
    expect(description).toContain('get_entity_relationships');
  });
});

describe('ID-71.11 prompts as thin orchestrators (B-INV-34)', () => {
  let server: ReturnType<typeof createMockMcpServer>;

  beforeEach(() => {
    server = createMockMcpServer();
    registerPrompts(server.server as never);
  });

  async function renderPrompt(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<string> {
    const prompt = server.getPrompt(name);
    expect(prompt, `prompt ${name} should be registered`).toBeDefined();
    const result = await prompt!.handler(args);
    return result.messages.map((m) => m.content.text).join('\n');
  }

  it('coverage_analysis orchestrates over where_are_we_exposed (no retired reads)', async () => {
    const text = await renderPrompt('coverage_analysis');
    expect(text).toContain('where_are_we_exposed');
    expect(text).toContain('suggest_content_creation');
    expect(text).not.toContain('get_coverage_gaps');
    expect(text).not.toContain('get_quality_summary');
    expect(text).not.toContain('get_freshness_report');
  });

  it('draft_response orchestrates over find (no retired search reads)', async () => {
    const text = await renderPrompt('draft_response', {
      question_text: 'Describe your information security posture.',
    });
    expect(text).toContain('find');
    expect(text).not.toContain('search_knowledge_base');
    expect(text).not.toContain('search_qa_library');
  });

  it('review_item orchestrates over get (no retired get_content_item)', async () => {
    const text = await renderPrompt('review_item', {
      item_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(text).toContain('`get`');
    expect(text).not.toContain('get_content_item');
  });

  it('sector_briefing orchestrates over find + whats_in_my_queue (no retired reads)', async () => {
    const text = await renderPrompt('sector_briefing', {
      domain: 'audit-content',
    });
    expect(text).toContain('find');
    expect(text).toContain('whats_in_my_queue');
    expect(text).not.toContain('search_knowledge_base');
    expect(text).not.toContain('search_qa_library');
    expect(text).not.toContain('get_governance_queue');
  });

  it('no registered prompt instructs a caller to use a retired tool name', async () => {
    const promptArgs: Record<string, Record<string, unknown>> = {
      form_briefing: { form_name: 'Acme Council Framework' },
      draft_response: { question_text: 'Question?' },
      review_item: { item_id: '22222222-2222-4222-8222-222222222222' },
      sector_briefing: { domain: 'audit-content' },
      form_pipeline_review: {},
    };
    for (const reg of server.promptList) {
      const text = await renderPrompt(reg.name, promptArgs[reg.name] ?? {});
      for (const retired of RETIRED_TOOL_NAMES) {
        expect(
          text.includes(retired),
          `prompt ${reg.name} must not reference retired tool ${retired}`,
        ).toBe(false);
      }
    }
  });
});
