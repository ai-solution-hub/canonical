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
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import {
  parseToolFile,
  parseResourceFile,
  parsePromptFile,
  parseZodSchema,
  missingBornEvaluableArtefacts,
  isBornEvaluable,
  BORN_EVALUABLE_ARTEFACTS,
  type TouchpointChange,
} from '../../scripts/lib/mcp-parser';
import type { AgentEvalContract, TouchpointKind } from '@/lib/eval/contract';

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
        'form_briefing',
        {
          title: 'Procurement Briefing',
          description: 'Brief on a specific form.',
          argsSchema: {
            form_name: z.string().describe('Name of the form'),
          },
        },
        async (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: args.form_name } }] }),
      );
    `;

    const prompts = parsePromptFile(source);
    expect(prompts).toHaveLength(1);

    const p = prompts[0];
    expect(p.name).toBe('form_briefing');
    expect(p.args).toHaveLength(1);
    expect(p.args[0].name).toBe('form_name');
    expect(p.args[0].type).toBe('string');
    expect(p.args[0].description).toBe('Name of the form');
  });
});

// ---------------------------------------------------------------------------
// 8. Full file extraction against actual search.ts
// ---------------------------------------------------------------------------

describe('Full file extraction (search.ts)', () => {
  const searchFile = resolve(TOOLS_DIR, 'search.ts');

  it.skipIf(!existsSync(searchFile))(
    'extracts exactly 2 tools from search.ts (ID-71.7 + ID-71.10 consolidations)',
    () => {
      const source = readFileSync(searchFile, 'utf-8');
      const tools = parseToolFile(source, 'search.ts');

      // ID-71.7 (M27/B-INV-27) collapsed the former search trio
      // (search_knowledge_base / search_qa_library / search_content_chunks) +
      // find_similar_items into ONE `find` entry. ID-71.10 part 2 (M32/B-INV-32
      // dedup) collapsed the dedup pair (find_duplicate_candidates +
      // find_all_duplicates) into ONE parameterised `find_duplicates` entry,
      // co-located here with `findSimilarItemsImpl`.
      expect(tools).toHaveLength(2);

      const names = tools.map((t) => t.name);
      expect(names).toContain('find');
      expect(names).toContain('find_duplicates');

      // Verify `find` carries the consolidated params.
      const find = tools.find((t) => t.name === 'find')!;
      expect(find.annotations.readOnlyHint).toBe(true);
      const paramNames = find.input_params.map((p) => p.name);
      expect(paramNames).toEqual(
        expect.arrayContaining([
          'query',
          'type',
          'scope',
          'granularity',
          'similar_to',
        ]),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// 10. ID-71 M38 — born-evaluable forcing-function detector (B-INV-38/13/40)
// ---------------------------------------------------------------------------

describe('M38 born-evaluable forcing-function detector', () => {
  // A structurally complete, valid ID-104 contract (all seven mandatory
  // fields). The bound-contract leg validates this against the canonical
  // agentEvalContractSchema, so a real contract — not a stub — is required.
  const VALID_CONTRACT: AgentEvalContract = {
    touchpoint_id: 'find',
    kind: 'tool',
    owner: 'platform',
    suite_name: 'l3',
    grounding_shape: 'forced_tool_strict',
    severity_on_fail: 'block',
    variance_band: 0.02,
  };

  /** A born-evaluable change for `kind` — all three forcing artefacts present. */
  function compliantChange(kind: TouchpointKind): TouchpointChange {
    return {
      kind,
      skillInvoked: true,
      evalOrFixtureUpdated: true,
      boundContract: { ...VALID_CONTRACT, kind },
    };
  }

  // The forcing function widens beyond the MCP fixture-sync precedent (tools
  // only) to prompts, plugin skills, and inline AI touchpoints (B-INV-38).
  const KINDS: TouchpointKind[] = ['tool', 'prompt', 'skill', 'inline'];

  it.each(KINDS)(
    'PASSES a %s change carrying skill + eval/fixture + bound contract',
    (kind) => {
      const change = compliantChange(kind);
      expect(missingBornEvaluableArtefacts(change)).toEqual([]);
      expect(isBornEvaluable(change)).toBe(true);
    },
  );

  it.each(KINDS)(
    'FAILS a %s change lacking a create-skill/update-skill invocation',
    (kind) => {
      const change: TouchpointChange = {
        ...compliantChange(kind),
        skillInvoked: false,
      };
      expect(missingBornEvaluableArtefacts(change)).toEqual([
        'skill-invocation',
      ]);
      expect(isBornEvaluable(change)).toBe(false);
    },
  );

  it.each(KINDS)('FAILS a %s change lacking an eval/fixture update', (kind) => {
    const change: TouchpointChange = {
      ...compliantChange(kind),
      evalOrFixtureUpdated: false,
    };
    expect(missingBornEvaluableArtefacts(change)).toEqual([
      'eval-fixture-update',
    ]);
    expect(isBornEvaluable(change)).toBe(false);
  });

  it.each(KINDS)(
    'FAILS a %s change lacking a bound AgentEvalContract',
    (kind) => {
      const change: TouchpointChange = {
        ...compliantChange(kind),
        boundContract: null,
      };
      expect(missingBornEvaluableArtefacts(change)).toEqual(['bound-contract']);
      expect(isBornEvaluable(change)).toBe(false);
    },
  );

  it('reports ALL three missing artefacts for a bare touchpoint change', () => {
    const change: TouchpointChange = {
      kind: 'tool',
      skillInvoked: false,
      evalOrFixtureUpdated: false,
      boundContract: null,
    };
    expect(missingBornEvaluableArtefacts(change)).toEqual([
      ...BORN_EVALUABLE_ARTEFACTS,
    ]);
    expect(isBornEvaluable(change)).toBe(false);
  });

  it('treats a malformed/placeholder contract as UNbound (consumes ID-104 schema at the boundary)', () => {
    // A schedule-slip placeholder missing a mandatory field must NOT satisfy
    // the bound-contract leg — schema enforcement is the gate (B-INV-40), so an
    // invalid contract counts as no contract at all.
    const placeholder = {
      touchpoint_id: 'find',
      kind: 'tool',
      // owner, suite_name, grounding_shape, severity_on_fail, variance_band absent
    } as unknown as AgentEvalContract;
    const change: TouchpointChange = {
      kind: 'tool',
      skillInvoked: true,
      evalOrFixtureUpdated: true,
      boundContract: placeholder,
    };
    expect(missingBornEvaluableArtefacts(change)).toEqual(['bound-contract']);
  });

  it('preserves canonical artefact order in the missing list', () => {
    const change: TouchpointChange = {
      kind: 'inline',
      skillInvoked: false,
      evalOrFixtureUpdated: true,
      boundContract: null,
    };
    expect(missingBornEvaluableArtefacts(change)).toEqual([
      'skill-invocation',
      'bound-contract',
    ]);
  });
});
