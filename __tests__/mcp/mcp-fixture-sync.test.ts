import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_TOOL_NAMES,
  TOOL_COUNT,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  CANONICAL_PROMPT_NAMES,
  PROMPT_COUNT,
  STATIC_RESOURCE_URIS,
  RESOURCE_TEMPLATE_URIS,
} from '../../scripts/mcp-eval/fixtures';

const PROJECT_ROOT = join(__dirname, '../..');
const TOOLS_DIR = join(PROJECT_ROOT, 'lib/mcp/tools');
const RESOURCES_FILE = join(PROJECT_ROOT, 'lib/mcp/resources.ts');

/**
 * Extracts tool names from MCP tool source files. Handles the P0-19 forms
 * (defineTool / defineAppTool wrappers) plus the legacy direct forms so the
 * guard keeps holding even if wrappers are ever bypassed.
 */
function extractToolNamesFromSource(): Set<string> {
  const toolNames = new Set<string>();
  const skipFiles = new Set(['index.ts', 'shared.ts']);

  const files = readdirSync(TOOLS_DIR).filter(
    (f) => f.endsWith('.ts') && !skipFiles.has(f),
  );

  for (const file of files) {
    const content = readFileSync(join(TOOLS_DIR, file), 'utf8');
    // P0-19 canonical: defineTool(server, 'tool_name', ...)
    const defineToolPattern = /defineTool\(\s*\n?\s*server,\s*\n?\s*'([^']+)'/g;
    // P0-19 canonical (apps): defineAppTool(registerAppTool, server, 'tool_name', ...)
    const defineAppToolPattern =
      /defineAppTool\(\s*\n?\s*\w+,\s*\n?\s*server,\s*\n?\s*'([^']+)'/g;
    // Legacy fallback.
    const registerToolPattern = /server\.registerTool\(\s*\n?\s*'([^']+)'/g;
    const registerAppToolPattern =
      /registerAppTool\(\s*\n?\s*server,\s*\n?\s*'([^']+)'/g;

    let match: RegExpExecArray | null;
    while ((match = defineToolPattern.exec(content)) !== null) {
      toolNames.add(match[1]);
    }
    while ((match = defineAppToolPattern.exec(content)) !== null) {
      toolNames.add(match[1]);
    }
    while ((match = registerToolPattern.exec(content)) !== null) {
      toolNames.add(match[1]);
    }
    while ((match = registerAppToolPattern.exec(content)) !== null) {
      toolNames.add(match[1]);
    }
  }

  return toolNames;
}

/**
 * Extracts MCP prompt names from `lib/mcp/resources.ts` by scanning for
 * `server.registerPrompt('name', ...)` calls. Mirrors the tool extraction
 * pattern for bidirectional fixture sync.
 */
function extractPromptNamesFromSource(): Set<string> {
  const promptNames = new Set<string>();
  const content = readFileSync(RESOURCES_FILE, 'utf8');
  const registerPromptPattern = /server\.registerPrompt\(\s*\n?\s*'([^']+)'/g;

  let match: RegExpExecArray | null;
  while ((match = registerPromptPattern.exec(content)) !== null) {
    promptNames.add(match[1]);
  }

  return promptNames;
}

/**
 * Extracts static MCP resource URIs from `lib/mcp/resources.ts` by scanning
 * for `server.registerResource('name', 'uri', ...)` calls AND
 * `registerAppResource(server, 'Title', 'uri', ...)` calls. The URI must be
 * a literal `kb://` or `ui://` string (not a `new ResourceTemplate(...)` —
 * those are matched by the template extractor below).
 */
function extractStaticResourceUrisFromSource(): Set<string> {
  const uris = new Set<string>();
  const content = readFileSync(RESOURCES_FILE, 'utf8');

  // server.registerResource('name', 'kb://...' | 'ui://...', ...)
  const registerResourcePattern =
    /server\.registerResource\(\s*\n?\s*'[^']+',\s*\n?\s*'((?:kb|ui):\/\/[^']+)'/g;
  // registerAppResource(server, 'Title', 'kb://...' | 'ui://...', ...)
  const registerAppResourcePattern =
    /registerAppResource\(\s*\n?\s*server,\s*\n?\s*'[^']+',\s*\n?\s*'((?:kb|ui):\/\/[^']+)'/g;

  let match: RegExpExecArray | null;
  while ((match = registerResourcePattern.exec(content)) !== null) {
    uris.add(match[1]);
  }
  while ((match = registerAppResourcePattern.exec(content)) !== null) {
    uris.add(match[1]);
  }

  return uris;
}

/**
 * Extracts MCP resource template URIs from `lib/mcp/resources.ts` by
 * scanning for `new ResourceTemplate('uri', ...)` calls. Templates contain
 * placeholders like `{id}` in the URI.
 */
function extractResourceTemplateUrisFromSource(): Set<string> {
  const uris = new Set<string>();
  const content = readFileSync(RESOURCES_FILE, 'utf8');
  const templatePattern = /new ResourceTemplate\(\s*\n?\s*'([^']+)'/g;

  let match: RegExpExecArray | null;
  while ((match = templatePattern.exec(content)) !== null) {
    uris.add(match[1]);
  }

  return uris;
}

describe('MCP Fixture Sync', () => {
  const sourceToolNames = extractToolNamesFromSource();
  const fixtureToolNames = new Set(CANONICAL_TOOL_NAMES);

  it('should find tools in source files', () => {
    expect(
      sourceToolNames.size,
      'No tools found in source — regex parsing may be broken',
    ).toBeGreaterThan(0);
  });

  it('every tool in source code should be in CANONICAL_TOOL_NAMES', () => {
    const missingFromFixtures = [...sourceToolNames].filter(
      (name) => !fixtureToolNames.has(name),
    );
    expect(
      missingFromFixtures,
      `Tools in source but missing from fixtures: ${missingFromFixtures.join(', ')}`,
    ).toHaveLength(0);
  });

  it('every tool in CANONICAL_TOOL_NAMES should be in source code', () => {
    const missingFromSource = [...fixtureToolNames].filter(
      (name) => !sourceToolNames.has(name),
    );
    expect(
      missingFromSource,
      `Tools in fixtures but missing from source: ${missingFromSource.join(', ')}`,
    ).toHaveLength(0);
  });

  it('TOOL_COUNT should match the number of canonical tool names', () => {
    expect(TOOL_COUNT).toBe(CANONICAL_TOOL_NAMES.length);
  });

  it('TOOL_COUNT should match the number of tools in source', () => {
    expect(
      TOOL_COUNT,
      `TOOL_COUNT is ${TOOL_COUNT} but source has ${sourceToolNames.size} tools`,
    ).toBe(sourceToolNames.size);
  });

  it('every tool should be in either READ_ONLY_TOOLS or WRITE_TOOLS', () => {
    const uncategorised = CANONICAL_TOOL_NAMES.filter(
      (name) => !READ_ONLY_TOOLS.has(name) && !WRITE_TOOLS.has(name),
    );
    expect(
      uncategorised,
      `Tools not in READ_ONLY_TOOLS or WRITE_TOOLS: ${uncategorised.join(', ')}`,
    ).toHaveLength(0);
  });

  it('no tool should be in both READ_ONLY_TOOLS and WRITE_TOOLS', () => {
    const inBoth = [...READ_ONLY_TOOLS].filter((name) => WRITE_TOOLS.has(name));
    expect(
      inBoth,
      `Tools in both READ_ONLY_TOOLS and WRITE_TOOLS: ${inBoth.join(', ')}`,
    ).toHaveLength(0);
  });
});

describe('MCP Prompts Fixture Sync', () => {
  const sourcePromptNames = extractPromptNamesFromSource();
  const fixturePromptNames = new Set(CANONICAL_PROMPT_NAMES);

  it('should find prompts in source files', () => {
    expect(
      sourcePromptNames.size,
      'No prompts found in lib/mcp/resources.ts — regex parsing may be broken',
    ).toBeGreaterThan(0);
  });

  it('every prompt in source code should be in CANONICAL_PROMPT_NAMES', () => {
    const missingFromFixtures = [...sourcePromptNames].filter(
      (name) => !fixturePromptNames.has(name),
    );
    expect(
      missingFromFixtures,
      `Prompts in source but missing from fixtures: ${missingFromFixtures.join(', ')}`,
    ).toHaveLength(0);
  });

  it('every prompt in CANONICAL_PROMPT_NAMES should be in source code', () => {
    const missingFromSource = [...fixturePromptNames].filter(
      (name) => !sourcePromptNames.has(name),
    );
    expect(
      missingFromSource,
      `Prompts in fixtures but missing from source: ${missingFromSource.join(', ')}`,
    ).toHaveLength(0);
  });

  it('PROMPT_COUNT should match the number of canonical prompt names', () => {
    expect(PROMPT_COUNT).toBe(CANONICAL_PROMPT_NAMES.length);
  });

  it('PROMPT_COUNT should match the number of prompts in source', () => {
    expect(
      PROMPT_COUNT,
      `PROMPT_COUNT is ${PROMPT_COUNT} but source has ${sourcePromptNames.size} prompts`,
    ).toBe(sourcePromptNames.size);
  });
});

describe('MCP Static Resources Fixture Sync', () => {
  const sourceStaticUris = extractStaticResourceUrisFromSource();
  const fixtureStaticUris = new Set(STATIC_RESOURCE_URIS);

  it('should find static resources in source files', () => {
    expect(
      sourceStaticUris.size,
      'No static resources found in lib/mcp/resources.ts — regex parsing may be broken',
    ).toBeGreaterThan(0);
  });

  it('every static resource URI in source code should be in STATIC_RESOURCE_URIS', () => {
    const missingFromFixtures = [...sourceStaticUris].filter(
      (uri) => !fixtureStaticUris.has(uri),
    );
    expect(
      missingFromFixtures,
      `Static resource URIs in source but missing from fixtures: ${missingFromFixtures.join(', ')}`,
    ).toHaveLength(0);
  });

  it('every URI in STATIC_RESOURCE_URIS should be in source code', () => {
    const missingFromSource = [...fixtureStaticUris].filter(
      (uri) => !sourceStaticUris.has(uri),
    );
    expect(
      missingFromSource,
      `Static resource URIs in fixtures but missing from source: ${missingFromSource.join(', ')}`,
    ).toHaveLength(0);
  });

  it('STATIC_RESOURCE_URIS count should match the number of static resources in source', () => {
    expect(
      STATIC_RESOURCE_URIS.length,
      `STATIC_RESOURCE_URIS has ${STATIC_RESOURCE_URIS.length} entries but source has ${sourceStaticUris.size} static resources`,
    ).toBe(sourceStaticUris.size);
  });
});

describe('MCP Resource Templates Fixture Sync', () => {
  const sourceTemplateUris = extractResourceTemplateUrisFromSource();
  const fixtureTemplateUris = new Set(RESOURCE_TEMPLATE_URIS);

  it('should find resource templates in source files', () => {
    expect(
      sourceTemplateUris.size,
      'No resource templates found in lib/mcp/resources.ts — regex parsing may be broken',
    ).toBeGreaterThan(0);
  });

  it('every resource template URI in source code should be in RESOURCE_TEMPLATE_URIS', () => {
    const missingFromFixtures = [...sourceTemplateUris].filter(
      (uri) => !fixtureTemplateUris.has(uri),
    );
    expect(
      missingFromFixtures,
      `Resource template URIs in source but missing from fixtures: ${missingFromFixtures.join(', ')}`,
    ).toHaveLength(0);
  });

  it('every URI in RESOURCE_TEMPLATE_URIS should be in source code', () => {
    const missingFromSource = [...fixtureTemplateUris].filter(
      (uri) => !sourceTemplateUris.has(uri),
    );
    expect(
      missingFromSource,
      `Resource template URIs in fixtures but missing from source: ${missingFromSource.join(', ')}`,
    ).toHaveLength(0);
  });

  it('RESOURCE_TEMPLATE_URIS count should match the number of resource templates in source', () => {
    expect(
      RESOURCE_TEMPLATE_URIS.length,
      `RESOURCE_TEMPLATE_URIS has ${RESOURCE_TEMPLATE_URIS.length} entries but source has ${sourceTemplateUris.size} resource templates`,
    ).toBe(sourceTemplateUris.size);
  });
});

describe('Classification Skill Inlined Content', () => {
  const INLINED_FILE = join(PROJECT_ROOT, 'lib/ai/skills/inlined.generated.ts');

  it('inlined skills bundle should contain Holder Disambiguation rule', () => {
    const content = readFileSync(INLINED_FILE, 'utf8');
    expect(
      content,
      'inlined.generated.ts must contain the Holder Disambiguation rule ported from classification-prompt.md',
    ).toContain('Holder Disambiguation');
  });
});
