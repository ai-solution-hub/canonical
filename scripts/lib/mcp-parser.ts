/**
 * MCP Inventory Parser — regex-based extraction of tool/resource/prompt metadata.
 *
 * Reads TypeScript source files and extracts registration metadata using
 * bracket-depth counting and targeted regex patterns. Designed for the
 * highly regular registration patterns used in lib/mcp/tools/*.ts and
 * lib/mcp/resources.ts.
 *
 * Also exposes the ID-71 M38 born-evaluable forcing-function detector
 * (`missingBornEvaluableArtefacts`) — a pure function over a touchpoint-change
 * descriptor that the guard tests (`mcp-fixture-sync.test.ts`,
 * `mcp-inventory-parser.test.ts`, and the ID-104 `recordAiCall` grep-guard)
 * exercise. It consumes the ID-104-owned {@link AgentEvalContract} (direct
 * import, no barrel) to validate the bound-contract leg. (B-INV-38/13/40.)
 *
 * @module scripts/lib/mcp-parser
 */

import {
  agentEvalContractSchema,
  type AgentEvalContract,
  type TouchpointKind,
} from '@/lib/eval/contract';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParamEntry {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

// Resolved values of the four named `ToolAnnotations` constants exported
// from `lib/mcp/tools/shared.ts`. Kept in sync manually — guarded by
// `__tests__/mcp/tool-annotations-coverage.test.ts` which exercises the
// real constants at runtime, so a drift between this table and shared.ts
// would surface there first.
const RESOLVED_ANNOTATION_CONSTANTS: Record<
  string,
  Required<ToolAnnotations>
> = {
  READ_ONLY_ANNOTATIONS: {
    readOnlyHint: true,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  SAFE_WRITE_ANNOTATIONS: {
    readOnlyHint: false,
    idempotentHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  DESTRUCTIVE_WRITE_ANNOTATIONS: {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  NON_IDEMPOTENT_WRITE_ANNOTATIONS: {
    readOnlyHint: false,
    idempotentHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
};

export interface ToolEntry {
  name: string;
  title: string;
  description: string;
  category_file: string;
  registration_order: number;
  input_params: ParamEntry[];
  annotations: ToolAnnotations;
  is_app_tool: boolean;
}

export interface ResourceEntry {
  internal_name: string;
  uri: string;
  description: string;
  mime_type: string;
  is_template: boolean;
  is_app_resource: boolean;
}

export interface PromptEntry {
  name: string;
  title: string;
  description: string;
  args: ParamEntry[];
}

// ---------------------------------------------------------------------------
// Utility: bracket-depth block extraction
// ---------------------------------------------------------------------------

/**
 * Given a source string and a starting index (just after the opening paren),
 * find the matching closing paren by counting bracket depth.
 * Returns the substring between the opening and closing parens (exclusive).
 */
function extractBalancedBlock(source: string, startIndex: number): string {
  let depth = 1;
  let i = startIndex;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  while (i < source.length && depth > 0) {
    const ch = source[i];

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      i++;
      continue;
    }

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && source[i + 1] === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
      i++;
      continue;
    }

    if (inTemplate) {
      if (ch === '`') inTemplate = false;
      i++;
      continue;
    }

    // Detect comments before entering string modes
    if (ch === '/' && source[i + 1] === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
    } else if (ch === '"') {
      inDoubleQuote = true;
    } else if (ch === '`') {
      inTemplate = true;
    } else if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i);
      }
    }

    i++;
  }

  // Fallback — return what we have
  return source.slice(startIndex, i);
}

/**
 * Find all occurrences of a registration pattern and extract the full call block.
 * Returns array of { block, startIndex } for each match.
 */
function findRegistrationBlocks(
  source: string,
  pattern: string,
): Array<{ block: string; startIndex: number }> {
  const results: Array<{ block: string; startIndex: number }> = [];
  let searchFrom = 0;

  while (searchFrom < source.length) {
    const idx = source.indexOf(pattern, searchFrom);
    if (idx === -1) break;

    // Find the opening paren after the pattern
    const parenIdx = source.indexOf('(', idx + pattern.length - 1);
    if (parenIdx === -1) {
      searchFrom = idx + pattern.length;
      continue;
    }

    const block = extractBalancedBlock(source, parenIdx + 1);
    results.push({ block, startIndex: idx });
    searchFrom = parenIdx + 1 + block.length + 1;
  }

  return results;
}

// ---------------------------------------------------------------------------
// String extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a string literal value (single-quoted, double-quoted, or backtick).
 * Returns the content without quotes.
 */
function extractStringLiteral(
  source: string,
  startIndex: number,
): string | null {
  let i = startIndex;
  // Skip whitespace
  while (i < source.length && /\s/.test(source[i])) i++;

  if (i >= source.length) return null;

  const quote = source[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;

  i++; // skip opening quote
  let result = '';
  let escaped = false;

  while (i < source.length) {
    const ch = source[i];

    if (escaped) {
      // Handle common escape sequences
      if (ch === 'n') result += '\n';
      else if (ch === 't') result += '\t';
      else if (ch === '\\') result += '\\';
      else if (ch === quote) result += quote;
      else result += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      i++;
      continue;
    }

    if (ch === quote) {
      return result;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Extract the first string argument from a block (the name argument).
 */
function extractFirstStringArg(block: string): string | null {
  // Skip leading whitespace, then look for a string literal
  const match = block.match(/^\s*(?:server\s*,\s*)?/);
  const offset = match ? match[0].length : 0;
  return extractStringLiteral(block, offset);
}

/**
 * Extract a property value from a config-like object block.
 * Handles both simple string values and multi-line strings.
 */
function extractPropertyString(block: string, propName: string): string | null {
  // Pattern: propName: 'value' or propName: "value" or propName: `value`
  // Also handles multi-line strings with concatenation
  const regex = new RegExp(`(?:^|\\n|,)\\s*${propName}\\s*:\\s*`, 'g');
  const match = regex.exec(block);
  if (!match) return null;

  const afterColon = match.index + match[0].length;
  const value = extractStringLiteral(block, afterColon);
  if (value !== null) return value;

  // Try multi-line: look for string concatenation pattern (unlikely but handle)
  return null;
}

/**
 * Extract boolean property from a block.
 */
function extractPropertyBoolean(
  block: string,
  propName: string,
): boolean | undefined {
  const regex = new RegExp(`${propName}\\s*:\\s*(true|false)`);
  const match = regex.exec(block);
  if (!match) return undefined;
  return match[1] === 'true';
}

// ---------------------------------------------------------------------------
// Zod schema parsing
// ---------------------------------------------------------------------------

/**
 * Parse a flat Zod schema block (the content of inputSchema: { ... }).
 * Extracts param names, types, optional flags, and .describe() strings.
 */
export function parseZodSchema(schemaSource: string): ParamEntry[] {
  const params: ParamEntry[] = [];

  // Normalise the schema source: collapse line breaks between z and .method()
  // so that patterns like `z\n  .number()\n  .optional()` become `z.number().optional()`
  const normalised = schemaSource.replace(/z\s*\n\s*\./g, 'z.');

  // Extract top-level properties only. We walk the normalised source character
  // by character, tracking brace depth so we skip over nested objects/arrays.
  // A top-level property starts at depth 0 with pattern: name: z.type(...)
  const topLevelProps = extractTopLevelZodProps(normalised);

  for (const { name: propName, chain: fullChain } of topLevelProps) {
    // Parse the chain: z.type(args).method().method()...
    const typeMatch = fullChain.match(/^z\.(\w+)\(/);
    if (!typeMatch) continue;

    const baseType = typeMatch[1];

    // Extract base args (content inside the first parentheses)
    const afterType = fullChain.slice(typeMatch[0].length);
    // Find matching close paren for the base call
    let baseArgs = '';
    if (baseType === 'enum' || baseType === 'array' || baseType === 'object') {
      // These can have complex inner content — use balanced extraction
      const inner = extractBalancedBlock(fullChain, typeMatch[0].length);
      baseArgs = inner;
    }

    // Determine type
    let type = baseType;
    if (baseType === 'enum') {
      // Extract enum values — handle multi-line arrays by using dotAll-style match
      const enumVals = baseArgs.match(/\[([\s\S]*?)\]/)?.[1] ?? '';
      const values = enumVals
        .split(',')
        .map((v) => v.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean);
      type = `enum(${values.join('|')})`;
    } else if (baseType === 'array') {
      type = 'array';
    } else if (baseType === 'object') {
      type = 'object';
    }

    // Extract the "outer chain" — methods called after the base type's closing paren.
    // For z.string().uuid().describe('...'), the outer chain is '.uuid().describe("...")'.
    // For z.array(z.string().uuid()).min(1).describe('...'), the outer chain is '.min(1).describe("...")'.
    // This prevents inner method calls (inside array/object/enum args) from being misattributed.
    const typeCallMatch = fullChain.match(/^z\.\w+\(/);
    let outerChain = fullChain;
    if (typeCallMatch) {
      const inner = extractBalancedBlock(fullChain, typeCallMatch[0].length);
      const afterBaseCall = typeCallMatch[0].length + inner.length + 1; // +1 for closing paren
      outerChain = fullChain.slice(afterBaseCall);
    }

    // Parse the outer chain for .optional(), .uuid(), .min(), .max(), .describe()
    const isOptional = outerChain.includes('.optional()');

    if (outerChain.includes('.uuid()')) {
      type = 'string (uuid)';
    }

    const minMatch = outerChain.match(/\.min\((\d+)\)/);
    const maxMatch = outerChain.match(/\.max\((\d+)\)/);
    if (minMatch || maxMatch) {
      const constraints: string[] = [];
      if (minMatch) constraints.push(`min:${minMatch[1]}`);
      if (maxMatch) constraints.push(`max:${maxMatch[1]}`);
      if (type === 'string' || type === 'number') {
        type = `${type} (${constraints.join(', ')})`;
      }
    }

    // Extract .describe() string — look in outerChain first, fall back to fullChain
    let description = '';
    const descIdx = outerChain.indexOf('.describe(');
    if (descIdx !== -1) {
      const descStr = extractStringLiteral(
        outerChain,
        descIdx + '.describe('.length,
      );
      if (descStr) description = descStr;
    } else {
      // Fall back: sometimes .describe() is part of a chained call inside the base
      const fullDescIdx = fullChain.lastIndexOf('.describe(');
      if (fullDescIdx !== -1) {
        const descStr = extractStringLiteral(
          fullChain,
          fullDescIdx + '.describe('.length,
        );
        if (descStr) description = descStr;
      }
    }

    params.push({
      name: propName,
      type,
      required: !isOptional,
      description,
    });
  }

  return params;
}

/**
 * Extract top-level Zod property definitions from a schema block.
 * Skips over nested braces/parens so that inner fields of z.object() are not
 * returned as top-level properties.
 *
 * Returns array of { name, chain } where chain is the full Zod expression
 * (e.g. "z.string().uuid().describe('...')").
 */
function extractTopLevelZodProps(
  source: string,
): Array<{ name: string; chain: string }> {
  const results: Array<{ name: string; chain: string }> = [];
  let i = 0;

  while (i < source.length) {
    // Skip whitespace
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) break;

    // Try to match a property name followed by : z.
    const remaining = source.slice(i);
    const propMatch = remaining.match(/^(\w+)\s*:\s*z\./);
    if (!propMatch) {
      // Not a property start — skip to next line or comma
      const nextComma = source.indexOf(',', i);
      const nextNewline = source.indexOf('\n', i);
      if (nextComma === -1 && nextNewline === -1) break;
      i = Math.min(
        nextComma === -1 ? source.length : nextComma + 1,
        nextNewline === -1 ? source.length : nextNewline + 1,
      );
      continue;
    }

    const propName = propMatch[1];
    const chainStart = i + propMatch[0].length - 2; // Start at 'z.'

    // Now extract the full chain by tracking balanced parens/braces.
    // The chain ends when we hit a comma or closing brace at depth 0.
    let depth = 0;
    let j = chainStart;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    while (j < source.length) {
      const ch = source[j];

      if (escaped) {
        escaped = false;
        j++;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        j++;
        continue;
      }
      if (inSingleQuote) {
        if (ch === "'") inSingleQuote = false;
        j++;
        continue;
      }
      if (inDoubleQuote) {
        if (ch === '"') inDoubleQuote = false;
        j++;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = true;
        j++;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = true;
        j++;
        continue;
      }

      if (ch === '(' || ch === '{' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === '}' || ch === ']') {
        depth--;
        if (depth < 0) break; // We've gone past the end of the schema
      }

      // At depth 0, a comma signals the end of this property
      if (depth === 0 && ch === ',') {
        break;
      }

      j++;
    }

    const chain = source.slice(chainStart, j).trim();
    if (chain.startsWith('z.')) {
      results.push({ name: propName, chain });
    }

    i = j + 1; // Skip past the comma
  }

  return results;
}

// ---------------------------------------------------------------------------
// Tool file parser
// ---------------------------------------------------------------------------

/**
 * Parse a tool file and extract all tool registrations.
 */
export function parseToolFile(source: string, filename: string): ToolEntry[] {
  const tools: ToolEntry[] = [];

  // P0-19 migration: tool registrations go through `defineTool(server, …)` /
  // `defineAppTool(registerAppToolFn, server, …)` wrappers in
  // `lib/mcp/tools/shared.ts`. Both wrappers forward to
  // `server.registerTool(…)` / `registerAppTool(server, …)` at runtime, so the
  // legacy patterns remain recognised for robustness against backsliding.

  // Find standard tool registrations: defineTool( or server.registerTool(
  // `defineTool(server, 'name', …)` — name is after 'server,' (skip-first-arg
  // mode, same as app tools).
  const defineBlocks = findRegistrationBlocks(source, 'defineTool(');
  for (const { block } of defineBlocks) {
    const tool = parseToolBlock(block, filename, true, false);
    if (tool) {
      tool.registration_order = tools.length + 1;
      tools.push(tool);
    }
  }

  const standardBlocks = findRegistrationBlocks(source, 'server.registerTool(');
  for (const { block } of standardBlocks) {
    const tool = parseToolBlock(block, filename, false, false);
    if (tool) {
      tool.registration_order = tools.length + 1;
      tools.push(tool);
    }
  }

  // Find app tool registrations: defineAppTool( or registerAppTool(
  // `defineAppTool(registerAppToolFn, server, 'name', …)` — skip 2 args to
  // reach the name.
  const defineAppBlocks = findRegistrationBlocks(source, 'defineAppTool(');
  for (const { block } of defineAppBlocks) {
    const tool = parseToolBlock(block, filename, true, true);
    if (tool) {
      tool.registration_order = tools.length + 1;
      tools.push(tool);
    }
  }

  // Note: registerAppTool blocks start with: server, 'tool_name', ...
  const appBlocks = findRegistrationBlocks(source, 'registerAppTool(');
  for (const { block } of appBlocks) {
    const tool = parseToolBlock(block, filename, true, false);
    if (tool) {
      tool.registration_order = tools.length + 1;
      tools.push(tool);
    }
  }

  return tools;
}

/**
 * Parse a single tool registration block.
 *
 * @param skipToName How many leading comma-separated args to skip before the
 *   name literal.
 *   - `false` for `server.registerTool('name', …)` — name is arg 0.
 *   - `true` for `registerAppTool(server, 'name', …)` / `defineTool(server,
 *     'name', …)` — skip 1 arg.
 * @param isDefineAppTool `defineAppTool(registerAppToolFn, server, 'name',
 *   …)` — skip 2 args.
 */
function parseToolBlock(
  block: string,
  filename: string,
  skipToName: boolean,
  isDefineAppTool: boolean,
): ToolEntry | null {
  // Treat as app tool for inventory classification purposes if the caller is
  // one of the app-tool registration paths. The distinction matters because
  // App tools render interactive UIs rather than plain text/JSON responses.
  const isAppTool = skipToName && (isDefineAppTool || filename === 'apps.ts');
  // For app tools, the first arg is 'server', then the name
  // For standard tools, the first arg is the name
  let nameSearchBlock = block;
  if (skipToName) {
    // Skip past the leading arg(s) to find the tool name. `defineAppTool`
    // has two leading args (registerAppToolFn, server); the others have one.
    const argsToSkip = isDefineAppTool ? 2 : 1;
    let cursor = 0;
    for (let i = 0; i < argsToSkip; i++) {
      const commaIdx = block.indexOf(',', cursor);
      if (commaIdx === -1) return null;
      cursor = commaIdx + 1;
    }
    nameSearchBlock = block.slice(cursor);
  }

  const name = extractFirstStringArg(nameSearchBlock);
  if (!name) return null;

  // Find the config object (second argument for standard, third for app)
  // Look for the object literal after the name string
  const nameEndIdx = isAppTool
    ? block.indexOf(name) + name.length + 1 // +1 for closing quote
    : block.indexOf(name) + name.length + 1;

  // Find the opening brace of the config object
  const configStart = block.indexOf('{', nameEndIdx);
  if (configStart === -1) return null;

  const configBlock = extractBalancedBlock(block, configStart + 1);

  // Extract title
  const title = extractPropertyString(configBlock, 'title') ?? '';

  // Extract description — handle multi-line concatenation
  let description = extractPropertyString(configBlock, 'description') ?? '';
  // Clean up newlines from template literal or concatenated strings
  description = description.replace(/\s+/g, ' ').trim();

  // Extract inputSchema
  let inputParams: ParamEntry[] = [];
  const schemaIdx = configBlock.indexOf('inputSchema:');
  if (schemaIdx !== -1) {
    const afterSchema = configBlock.slice(schemaIdx + 'inputSchema:'.length);
    const braceIdx = afterSchema.indexOf('{');
    if (braceIdx !== -1) {
      const schemaBlock = extractBalancedBlock(afterSchema, braceIdx + 1);
      inputParams = parseZodSchema(schemaBlock);
    }
  }

  // Extract annotations — either an inline `{ … }` object or one of the
  // four named constants from `lib/mcp/tools/shared.ts`. The named-constant
  // path is the P0-19 canonical form.
  const annotations: ToolAnnotations = {};
  const annotIdx = configBlock.indexOf('annotations:');
  if (annotIdx !== -1) {
    const afterAnnot = configBlock.slice(annotIdx + 'annotations:'.length);
    // Skip whitespace then see whether the value is `{` (inline object) or
    // an identifier (named constant).
    let probe = 0;
    while (probe < afterAnnot.length && /\s/.test(afterAnnot[probe])) probe++;
    const nextChar = afterAnnot[probe];

    if (nextChar === '{') {
      // Inline literal — original behaviour.
      const annotBlock = extractBalancedBlock(afterAnnot, probe + 1);
      annotations.readOnlyHint = extractPropertyBoolean(
        annotBlock,
        'readOnlyHint',
      );
      annotations.idempotentHint = extractPropertyBoolean(
        annotBlock,
        'idempotentHint',
      );
      annotations.destructiveHint = extractPropertyBoolean(
        annotBlock,
        'destructiveHint',
      );
      annotations.openWorldHint = extractPropertyBoolean(
        annotBlock,
        'openWorldHint',
      );
    } else {
      // Named constant — resolve the four canonical identifiers.
      const identMatch = afterAnnot
        .slice(probe)
        .match(
          /^(READ_ONLY_ANNOTATIONS|SAFE_WRITE_ANNOTATIONS|DESTRUCTIVE_WRITE_ANNOTATIONS|NON_IDEMPOTENT_WRITE_ANNOTATIONS)\b/,
        );
      if (identMatch) {
        const resolved = RESOLVED_ANNOTATION_CONSTANTS[identMatch[1]];
        annotations.readOnlyHint = resolved.readOnlyHint;
        annotations.idempotentHint = resolved.idempotentHint;
        annotations.destructiveHint = resolved.destructiveHint;
        annotations.openWorldHint = resolved.openWorldHint;
      }
    }
  }

  return {
    name,
    title,
    description,
    category_file: filename,
    registration_order: 0, // set by caller
    input_params: inputParams,
    annotations,
    is_app_tool: isAppTool,
  };
}

// ---------------------------------------------------------------------------
// Resource file parser
// ---------------------------------------------------------------------------

/**
 * Parse a resource file and extract all resource registrations.
 */
export function parseResourceFile(source: string): ResourceEntry[] {
  const resources: ResourceEntry[] = [];

  // Standard resources: server.registerResource(
  const standardBlocks = findRegistrationBlocks(
    source,
    'server.registerResource(',
  );
  for (const { block } of standardBlocks) {
    const resource = parseResourceBlock(block);
    if (resource) resources.push(resource);
  }

  // App resources: registerAppResource(
  const appBlocks = findRegistrationBlocks(source, 'registerAppResource(');
  for (const { block } of appBlocks) {
    const resource = parseAppResourceBlock(block);
    if (resource) resources.push(resource);
  }

  return resources;
}

/**
 * Parse a standard server.registerResource() block.
 *
 * Standard pattern has two forms:
 * 1. Template resource:
 *    server.registerResource('name', new ResourceTemplate('uri', {...}), { description, mimeType }, handler)
 * 2. Static resource:
 *    server.registerResource('name', 'uri', { description, mimeType }, handler)
 */
function parseResourceBlock(block: string): ResourceEntry | null {
  // Extract internal name (first string arg)
  const internalName = extractFirstStringArg(block);
  if (!internalName) return null;

  // Find the URI — could be a ResourceTemplate or a plain string
  const isTemplate = block.includes('new ResourceTemplate(');

  let uri = '';
  if (isTemplate) {
    // Extract URI from: new ResourceTemplate('kb://items/{id}', ...)
    const templateIdx = block.indexOf('new ResourceTemplate(');
    if (templateIdx !== -1) {
      const afterTemplate = block.slice(
        templateIdx + 'new ResourceTemplate('.length,
      );
      uri = extractStringLiteral(afterTemplate, 0) ?? '';
    }
  } else {
    // Find the second string arg after the internal name
    const nameIdx = block.indexOf(internalName);
    if (nameIdx !== -1) {
      // Skip past the name string and its closing quote + comma
      const afterName = block.slice(nameIdx + internalName.length);
      const commaIdx = afterName.indexOf(',');
      if (commaIdx !== -1) {
        const afterComma = afterName.slice(commaIdx + 1);
        uri = extractStringLiteral(afterComma, 0) ?? '';
      }
    }
  }

  if (!uri) return null;

  // Find the metadata object (contains description and mimeType)
  // It appears after the URI arg or ResourceTemplate
  let description = '';
  let mimeType = 'application/json';

  // Look for { description: '...', mimeType: '...' } pattern
  // Find all { ... } blocks after the URI and look for one with 'description'
  const descMatch = block.match(/\{\s*description:\s*['"]/);
  if (descMatch) {
    const descIdx = block.indexOf(descMatch[0]);
    const metaBlock = extractBalancedBlock(block, descIdx + 1);
    description = extractPropertyString(metaBlock, 'description') ?? '';
    mimeType =
      extractPropertyString(metaBlock, 'mimeType') ?? 'application/json';
  }

  return {
    internal_name: internalName,
    uri,
    description,
    mime_type: mimeType,
    is_template: uri.includes('{'),
    is_app_resource: false,
  };
}

/**
 * Parse a registerAppResource() block.
 * Pattern: registerAppResource(server, 'Name', 'uri', { mimeType }, handler)
 */
function parseAppResourceBlock(block: string): ResourceEntry | null {
  // Skip 'server,' to get to the name
  const serverCommaIdx = block.indexOf(',');
  if (serverCommaIdx === -1) return null;

  const afterServer = block.slice(serverCommaIdx + 1);
  const internalName = extractStringLiteral(afterServer, 0);
  if (!internalName) return null;

  // Find URI (second string after the name)
  const nameIdx = afterServer.indexOf(internalName);
  const afterName = afterServer.slice(nameIdx + internalName.length);
  const commaIdx = afterName.indexOf(',');
  if (commaIdx === -1) return null;

  const afterComma = afterName.slice(commaIdx + 1);
  const uri = extractStringLiteral(afterComma, 0);
  if (!uri) return null;

  // Find metadata object
  let mimeType = 'text/html';
  const metaBraceIdx = afterComma.indexOf('{');
  if (metaBraceIdx !== -1) {
    const metaBlock = extractBalancedBlock(afterComma, metaBraceIdx + 1);
    const extractedMime = extractPropertyString(metaBlock, 'mimeType');
    if (extractedMime) mimeType = extractedMime;
  }

  return {
    internal_name: internalName,
    uri,
    description: `${internalName} (interactive UI)`,
    mime_type: mimeType,
    is_template: false,
    is_app_resource: true,
  };
}

// ---------------------------------------------------------------------------
// Prompt file parser
// ---------------------------------------------------------------------------

/**
 * Parse prompts from a source file.
 */
export function parsePromptFile(source: string): PromptEntry[] {
  const prompts: PromptEntry[] = [];

  const blocks = findRegistrationBlocks(source, 'server.registerPrompt(');
  for (const { block } of blocks) {
    const prompt = parsePromptBlock(block);
    if (prompt) prompts.push(prompt);
  }

  return prompts;
}

/**
 * Parse a single server.registerPrompt() block.
 * Pattern: server.registerPrompt('name', { title, description, argsSchema? }, handler)
 */
function parsePromptBlock(block: string): PromptEntry | null {
  const name = extractFirstStringArg(block);
  if (!name) return null;

  // Find the config object
  const nameIdx = block.indexOf(name);
  const configStart = block.indexOf('{', nameIdx + name.length);
  if (configStart === -1) return null;

  const configBlock = extractBalancedBlock(block, configStart + 1);

  const title = extractPropertyString(configBlock, 'title') ?? '';
  const description = extractPropertyString(configBlock, 'description') ?? '';

  // Extract argsSchema if present
  let args: ParamEntry[] = [];
  const argsIdx = configBlock.indexOf('argsSchema:');
  if (argsIdx !== -1) {
    const afterArgs = configBlock.slice(argsIdx + 'argsSchema:'.length);
    const braceIdx = afterArgs.indexOf('{');
    if (braceIdx !== -1) {
      const argsBlock = extractBalancedBlock(afterArgs, braceIdx + 1);
      args = parseZodSchema(argsBlock);
    }
  }

  return { name, title, description, args };
}

// ---------------------------------------------------------------------------
// ID-71 M38 — born-evaluable forcing-function detector (B-INV-38/13/40)
// ---------------------------------------------------------------------------

/**
 * The three forcing-function artefacts a touchpoint change MUST carry to be
 * born-evaluable. Identifiers are stable strings so the guard tests (and any
 * failure message) name exactly which leg is absent.
 *
 *   - `skill-invocation` — a `create-skill` / `update-skill` invocation
 *     accompanies the change (B-INV-38: a tooling change forces a skill update).
 *   - `eval-fixture-update` — an eval and/or fixture update accompanies the
 *     change (B-INV-38: the change is reflected in the eval/fixture surface).
 *   - `bound-contract` — a valid, bound ID-104 {@link AgentEvalContract} ships
 *     with the change (B-INV-13/40: the touchpoint is born against an eval, not
 *     gated by its schema alone).
 */
export type BornEvaluableArtefact =
  | 'skill-invocation'
  | 'eval-fixture-update'
  | 'bound-contract';

/**
 * The complete set, in canonical order — the guard fails a change missing ANY
 * of these.
 */
export const BORN_EVALUABLE_ARTEFACTS: readonly BornEvaluableArtefact[] = [
  'skill-invocation',
  'eval-fixture-update',
  'bound-contract',
] as const;

/**
 * A description of a single touchpoint change, as the guard sees it. `kind`
 * widens the forcing function beyond the MCP fixture-sync precedent (which only
 * saw tools) to prompts, plugin skills, and inline AI touchpoints (B-INV-38).
 *
 * The three artefact legs are evidence the changeset carries the forced
 * accompaniments:
 *   - `skillInvoked` — a `create-skill` / `update-skill` invocation is present.
 *   - `evalOrFixtureUpdated` — an eval and/or fixture update is present.
 *   - `boundContract` — the ID-104 contract bound to the touchpoint, or `null`
 *     when none is bound. A supplied contract is validated against
 *     `agentEvalContractSchema`; a malformed/placeholder contract counts as
 *     UNbound (it does not satisfy the born-evaluable leg).
 */
export interface TouchpointChange {
  kind: TouchpointKind;
  skillInvoked: boolean;
  evalOrFixtureUpdated: boolean;
  boundContract: AgentEvalContract | null;
}

/**
 * Pure detector (M38 forcing function). Returns the forcing-function artefacts
 * MISSING from a touchpoint change, in {@link BORN_EVALUABLE_ARTEFACTS} order.
 * An EMPTY array means the change is born-evaluable (all three legs present);
 * a non-empty array is the guard's FAIL signal naming each absent leg.
 *
 * Modelled on the `recordAiCall` grep-guard's `touchpointOmitsRecordAiCall` and
 * the contract-consumption guard's `declaresAgentEvalContract`: a pure function
 * over its input so the failing direction can be unit-proved with synthetic
 * changes across every {@link TouchpointKind}, with no reliance on the live tree
 * carrying a non-compliant change.
 */
export function missingBornEvaluableArtefacts(
  change: TouchpointChange,
): BornEvaluableArtefact[] {
  const missing: BornEvaluableArtefact[] = [];

  if (!change.skillInvoked) missing.push('skill-invocation');
  if (!change.evalOrFixtureUpdated) missing.push('eval-fixture-update');
  if (!hasBoundContract(change.boundContract)) missing.push('bound-contract');

  return missing;
}

/**
 * Whether a touchpoint change is born-evaluable — carries ALL three
 * forcing-function artefacts. Convenience predicate over
 * {@link missingBornEvaluableArtefacts}.
 */
export function isBornEvaluable(change: TouchpointChange): boolean {
  return missingBornEvaluableArtefacts(change).length === 0;
}

/**
 * The bound-contract leg: a contract counts as bound only when it is present
 * AND validates against the ID-104 `agentEvalContractSchema` (T2 boundary). A
 * `null` contract, or one that fails strict validation (e.g. a placeholder
 * missing a mandatory field), does NOT satisfy the leg.
 */
function hasBoundContract(contract: AgentEvalContract | null): boolean {
  if (contract === null) return false;
  return agentEvalContractSchema.safeParse(contract).success;
}
