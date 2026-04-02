#!/usr/bin/env bun
/**
 * MCP Inventory Generator
 *
 * Reads MCP tool/resource/prompt registrations from source files and produces
 * a canonical inventory in JSON and Markdown formats.
 *
 * Usage:
 *   bun run scripts/generate-mcp-inventory.ts               # Generate JSON + Markdown
 *   bun run scripts/generate-mcp-inventory.ts --validate-fixtures  # Compare against eval fixtures
 *   bun run scripts/generate-mcp-inventory.ts --update-index-header  # Rewrite index.ts header
 *   bun run scripts/generate-mcp-inventory.ts --json --stdout   # JSON only to stdout
 *   bun run scripts/generate-mcp-inventory.ts --dry-run         # Show what would be generated
 *
 * Exit codes:
 *   0 — Success
 *   1 — Validation failed (discrepancies found)
 *   2 — Parse error
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from 'fs';
import { resolve, dirname } from 'path';
import {
  parseToolFile,
  parseResourceFile,
  parsePromptFile,
  type ToolEntry,
  type ResourceEntry,
  type PromptEntry,
} from './lib/mcp-parser';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function findProjectRoot(): string {
  // Walk up from script location and CWD looking for package.json
  const candidates: string[] = [];
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    candidates.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const root of candidates) {
    if (existsSync(resolve(root, 'package.json'))) {
      return root;
    }
  }
  return process.cwd();
}

const ROOT = findProjectRoot();
const TOOLS_DIR = resolve(ROOT, 'lib/mcp/tools');
const RESOURCES_FILE = resolve(ROOT, 'lib/mcp/resources.ts');
const INDEX_FILE = resolve(ROOT, 'lib/mcp/tools/index.ts');
const OUTPUT_DIR = resolve(ROOT, 'docs/generated');
const FIXTURES_FILE = resolve(ROOT, 'scripts/mcp-eval/fixtures.ts');

// Files to skip when scanning tool directory
const SKIP_FILES = new Set(['index.ts', 'shared.ts']);

// Registration order from index.ts — determines global tool numbering
const CATEGORY_ORDER = [
  'search.ts',
  'dashboard.ts',
  'bids.ts',
  'content.ts',
  'quality.ts',
  'ai.ts',
  'entities.ts',
  'templates.ts',
  'apps.ts',
  'governance.ts',
];

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CLIOptions {
  validateFixtures: boolean;
  updateIndexHeader: boolean;
  jsonOnly: boolean;
  stdout: boolean;
  dryRun: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  return {
    validateFixtures: args.includes('--validate-fixtures'),
    updateIndexHeader: args.includes('--update-index-header'),
    jsonOnly: args.includes('--json'),
    stdout: args.includes('--stdout'),
    dryRun: args.includes('--dry-run'),
  };
}

// ---------------------------------------------------------------------------
// Inventory types
// ---------------------------------------------------------------------------

interface InventoryJSON {
  generated_at: string;
  tools: ToolEntry[];
  resources: ResourceEntry[];
  prompts: PromptEntry[];
  summary: {
    tool_count: number;
    resource_count: number;
    prompt_count: number;
    category_files: number;
    read_only_tools: number;
    write_tools: number;
    destructive_tools: number;
    app_tools: number;
    app_resources: number;
    template_resources: number;
  };
}

// ---------------------------------------------------------------------------
// Source file reading and parsing
// ---------------------------------------------------------------------------

function readToolFiles(): ToolEntry[] {
  const allTools: ToolEntry[] = [];
  const files = readdirSync(TOOLS_DIR).filter(
    (f) => f.endsWith('.ts') && !SKIP_FILES.has(f),
  );

  // Sort by the canonical category order
  const orderedFiles = CATEGORY_ORDER.filter((f) => files.includes(f));
  // Append any files not in the order (shouldn't happen, but be safe)
  for (const f of files) {
    if (!orderedFiles.includes(f)) orderedFiles.push(f);
  }

  let globalOrder = 1;
  for (const file of orderedFiles) {
    const filePath = resolve(TOOLS_DIR, file);
    const source = readFileSync(filePath, 'utf-8');
    const tools = parseToolFile(source, file);
    for (const tool of tools) {
      tool.registration_order = globalOrder++;
      allTools.push(tool);
    }
  }

  return allTools;
}

function readResources(): ResourceEntry[] {
  if (!existsSync(RESOURCES_FILE)) {
    console.error(`Resources file not found: ${RESOURCES_FILE}`);
    process.exit(2);
  }
  const source = readFileSync(RESOURCES_FILE, 'utf-8');
  return parseResourceFile(source);
}

function readPrompts(): PromptEntry[] {
  if (!existsSync(RESOURCES_FILE)) {
    console.error(`Resources file not found: ${RESOURCES_FILE}`);
    process.exit(2);
  }
  const source = readFileSync(RESOURCES_FILE, 'utf-8');
  return parsePromptFile(source);
}

// ---------------------------------------------------------------------------
// Inventory building
// ---------------------------------------------------------------------------

function buildInventory(): InventoryJSON {
  const tools = readToolFiles();
  const resources = readResources();
  const prompts = readPrompts();

  const categoryFiles = new Set(tools.map((t) => t.category_file));
  const readOnlyTools = tools.filter(
    (t) => t.annotations.readOnlyHint === true,
  );
  const writeTools = tools.filter((t) => t.annotations.readOnlyHint !== true);
  const destructiveTools = tools.filter(
    (t) => t.annotations.destructiveHint === true,
  );
  const appTools = tools.filter((t) => t.is_app_tool);
  const appResources = resources.filter((r) => r.is_app_resource);
  const templateResources = resources.filter((r) => r.is_template);

  return {
    generated_at: new Date().toISOString(),
    tools,
    resources,
    prompts,
    summary: {
      tool_count: tools.length,
      resource_count: resources.length,
      prompt_count: prompts.length,
      category_files: categoryFiles.size,
      read_only_tools: readOnlyTools.length,
      write_tools: writeTools.length,
      destructive_tools: destructiveTools.length,
      app_tools: appTools.length,
      app_resources: appResources.length,
      template_resources: templateResources.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Output generation
// ---------------------------------------------------------------------------

function generateMarkdown(inventory: InventoryJSON): string {
  const lines: string[] = [];

  lines.push(
    '<!-- AUTO-GENERATED by scripts/generate-mcp-inventory.ts -- do not edit manually -->',
  );
  lines.push('');
  lines.push('# MCP Inventory');
  lines.push('');
  lines.push(`Generated: ${inventory.generated_at}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `- **Tools:** ${inventory.summary.tool_count} (${inventory.summary.read_only_tools} read-only, ${inventory.summary.write_tools} write, ${inventory.summary.destructive_tools} destructive)`,
  );
  lines.push(
    `- **Resources:** ${inventory.summary.resource_count} (${inventory.summary.template_resources} templates, ${inventory.summary.app_resources} app resources)`,
  );
  lines.push(`- **Prompts:** ${inventory.summary.prompt_count}`);
  lines.push(`- **Category files:** ${inventory.summary.category_files}`);
  lines.push('');

  // Tools table
  lines.push('## Tools');
  lines.push('');
  lines.push(
    '| # | Name | Title | Category | Params | Read-only | Destructive |',
  );
  lines.push(
    '|---|------|-------|----------|--------|-----------|-------------|',
  );

  for (const tool of inventory.tools) {
    const paramStr =
      tool.input_params.length === 0
        ? '(none)'
        : tool.input_params
            .map((p) => (p.required ? p.name : `${p.name}?`))
            .join(', ');
    const readOnly = tool.annotations.readOnlyHint ? 'Yes' : 'No';
    const destructive = tool.annotations.destructiveHint ? 'Yes' : 'No';

    lines.push(
      `| ${tool.registration_order} | \`${tool.name}\` | ${tool.title} | ${tool.category_file.replace('.ts', '')} | ${paramStr} | ${readOnly} | ${destructive} |`,
    );
  }

  lines.push('');

  // Resources table
  lines.push('## Resources');
  lines.push('');
  lines.push('| # | URI | Description | Type | MIME |');
  lines.push('|---|-----|-------------|------|------|');

  for (let i = 0; i < inventory.resources.length; i++) {
    const r = inventory.resources[i];
    const resourceType = r.is_app_resource
      ? 'App'
      : r.is_template
        ? 'Template'
        : 'Static';
    lines.push(
      `| ${i + 1} | \`${r.uri}\` | ${r.description} | ${resourceType} | ${r.mime_type} |`,
    );
  }

  lines.push('');

  // Prompts table
  lines.push('## Prompts');
  lines.push('');
  lines.push('| # | Name | Title | Args |');
  lines.push('|---|------|-------|------|');

  for (let i = 0; i < inventory.prompts.length; i++) {
    const p = inventory.prompts[i];
    const argsStr =
      p.args.length === 0 ? '(none)' : p.args.map((a) => a.name).join(', ');
    lines.push(`| ${i + 1} | \`${p.name}\` | ${p.title} | ${argsStr} |`);
  }

  lines.push('');

  return lines.join('\n');
}

function generateJSON(inventory: InventoryJSON): string {
  return JSON.stringify(inventory, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// Fixture validation
// ---------------------------------------------------------------------------

interface ValidationResult {
  passed: boolean;
  issues: string[];
}

function validateFixtures(inventory: InventoryJSON): ValidationResult {
  const issues: string[] = [];

  if (!existsSync(FIXTURES_FILE)) {
    issues.push(`Fixtures file not found: ${FIXTURES_FILE}`);
    return { passed: false, issues };
  }

  const fixturesSource = readFileSync(FIXTURES_FILE, 'utf-8');

  // Extract CANONICAL_TOOL_NAMES array
  const toolNamesMatch = fixturesSource.match(
    /CANONICAL_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/,
  );
  const fixtureToolNames: string[] = [];
  if (toolNamesMatch) {
    const content = toolNamesMatch[1];
    const nameRegex = /['"](\w+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(content)) !== null) {
      fixtureToolNames.push(m[1]);
    }
  }

  const inventoryToolNames = new Set(inventory.tools.map((t) => t.name));
  const fixtureToolSet = new Set(fixtureToolNames);

  // Tools in code but missing from fixtures
  for (const name of inventoryToolNames) {
    if (!fixtureToolSet.has(name)) {
      issues.push(
        `Tool in code but missing from CANONICAL_TOOL_NAMES: ${name}`,
      );
    }
  }

  // Tools in fixtures but not in code
  for (const name of fixtureToolNames) {
    if (!inventoryToolNames.has(name)) {
      issues.push(
        `Tool in CANONICAL_TOOL_NAMES but not found in code: ${name}`,
      );
    }
  }

  // Extract READ_ONLY_TOOLS set
  const readOnlyMatch = fixturesSource.match(
    /READ_ONLY_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/,
  );
  const fixtureReadOnly = new Set<string>();
  if (readOnlyMatch) {
    const nameRegex = /['"](\w+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(readOnlyMatch[1])) !== null) {
      fixtureReadOnly.add(m[1]);
    }
  }

  // Extract WRITE_TOOLS set
  const writeMatch = fixturesSource.match(
    /WRITE_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/,
  );
  const fixtureWrite = new Set<string>();
  if (writeMatch) {
    const nameRegex = /['"](\w+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(writeMatch[1])) !== null) {
      fixtureWrite.add(m[1]);
    }
  }

  // Check read/write classification
  for (const tool of inventory.tools) {
    const isReadOnly = tool.annotations.readOnlyHint === true;
    if (isReadOnly && fixtureWrite.has(tool.name)) {
      issues.push(
        `Tool ${tool.name} is read-only in code but in WRITE_TOOLS fixture`,
      );
    }
    if (
      !isReadOnly &&
      fixtureWrite.size > 0 &&
      fixtureReadOnly.has(tool.name)
    ) {
      issues.push(
        `Tool ${tool.name} is write in code but in READ_ONLY_TOOLS fixture`,
      );
    }
  }

  // Extract resource URIs
  const staticMatch = fixturesSource.match(
    /STATIC_RESOURCE_URIS\s*=\s*\[([\s\S]*?)\]\s*as\s*const/,
  );
  const fixtureStaticUris = new Set<string>();
  if (staticMatch) {
    const uriRegex = /['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = uriRegex.exec(staticMatch[1])) !== null) {
      fixtureStaticUris.add(m[1]);
    }
  }

  const templateMatch = fixturesSource.match(
    /RESOURCE_TEMPLATE_URIS\s*=\s*\[([\s\S]*?)\]\s*as\s*const/,
  );
  const fixtureTemplateUris = new Set<string>();
  if (templateMatch) {
    const uriRegex = /['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = uriRegex.exec(templateMatch[1])) !== null) {
      fixtureTemplateUris.add(m[1]);
    }
  }

  // Check resources
  for (const resource of inventory.resources) {
    if (resource.is_template) {
      if (!fixtureTemplateUris.has(resource.uri)) {
        issues.push(
          `Template resource in code but missing from RESOURCE_TEMPLATE_URIS: ${resource.uri}`,
        );
      }
    } else {
      if (!fixtureStaticUris.has(resource.uri)) {
        issues.push(
          `Static resource in code but missing from STATIC_RESOURCE_URIS: ${resource.uri}`,
        );
      }
    }
  }

  // Check for fixture URIs not in code
  const codeStaticUris = new Set(
    inventory.resources.filter((r) => !r.is_template).map((r) => r.uri),
  );
  const codeTemplateUris = new Set(
    inventory.resources.filter((r) => r.is_template).map((r) => r.uri),
  );

  for (const uri of fixtureStaticUris) {
    if (!codeStaticUris.has(uri)) {
      issues.push(`URI in STATIC_RESOURCE_URIS but not found in code: ${uri}`);
    }
  }
  for (const uri of fixtureTemplateUris) {
    if (!codeTemplateUris.has(uri)) {
      issues.push(
        `URI in RESOURCE_TEMPLATE_URIS but not found in code: ${uri}`,
      );
    }
  }

  // Extract prompt names
  const promptMatch = fixturesSource.match(
    /CANONICAL_PROMPT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as\s*const/,
  );
  const fixturePromptNames = new Set<string>();
  if (promptMatch) {
    const nameRegex = /['"](\w+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(promptMatch[1])) !== null) {
      fixturePromptNames.add(m[1]);
    }
  }

  const codePromptNames = new Set(inventory.prompts.map((p) => p.name));
  for (const name of codePromptNames) {
    if (!fixturePromptNames.has(name)) {
      issues.push(
        `Prompt in code but missing from CANONICAL_PROMPT_NAMES: ${name}`,
      );
    }
  }
  for (const name of fixturePromptNames) {
    if (!codePromptNames.has(name)) {
      issues.push(
        `Prompt in CANONICAL_PROMPT_NAMES but not found in code: ${name}`,
      );
    }
  }

  return { passed: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Index header update
// ---------------------------------------------------------------------------

function generateIndexHeader(inventory: InventoryJSON): string {
  const lines: string[] = [];
  lines.push('/**');
  lines.push(' * MCP tool registrations for the Knowledge Hub server.');
  lines.push(' *');
  lines.push(
    ` * Registers ${inventory.summary.tool_count} tools across ${inventory.summary.category_files} category files:`,
  );

  // Group tools by category
  const byCategory = new Map<string, ToolEntry[]>();
  for (const tool of inventory.tools) {
    const existing = byCategory.get(tool.category_file) ?? [];
    existing.push(tool);
    byCategory.set(tool.category_file, existing);
  }

  for (const file of CATEGORY_ORDER) {
    const tools = byCategory.get(file);
    if (!tools || tools.length === 0) continue;
    const toolNames = tools.map((t) => t.name).join(', ');
    lines.push(` *   - ${file.padEnd(14)} (${tools.length}): ${toolNames}`);
  }

  lines.push(' *');
  lines.push(
    ' * All tools use per-user Supabase clients via extra.authInfo so that',
  );
  lines.push(' * RLS policies are applied based on the authenticated user.');
  lines.push(' *');
  lines.push(
    ' * Tool naming: names intentionally omit a service prefix (e.g. kb_). The',
  );
  lines.push(
    ' * Knowledge Hub MCP server is designed as a single-purpose connector --',
  );
  lines.push(
    " * users won't have multiple KB servers. Adding prefixes would make names",
  );
  lines.push(
    ' * unnecessarily verbose for Claude. Revisit if multi-server scenarios arise.',
  );
  lines.push(' */');

  return lines.join('\n');
}

function updateIndexHeader(inventory: InventoryJSON): boolean {
  if (!existsSync(INDEX_FILE)) {
    console.error(`Index file not found: ${INDEX_FILE}`);
    return false;
  }

  const source = readFileSync(INDEX_FILE, 'utf-8');
  const newHeader = generateIndexHeader(inventory);

  // Replace the existing header comment (everything from /** to */)
  const headerEndIdx = source.indexOf('*/');
  if (headerEndIdx === -1) {
    console.error('Could not find header comment end in index.ts');
    return false;
  }

  const newSource = newHeader + source.slice(headerEndIdx + 2);
  writeFileSync(INDEX_FILE, newSource, 'utf-8');
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const options = parseArgs();

  // Build inventory
  let inventory: InventoryJSON;
  try {
    inventory = buildInventory();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Parse error: ${message}`);
    process.exit(2);
  }

  // Validation checks
  const duplicateNames = inventory.tools
    .map((t) => t.name)
    .filter((name, i, arr) => arr.indexOf(name) !== i);
  if (duplicateNames.length > 0) {
    console.error(`Duplicate tool names found: ${duplicateNames.join(', ')}`);
    process.exit(2);
  }

  const emptyTitles = inventory.tools.filter((t) => !t.title);
  if (emptyTitles.length > 0) {
    console.warn(
      `Warning: ${emptyTitles.length} tools have empty titles: ${emptyTitles.map((t) => t.name).join(', ')}`,
    );
  }

  // Handle --validate-fixtures
  if (options.validateFixtures) {
    const result = validateFixtures(inventory);
    if (result.passed) {
      console.log('Fixture validation passed. All fixtures match code.');
      console.log(`  Tools: ${inventory.summary.tool_count}`);
      console.log(`  Resources: ${inventory.summary.resource_count}`);
      console.log(`  Prompts: ${inventory.summary.prompt_count}`);
    } else {
      console.error('Fixture validation FAILED:');
      for (const issue of result.issues) {
        console.error(`  - ${issue}`);
      }
    }
    process.exit(result.passed ? 0 : 1);
  }

  // Handle --update-index-header
  if (options.updateIndexHeader) {
    if (options.dryRun) {
      console.log('Would update header in lib/mcp/tools/index.ts:');
      console.log(generateIndexHeader(inventory));
    } else {
      const success = updateIndexHeader(inventory);
      if (success) {
        console.log('Updated header in lib/mcp/tools/index.ts');
      } else {
        process.exit(2);
      }
    }
    return;
  }

  // Generate outputs
  const jsonContent = generateJSON(inventory);
  const markdownContent = generateMarkdown(inventory);

  if (options.stdout) {
    if (options.jsonOnly) {
      process.stdout.write(jsonContent);
    } else {
      process.stdout.write(jsonContent);
      process.stdout.write('\n---\n\n');
      process.stdout.write(markdownContent);
    }
    return;
  }

  if (options.dryRun) {
    console.log('Dry run -- would generate:');
    console.log(
      `  docs/generated/mcp-inventory.json (${jsonContent.length} bytes)`,
    );
    if (!options.jsonOnly) {
      console.log(
        `  docs/generated/mcp-inventory.md (${markdownContent.length} bytes)`,
      );
    }
    console.log('');
    console.log(
      `Summary: ${inventory.summary.tool_count} tools, ${inventory.summary.resource_count} resources, ${inventory.summary.prompt_count} prompts`,
    );
    console.log(
      `  Read-only: ${inventory.summary.read_only_tools}, Write: ${inventory.summary.write_tools}, Destructive: ${inventory.summary.destructive_tools}`,
    );
    console.log(
      `  App tools: ${inventory.summary.app_tools}, App resources: ${inventory.summary.app_resources}`,
    );
    return;
  }

  // Ensure output directory exists
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write files
  const jsonPath = resolve(OUTPUT_DIR, 'mcp-inventory.json');
  const mdPath = resolve(OUTPUT_DIR, 'mcp-inventory.md');

  writeFileSync(jsonPath, jsonContent, 'utf-8');
  console.log(`Written: ${jsonPath}`);

  if (!options.jsonOnly) {
    writeFileSync(mdPath, markdownContent, 'utf-8');
    console.log(`Written: ${mdPath}`);
  }

  console.log('');
  console.log(
    `Summary: ${inventory.summary.tool_count} tools, ${inventory.summary.resource_count} resources, ${inventory.summary.prompt_count} prompts`,
  );
}

main();
