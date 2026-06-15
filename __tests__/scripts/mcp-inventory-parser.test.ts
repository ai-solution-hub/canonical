/**
 * Tests for the MCP Inventory Parser.
 *
 * Covers:
 *   1. Standard tool extraction from minimal registerTool call
 *   2. App tool extraction from registerAppTool call
 *   3. No-input-schema tool (empty params)
 *   4. Multi-line description handling
 *   5. Zod schema parsing (string, number, optional, enum, boolean, uuid, min/max)
 *   6. Resource extraction (both patterns)
 *   7. Prompt extraction (with and without argsSchema)
 *   8. Full file extraction against actual search.ts (should find exactly 5 tools)
 *   9. Integration test: run against real source files, verify 58 tools, 12 resources, 7 prompts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import {
  parseToolFile,
  parseResourceFile,
  parsePromptFile,
  parseZodSchema,
} from '../../scripts/lib/mcp-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findProjectRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const ROOT = findProjectRoot();
const TOOLS_DIR = resolve(ROOT, 'lib/mcp/tools');
const RESOURCES_FILE = resolve(ROOT, 'lib/mcp/resources.ts');

// Category order matching the main script
const CATEGORY_ORDER = [
  'search.ts',
  'dashboard.ts',
  'procurement.ts',
  'content.ts',
  'quality.ts',
  'ai.ts',
  'entities.ts',
  'templates.ts',
  'apps.ts',
  'governance.ts',
  'supersession.ts',
  'review.ts',
  'intelligence.ts',
  'guides.ts',
  'change-report.ts',
  'workspaces.ts',
];
const SKIP_FILES = new Set(['index.ts', 'shared.ts']);

// ---------------------------------------------------------------------------
// 1. Standard tool extraction
// ---------------------------------------------------------------------------

describe('Standard tool extraction', () => {
  it('extracts a minimal registerTool call', () => {
    const source = `
      server.registerTool(
        'my_tool',
        {
          title: 'My Tool',
          description: 'Does something useful.',
          inputSchema: {
            query: z.string().describe('Search query'),
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args, extra) => { return { content: [] }; },
      );
    `;

    const tools = parseToolFile(source, 'test.ts');
    expect(tools).toHaveLength(1);

    const tool = tools[0];
    expect(tool.name).toBe('my_tool');
    expect(tool.title).toBe('My Tool');
    expect(tool.description).toBe('Does something useful.');
    expect(tool.category_file).toBe('test.ts');
    expect(tool.is_app_tool).toBe(false);
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.annotations.idempotentHint).toBe(true);
    expect(tool.annotations.openWorldHint).toBe(false);
    expect(tool.input_params).toHaveLength(1);
    expect(tool.input_params[0].name).toBe('query');
    expect(tool.input_params[0].type).toBe('string');
    expect(tool.input_params[0].required).toBe(true);
    expect(tool.input_params[0].description).toBe('Search query');
  });
});

// ---------------------------------------------------------------------------
// 2. App tool extraction
// ---------------------------------------------------------------------------

describe('App tool extraction', () => {
  it('extracts a registerAppTool call', () => {
    const source = `
      registerAppTool(
        server,
        'show_widget',
        {
          title: 'Show Widget',
          description: 'Renders an interactive widget.',
          inputSchema: {
            mode: z.enum(['compact', 'full']).optional().describe('Display mode'),
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
          },
          _meta: { ui: { resourceUri: 'ui://widget/app.html' } },
        },
        async (args, extra) => { return { content: [] }; },
      );
    `;

    const tools = parseToolFile(source, 'apps.ts');
    expect(tools).toHaveLength(1);

    const tool = tools[0];
    expect(tool.name).toBe('show_widget');
    expect(tool.title).toBe('Show Widget');
    expect(tool.is_app_tool).toBe(true);
    expect(tool.annotations.readOnlyHint).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(false);
    expect(tool.input_params).toHaveLength(1);
    expect(tool.input_params[0].name).toBe('mode');
    expect(tool.input_params[0].type).toContain('enum');
    expect(tool.input_params[0].required).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. No-input-schema tool
// ---------------------------------------------------------------------------

describe('No-input-schema tool', () => {
  it('extracts a tool with no inputSchema', () => {
    const source = `
      server.registerTool(
        'get_summary',
        {
          title: 'Get Summary',
          description: 'Returns a summary.',
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (extra) => { return { content: [] }; },
      );
    `;

    const tools = parseToolFile(source, 'test.ts');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('get_summary');
    expect(tools[0].input_params).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-line description handling
// ---------------------------------------------------------------------------

describe('Multi-line description', () => {
  it('handles descriptions that span the full line', () => {
    const source = `
      server.registerTool(
        'complex_tool',
        {
          title: 'Complex Tool',
          description: 'This is a long description that explains what the tool does in detail. It covers many use cases and provides guidance.',
          inputSchema: {
            id: z.string().uuid().describe('The UUID'),
          },
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args, extra) => { return { content: [] }; },
      );
    `;

    const tools = parseToolFile(source, 'test.ts');
    expect(tools).toHaveLength(1);
    expect(tools[0].description).toContain('This is a long description');
    expect(tools[0].description).toContain('provides guidance');
  });
});

// ---------------------------------------------------------------------------
// 5. Zod schema parsing
// ---------------------------------------------------------------------------

describe('Zod schema parsing', () => {
  it('parses string type', () => {
    const params = parseZodSchema("query: z.string().describe('The query')");
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('query');
    expect(params[0].type).toBe('string');
    expect(params[0].required).toBe(true);
    expect(params[0].description).toBe('The query');
  });

  it('parses number with optional', () => {
    const params = parseZodSchema(
      "limit: z.number().optional().describe('Max results')",
    );
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('limit');
    expect(params[0].type).toBe('number');
    expect(params[0].required).toBe(false);
  });

  it('parses enum type', () => {
    const params = parseZodSchema(
      "mode: z.enum(['read', 'write']).optional().describe('Mode')",
    );
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('mode');
    expect(params[0].type).toBe('enum(read|write)');
    expect(params[0].required).toBe(false);
  });

  it('parses boolean type', () => {
    const params = parseZodSchema(
      "force: z.boolean().optional().describe('Force flag')",
    );
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('force');
    expect(params[0].type).toBe('boolean');
    expect(params[0].required).toBe(false);
  });

  it('parses string with uuid', () => {
    const params = parseZodSchema("id: z.string().uuid().describe('The UUID')");
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('id');
    expect(params[0].type).toBe('string (uuid)');
    expect(params[0].required).toBe(true);
  });

  it('parses number with min/max', () => {
    const params = parseZodSchema(
      "score: z.number().min(0).max(100).optional().describe('Score value')",
    );
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('score');
    expect(params[0].type).toBe('number (min:0, max:100)');
    expect(params[0].required).toBe(false);
  });

  it('parses multiple params', () => {
    const params = parseZodSchema(`
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results'),
      domain: z.string().optional().describe('Filter domain'),
    `);
    expect(params).toHaveLength(3);
    expect(params[0].name).toBe('query');
    expect(params[1].name).toBe('limit');
    expect(params[2].name).toBe('domain');
  });

  it('handles multi-line z chains (z on separate line from .method())', () => {
    const params = parseZodSchema(`
      days_ahead: z
        .number()
        .optional()
        .describe('How many days ahead'),
      domain: z
        .string()
        .optional()
        .describe('Filter by domain'),
    `);
    expect(params).toHaveLength(2);
    expect(params[0].name).toBe('days_ahead');
    expect(params[0].type).toBe('number');
    expect(params[0].required).toBe(false);
    expect(params[0].description).toBe('How many days ahead');
    expect(params[1].name).toBe('domain');
    expect(params[1].type).toBe('string');
  });

  it('does not extract nested z.object fields as top-level', () => {
    const params = parseZodSchema(`
      id: z.string().uuid().describe('The UUID'),
      fields: z.object({
        title: z.string().optional().describe('Title'),
        content: z.string().optional().describe('Content'),
      }).describe('Fields to update'),
      reason: z.string().optional().describe('Reason'),
    `);
    expect(params).toHaveLength(3);
    expect(params.map((p) => p.name)).toEqual(['id', 'fields', 'reason']);
    expect(params[1].type).toBe('object');
  });

  it('handles z.array() without treating inner .uuid() as top-level', () => {
    const params = parseZodSchema(
      "ids: z.array(z.string().uuid()).min(1).max(50).describe('Array of UUIDs')",
    );
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('ids');
    expect(params[0].type).toBe('array');
    expect(params[0].required).toBe(true);
    expect(params[0].description).toBe('Array of UUIDs');
  });
});

// ---------------------------------------------------------------------------
// 6. Resource extraction
// ---------------------------------------------------------------------------

describe('Resource extraction', () => {
  it('extracts a template resource (ResourceTemplate)', () => {
    const source = `
      server.registerResource(
        'content_item',
        new ResourceTemplate('kb://items/{id}', { list: async () => ({ resources: [] }) }),
        {
          description: 'A content item',
          mimeType: 'application/json',
        },
        async (uri, variables, extra) => { return { contents: [] }; },
      );
    `;

    const resources = parseResourceFile(source);
    expect(resources).toHaveLength(1);

    const r = resources[0];
    expect(r.internal_name).toBe('content_item');
    expect(r.uri).toBe('kb://items/{id}');
    expect(r.description).toBe('A content item');
    expect(r.mime_type).toBe('application/json');
    expect(r.is_template).toBe(true);
    expect(r.is_app_resource).toBe(false);
  });

  it('extracts a static resource (string URI)', () => {
    const source = `
      server.registerResource(
        'dashboard',
        'kb://dashboard',
        {
          description: 'Current dashboard state',
          mimeType: 'application/json',
        },
        async (uri, extra) => { return { contents: [] }; },
      );
    `;

    const resources = parseResourceFile(source);
    expect(resources).toHaveLength(1);

    const r = resources[0];
    expect(r.internal_name).toBe('dashboard');
    expect(r.uri).toBe('kb://dashboard');
    expect(r.is_template).toBe(false);
    expect(r.is_app_resource).toBe(false);
  });

  it('extracts an app resource (registerAppResource)', () => {
    const source = `
      registerAppResource(
        server,
        'Widget App',
        'ui://widget/app.html',
        { mimeType: RESOURCE_MIME_TYPE },
        async () => { return { contents: [] }; },
      );
    `;

    const resources = parseResourceFile(source);
    expect(resources).toHaveLength(1);

    const r = resources[0];
    expect(r.internal_name).toBe('Widget App');
    expect(r.uri).toBe('ui://widget/app.html');
    expect(r.is_app_resource).toBe(true);
    expect(r.is_template).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Prompt extraction
// ---------------------------------------------------------------------------

describe('Prompt extraction', () => {
  it('extracts a prompt without argsSchema', () => {
    const source = `
      server.registerPrompt(
        'reorient',
        {
          title: 'Reorientation Briefing',
          description: 'Get a briefing on changes.',
        },
        async () => ({ messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }] }),
      );
    `;

    const prompts = parsePromptFile(source);
    expect(prompts).toHaveLength(1);

    const p = prompts[0];
    expect(p.name).toBe('reorient');
    expect(p.title).toBe('Reorientation Briefing');
    expect(p.description).toBe('Get a briefing on changes.');
    expect(p.args).toHaveLength(0);
  });

  it('extracts a prompt with argsSchema', () => {
    const source = `
      server.registerPrompt(
        'bid_briefing',
        {
          title: 'Procurement Briefing',
          description: 'Brief on a specific bid.',
          argsSchema: {
            bid_name: z.string().describe('Name of the bid'),
          },
        },
        async (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: args.bid_name } }] }),
      );
    `;

    const prompts = parsePromptFile(source);
    expect(prompts).toHaveLength(1);

    const p = prompts[0];
    expect(p.name).toBe('bid_briefing');
    expect(p.args).toHaveLength(1);
    expect(p.args[0].name).toBe('bid_name');
    expect(p.args[0].type).toBe('string');
    expect(p.args[0].description).toBe('Name of the bid');
  });
});

// ---------------------------------------------------------------------------
// 8. Full file extraction against actual search.ts
// ---------------------------------------------------------------------------

describe('Full file extraction (search.ts)', () => {
  const searchFile = resolve(TOOLS_DIR, 'search.ts');

  it.skipIf(!existsSync(searchFile))(
    'extracts exactly 5 tools from search.ts',
    () => {
      const source = readFileSync(searchFile, 'utf-8');
      const tools = parseToolFile(source, 'search.ts');

      expect(tools).toHaveLength(5);

      const names = tools.map((t) => t.name);
      expect(names).toContain('search_knowledge_base');
      expect(names).toContain('search_qa_library');
      expect(names).toContain('find_similar_items');
      expect(names).toContain('find_duplicate_candidates');
      expect(names).toContain('search_content_chunks');

      // Verify search_knowledge_base has correct params
      const skb = tools.find((t) => t.name === 'search_knowledge_base')!;
      expect(skb.title).toBe('Search Knowledge Base');
      expect(skb.annotations.readOnlyHint).toBe(true);
      expect(skb.input_params.length).toBeGreaterThanOrEqual(1);
      const queryParam = skb.input_params.find((p) => p.name === 'query');
      expect(queryParam).toBeDefined();
      expect(queryParam!.required).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// 9. Integration test: real source files
// ---------------------------------------------------------------------------

describe('Integration: full codebase extraction', () => {
  const toolFiles = existsSync(TOOLS_DIR)
    ? readdirSync(TOOLS_DIR).filter(
        (f) => f.endsWith('.ts') && !SKIP_FILES.has(f),
      )
    : [];

  it.skipIf(toolFiles.length === 0)(
    'extracts expected number of tools from all category files',
    () => {
      const orderedFiles = CATEGORY_ORDER.filter((f) => toolFiles.includes(f));

      let globalOrder = 1;
      const allTools = [];
      for (const file of orderedFiles) {
        const filePath = resolve(TOOLS_DIR, file);
        const source = readFileSync(filePath, 'utf-8');
        const tools = parseToolFile(source, file);
        for (const tool of tools) {
          tool.registration_order = globalOrder++;
          allTools.push(tool);
        }
      }

      // 56 = 43 pre-S180 + 2 governance additions + 3 review tools +
      // 4 guides (added to CATEGORY_ORDER in WP6 — was a pre-S180 oversight)
      // + 1 change-report + 1 supersession (S186) + 1 bulk_assign_owner (S194)
      // + 1 list_user_workspaces (S194) + 1 update_publication_status (S202 §5.2 T7)
      // + 1 find_duplicate_candidates (S217 W1B — split LLM-discovery vs admin-dedup)
      // − 2 (ID-71.10 M32: get_content_item+get_content_items → `get`,
      //   assign_content_owner+bulk_assign_owner → `assign`).
      expect(allTools.length).toBe(56);

      // Every tool should have a non-empty name
      for (const tool of allTools) {
        expect(tool.name).toBeTruthy();
        expect(tool.name.length).toBeGreaterThan(0);
      }

      // Every tool should have a non-empty title
      for (const tool of allTools) {
        expect(tool.title, `Tool ${tool.name} has empty title`).toBeTruthy();
      }

      // Every tool should have a non-empty description
      for (const tool of allTools) {
        expect(
          tool.description,
          `Tool ${tool.name} has empty description`,
        ).toBeTruthy();
      }

      // No duplicate tool names
      const names = allTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);

      // Tools with inputSchema should have at least one param
      const toolsWithSchema = allTools.filter((t) => t.input_params.length > 0);
      expect(toolsWithSchema.length).toBeGreaterThan(20);

      // Verify app tools
      const appTools = allTools.filter((t) => t.is_app_tool);
      expect(appTools.length).toBe(4);
      expect(appTools.map((t) => t.name).sort()).toEqual([
        'show_coverage_matrix',
        'show_intelligence_feed',
        'show_procurement_dashboard',
        'show_reorient_me',
      ]);
    },
  );

  it.skipIf(!existsSync(RESOURCES_FILE))(
    'extracts expected number of resources',
    () => {
      const source = readFileSync(RESOURCES_FILE, 'utf-8');
      const resources = parseResourceFile(source);

      expect(resources.length).toBe(12);

      // Check template resources
      const templates = resources.filter((r) => r.is_template);
      expect(templates.length).toBe(3);
      expect(templates.map((r) => r.uri).sort()).toEqual([
        'kb://bids/{id}',
        'kb://items/{id}',
        'kb://qa/{id}',
      ]);

      // Check app resources
      const appResources = resources.filter((r) => r.is_app_resource);
      expect(appResources.length).toBe(4);

      // All resources should have URIs
      for (const r of resources) {
        expect(r.uri).toBeTruthy();
      }
    },
  );

  it.skipIf(!existsSync(RESOURCES_FILE))(
    'extracts expected number of prompts',
    () => {
      const source = readFileSync(RESOURCES_FILE, 'utf-8');
      const prompts = parsePromptFile(source);

      expect(prompts.length).toBe(7);

      const names = prompts.map((p) => p.name);
      expect(names).toContain('reorient');
      expect(names).toContain('bid_briefing');
      expect(names).toContain('coverage_analysis');
      expect(names).toContain('draft_response');
      expect(names).toContain('review_item');
      expect(names).toContain('sector_briefing');
      expect(names).toContain('bid_pipeline_review');

      // Prompts with argsSchema should have args
      const withArgs = prompts.filter((p) => p.args.length > 0);
      expect(withArgs.length).toBe(5); // bid_briefing, draft_response, review_item, sector_briefing, bid_pipeline_review

      // Prompts without argsSchema should have empty args
      const reorient = prompts.find((p) => p.name === 'reorient')!;
      expect(reorient.args).toHaveLength(0);
    },
  );
});
