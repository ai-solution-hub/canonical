import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_TOOL_NAMES,
  TOOL_COUNT,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
} from '../../scripts/mcp-eval/fixtures';

const PROJECT_ROOT = join(__dirname, '../..');
const TOOLS_DIR = join(PROJECT_ROOT, 'lib/mcp/tools');

/**
 * Extracts tool names from MCP tool source files by scanning for
 * registerTool('name', ...) and registerAppTool(server, 'name', ...)
 * patterns.
 */
function extractToolNamesFromSource(): Set<string> {
  const toolNames = new Set<string>();
  const skipFiles = new Set(['index.ts', 'shared.ts']);

  const files = readdirSync(TOOLS_DIR).filter(
    (f) => f.endsWith('.ts') && !skipFiles.has(f),
  );

  for (const file of files) {
    const content = readFileSync(join(TOOLS_DIR, file), 'utf8');
    // Match registerTool(\n    'tool_name', or registerAppTool(\n    server,\n    'tool_name',
    const registerToolPattern = /registerTool\(\s*\n?\s*'([^']+)'/g;
    const registerAppToolPattern = /registerAppTool\(\s*\n?\s*server,\s*\n?\s*'([^']+)'/g;

    let match: RegExpExecArray | null;
    while ((match = registerToolPattern.exec(content)) !== null) {
      toolNames.add(match[1]);
    }
    while ((match = registerAppToolPattern.exec(content)) !== null) {
      toolNames.add(match[1]);
    }
  }

  return toolNames;
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
    const inBoth = [...READ_ONLY_TOOLS].filter((name) =>
      WRITE_TOOLS.has(name),
    );
    expect(
      inBoth,
      `Tools in both READ_ONLY_TOOLS and WRITE_TOOLS: ${inBoth.join(', ')}`,
    ).toHaveLength(0);
  });
});
