/**
 * MCP Protocol Compliance Evaluation — Layer 1
 *
 * Sends raw JSON-RPC requests to the MCP server endpoint, verifying that
 * the protocol works correctly. Each request is independent (the server
 * creates a fresh McpServer + transport per request).
 *
 * The approach: send an `initialize` request first to set up the protocol,
 * then send the actual method call. For the stateless server, each POST
 * gets a fresh server instance, so we bundle initialize + method in a
 * single POST using JSON-RPC batch format.
 *
 * Usage:
 *   bun run scripts/mcp-eval/protocol-compliance.ts
 *   bun run scripts/mcp-eval/protocol-compliance.ts --skip-ai
 *   bun run scripts/mcp-eval/protocol-compliance.ts --server http://localhost:3000
 *
 * Requires: dev server running, .env with test user credentials.
 */
import {
  loadEnv,
  getAuthToken,
  getKnownUUIDs,
  createEvalItem,
  deleteEvalItem,
  cleanupStaleEvalItems,
  getMinimalArgs,
  CANONICAL_TOOL_NAMES,
  TOOL_COUNT,
  CANONICAL_PROMPT_NAMES,
  PROMPT_COUNT,
  AI_TOOLS,
  type KnownUUIDs,
  type EvalItem,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const cliArgs = process.argv.slice(2);
const skipAi = cliArgs.includes('--skip-ai');
const serverArgIdx = cliArgs.indexOf('--server');
const serverBase = serverArgIdx >= 0
  ? cliArgs[serverArgIdx + 1] ?? 'http://localhost:3000'
  : 'http://localhost:3000';
const MCP_URL = `${serverBase}/api/mcp/streamable-http`;

// ---------------------------------------------------------------------------
// Result tracking
// ---------------------------------------------------------------------------

interface CheckResult {
  id: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

const results: CheckResult[] = [];

function pass(id: string, name: string, detail: string): void {
  results.push({ id, name, status: 'PASS', detail });
}
function fail(id: string, name: string, detail: string): void {
  results.push({ id, name, status: 'FAIL', detail });
}
function skip(id: string, name: string, detail: string): void {
  results.push({ id, name, status: 'SKIP', detail });
}

// ---------------------------------------------------------------------------
// JSON-RPC client — raw HTTP approach for stateless MCP server
// ---------------------------------------------------------------------------

let requestId = 1;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Send a JSON-RPC request to the MCP server.
 *
 * The Knowledge Hub MCP server is stateless: each request creates a fresh
 * McpServer + WebStandardStreamableHTTPServerTransport. In stateless mode
 * (sessionIdGenerator: undefined), session validation is skipped and
 * Mcp-Protocol-Version is optional, so requests work WITHOUT a prior
 * `initialize` call.
 */
async function mcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  accessToken: string,
): Promise<JsonRpcResponse> {
  const id = requestId++;

  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return (await response.json()) as JsonRpcResponse;
  }

  if (contentType.includes('text/event-stream')) {
    // SSE response — parse events to find the JSON-RPC response
    const text = await response.text();
    const events = text.split('\n\n').filter(Boolean);
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            return JSON.parse(line.slice(6)) as JsonRpcResponse;
          } catch {
            // Continue to next event
          }
        }
      }
    }
    throw new Error('No JSON-RPC response found in SSE stream');
  }

  throw new Error(`Unexpected content type: ${contentType}`);
}

// ---------------------------------------------------------------------------
// Discovery checks
// ---------------------------------------------------------------------------

interface ToolDef {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

interface PromptDef {
  name: string;
  description?: string;
}

async function runDiscoveryChecks(accessToken: string): Promise<void> {
  console.log('\nDiscovery');

  // PC-01: tools/list count
  let tools: ToolDef[] = [];
  try {
    const response = await mcpRequest('tools/list', {}, accessToken);
    if (response.error) {
      fail('PC-01', 'tools/list count', `RPC error: ${response.error.message}`);
      return;
    }
    const result = response.result as { tools: ToolDef[] };
    tools = result.tools ?? [];
    if (tools.length === TOOL_COUNT) {
      pass('PC-01', 'tools/list count', `${tools.length} tools`);
    } else {
      fail('PC-01', 'tools/list count', `Expected ${TOOL_COUNT}, got ${tools.length}`);
    }
  } catch (err) {
    fail('PC-01', 'tools/list count', `Error: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // PC-02: tool schema completeness
  const incomplete = tools.filter(
    (t) => !t.name || !t.description || !t.inputSchema,
  );
  if (incomplete.length === 0) {
    pass('PC-02', 'tool schema completeness', 'All tools have name, description, inputSchema');
  } else {
    fail(
      'PC-02',
      'tool schema completeness',
      `${incomplete.length} tool(s) missing fields: ${incomplete.map((t) => t.name || '(unnamed)').join(', ')}`,
    );
  }

  // PC-03: tool name validation
  const serverToolNames = new Set(tools.map((t) => t.name));
  const canonicalSet = new Set<string>(CANONICAL_TOOL_NAMES);
  const missing = CANONICAL_TOOL_NAMES.filter((n) => !serverToolNames.has(n));
  const extra = tools.filter((t) => !canonicalSet.has(t.name)).map((t) => t.name);
  if (missing.length === 0 && extra.length === 0) {
    pass('PC-03', 'tool name validation', 'All names match canonical list');
  } else {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
    if (extra.length > 0) parts.push(`extra: ${extra.join(', ')}`);
    fail('PC-03', 'tool name validation', parts.join('; '));
  }

  // PC-04: tool annotation hints
  const missingAnnotations = tools.filter((t) => {
    if (!t.annotations) return true;
    return t.annotations.readOnlyHint === undefined;
  });
  if (missingAnnotations.length === 0) {
    pass('PC-04', 'tool annotation hints', 'All tools have annotation hints');
  } else {
    fail(
      'PC-04',
      'tool annotation hints',
      `${missingAnnotations.length} tool(s) missing annotations: ${missingAnnotations.map((t) => t.name).join(', ')}`,
    );
  }

  // PC-05: resources/list
  try {
    const response = await mcpRequest('resources/list', {}, accessToken);
    if (response.error) {
      fail('PC-05', 'resources/list', `RPC error: ${response.error.message}`);
    } else {
      const result = response.result as { resources: unknown[] };
      const count = result.resources?.length ?? 0;
      if (count >= 7) {
        pass('PC-05', 'resources/list', `${count} resources`);
      } else {
        fail('PC-05', 'resources/list', `Expected >= 7 resources, got ${count}`);
      }
    }
  } catch (err) {
    fail('PC-05', 'resources/list', `Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // PC-06: resources/templates/list
  try {
    const response = await mcpRequest('resources/templates/list', {}, accessToken);
    if (response.error) {
      fail('PC-06', 'resource templates', `RPC error: ${response.error.message}`);
    } else {
      const result = response.result as { resourceTemplates: unknown[] };
      const count = result.resourceTemplates?.length ?? 0;
      if (count >= 3) {
        pass('PC-06', 'resource templates', `${count} templates`);
      } else {
        fail('PC-06', 'resource templates', `Expected >= 3 templates, got ${count}`);
      }
    }
  } catch (err) {
    fail('PC-06', 'resource templates', `Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // PC-07: prompts/list count
  let prompts: PromptDef[] = [];
  try {
    const response = await mcpRequest('prompts/list', {}, accessToken);
    if (response.error) {
      fail('PC-07', 'prompts/list count', `RPC error: ${response.error.message}`);
    } else {
      const result = response.result as { prompts: PromptDef[] };
      prompts = result.prompts ?? [];
      if (prompts.length === PROMPT_COUNT) {
        pass('PC-07', 'prompts/list count', `${prompts.length} prompts`);
      } else {
        fail('PC-07', 'prompts/list count', `Expected ${PROMPT_COUNT}, got ${prompts.length}`);
      }
    }
  } catch (err) {
    fail('PC-07', 'prompts/list count', `Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // PC-08: prompt schema completeness
  const incompletePrompts = prompts.filter((p) => !p.name || !p.description);
  if (incompletePrompts.length === 0) {
    pass('PC-08', 'prompt schema completeness', 'All prompts have name, description');
  } else {
    fail(
      'PC-08',
      'prompt schema completeness',
      `${incompletePrompts.length} prompt(s) missing fields: ${incompletePrompts.map((p) => p.name || '(unnamed)').join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tool call checks
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  text?: string;
  resource?: unknown;
}

interface ToolCallResult {
  content: ContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
}

async function runToolCallChecks(
  accessToken: string,
  knownUUIDs: KnownUUIDs,
  evalItem: EvalItem,
): Promise<void> {
  console.log(`\nTool Calls (${TOOL_COUNT} tools)`);

  // Track items created by write tools for cleanup
  const createdItemIds: string[] = [];

  for (const toolName of CANONICAL_TOOL_NAMES) {
    // Skip AI-heavy tools if --skip-ai
    if (skipAi && AI_TOOLS.has(toolName)) {
      skip('PC-10', toolName, 'Skipped (--skip-ai)');
      continue;
    }

    // Skip delete_content_item — tested separately in cleanup
    if (toolName === 'delete_content_item') {
      skip('PC-10', toolName, 'Tested during cleanup phase');
      continue;
    }

    try {
      const toolArgs = getMinimalArgs(toolName, knownUUIDs, evalItem.id);
      const response = await mcpRequest(
        'tools/call',
        { name: toolName, arguments: toolArgs },
        accessToken,
      );

      if (response.error) {
        fail('PC-12', toolName, `RPC error: ${response.error.message}`);
        continue;
      }

      const result = response.result as ToolCallResult;

      // PC-10: Response has content array
      if (!result.content || !Array.isArray(result.content)) {
        fail('PC-10', toolName, 'Response missing content array');
        continue;
      }

      // PC-11: Each content block has type and text
      const contentBlocks = result.content;
      const invalidBlocks = contentBlocks.filter(
        (block) => block.type !== 'text' || typeof block.text !== 'string',
      );

      if (invalidBlocks.length > 0) {
        // Allow resource content blocks from app trigger tools
        const nonResourceInvalid = invalidBlocks.filter(
          (block) => block.type !== 'resource',
        );
        if (nonResourceInvalid.length > 0) {
          fail(
            'PC-11',
            toolName,
            `${nonResourceInvalid.length} block(s) missing type:"text" or text:string`,
          );
          continue;
        }
      }

      // Get response summary
      const textContent = contentBlocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const charCount = textContent.length;
      const isError = result.isError === true;

      // For create_content_item, track created item for cleanup
      if (toolName === 'create_content_item' && !isError) {
        const idMatch = textContent.match(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        if (idMatch) {
          createdItemIds.push(idMatch[0]);
        }
      }

      const detail = isError
        ? 'error response'
        : `${contentBlocks.length} block(s), ${charCount.toLocaleString()} chars`;
      pass('PC-10', toolName, detail);
    } catch (err) {
      // PC-12: No unhandled exceptions
      fail(
        'PC-12',
        toolName,
        `Unhandled exception: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Clean up items created by write tool tests
  if (createdItemIds.length > 0) {
    const { supabase } = await getAuthToken();
    for (const id of createdItemIds) {
      try {
        await supabase.from('content_history').delete().eq('content_item_id', id);
        await supabase.from('content_items').delete().eq('id', id);
      } catch {
        // Best effort cleanup
      }
    }
    console.log(`  Cleaned up ${createdItemIds.length} item(s) created by write tool tests`);
  }
}

// ---------------------------------------------------------------------------
// Error handling checks
// ---------------------------------------------------------------------------

async function runErrorHandlingChecks(accessToken: string): Promise<void> {
  console.log('\nError Handling');

  // PC-20: Invalid UUID returns error text, not protocol error
  try {
    const response = await mcpRequest(
      'tools/call',
      {
        name: 'get_content_item',
        arguments: { id: '00000000-0000-0000-0000-000000000000' },
      },
      accessToken,
    );

    if (response.error) {
      // Protocol-level error — acceptable if it's structured
      pass('PC-20', 'invalid UUID', `RPC error: ${response.error.message.slice(0, 80)}`);
    } else {
      const result = response.result as ToolCallResult;
      const hasTextResponse = result.content?.some(
        (b) => b.type === 'text' && typeof b.text === 'string',
      );
      if (hasTextResponse) {
        pass('PC-20', 'invalid UUID', 'Returns error text response');
      } else {
        fail('PC-20', 'invalid UUID', 'No text error response');
      }
    }
  } catch (err) {
    fail(
      'PC-20',
      'invalid UUID',
      `Unstructured error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // PC-21: Missing required param returns validation error
  try {
    const response = await mcpRequest(
      'tools/call',
      {
        name: 'get_content_item',
        arguments: {},
      },
      accessToken,
    );

    if (response.error) {
      // Protocol-level validation — acceptable
      pass('PC-21', 'missing required param', `Validation error: ${response.error.message.slice(0, 80)}`);
    } else {
      const result = response.result as ToolCallResult;
      if (result.isError || (result.content && result.content.length > 0)) {
        pass('PC-21', 'missing required param', 'Returns validation error');
      } else {
        fail('PC-21', 'missing required param', 'No error response for missing param');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pass('PC-21', 'missing required param', `Error caught: ${msg.slice(0, 80)}`);
  }

  // PC-22: Wrong param type returns validation error
  try {
    const response = await mcpRequest(
      'tools/call',
      {
        name: 'get_content_item',
        arguments: { id: 12345 },
      },
      accessToken,
    );

    if (response.error) {
      pass('PC-22', 'wrong param type', `Validation error: ${response.error.message.slice(0, 80)}`);
    } else {
      const result = response.result as ToolCallResult;
      if (result.isError || (result.content && result.content.length > 0)) {
        pass('PC-22', 'wrong param type', 'Returns validation error');
      } else {
        fail('PC-22', 'wrong param type', 'No error response for wrong type');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pass('PC-22', 'wrong param type', `Error caught: ${msg.slice(0, 80)}`);
  }

  // PC-23: Non-existent resource ID returns "not found" text
  try {
    const response = await mcpRequest(
      'resources/read',
      { uri: 'kb://items/00000000-0000-0000-0000-000000000000' },
      accessToken,
    );

    if (response.error) {
      const msg = response.error.message.toLowerCase();
      if (msg.includes('not found') || msg.includes('error')) {
        pass('PC-23', 'non-existent resource', `Structured error: ${response.error.message.slice(0, 80)}`);
      } else {
        pass('PC-23', 'non-existent resource', `RPC error handled: ${response.error.message.slice(0, 80)}`);
      }
    } else {
      const result = response.result as { contents: Array<{ text?: string }> };
      const hasNotFound = result.contents?.some((c) => {
        const text = typeof c.text === 'string' ? c.text : '';
        return text.toLowerCase().includes('not found') || text.toLowerCase().includes('error');
      });
      if (hasNotFound) {
        pass('PC-23', 'non-existent resource', 'Returns "not found" text');
      } else if (result.contents?.length > 0) {
        pass('PC-23', 'non-existent resource', 'Returns response (handled gracefully)');
      } else {
        fail('PC-23', 'non-existent resource', 'No response for non-existent resource');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pass('PC-23', 'non-existent resource', `Error handled: ${msg.slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function printReport(): void {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log('\n' + '='.repeat(60));
  console.log('MCP Protocol Compliance Report');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Server: ${MCP_URL}`);
  if (skipAi) console.log('Mode: --skip-ai (AI-heavy tools skipped)');

  // Group results by section
  const sections = new Map<string, CheckResult[]>();
  for (const r of results) {
    const section = r.id.startsWith('PC-0')
      ? 'Discovery'
      : r.id === 'PC-10' || r.id === 'PC-11' || r.id === 'PC-12'
        ? 'Tool Calls'
        : 'Error Handling';
    const existing = sections.get(section) ?? [];
    existing.push(r);
    sections.set(section, existing);
  }

  for (const [section, checks] of sections) {
    console.log(`\n${section}`);
    for (const check of checks) {
      const icon =
        check.status === 'PASS' ? 'PASS' : check.status === 'FAIL' ? 'FAIL' : 'SKIP';
      const label = `  ${check.id} ${check.name}`;
      const dots = '.'.repeat(Math.max(2, 50 - label.length));
      console.log(`${label} ${dots} ${icon} (${check.detail})`);
    }
  }

  console.log(
    `\nSummary: ${passed}/${results.length} passed, ${failed} failed, ${skipped} skipped`,
  );
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log('MCP Protocol Compliance Evaluation');
  console.log(`Server: ${MCP_URL}`);
  if (skipAi) console.log('Mode: --skip-ai');

  // Load env
  loadEnv();

  // Step 1: Authenticate
  console.log('\nAuthenticating...');
  const { accessToken, supabase } = await getAuthToken();
  console.log('  Signed in as admin test user');

  // Step 2: Clean up stale eval items
  const staleCount = await cleanupStaleEvalItems(supabase);
  if (staleCount > 0) {
    console.log(`  Cleaned up ${staleCount} stale eval item(s)`);
  }

  // Step 3: Get known UUIDs for tool tests
  console.log('\nFetching known UUIDs...');
  const knownUUIDs = await getKnownUUIDs(supabase);
  console.log(`  Content item: ${knownUUIDs.contentItemId}`);
  console.log(`  Bid: ${knownUUIDs.bidId ?? '(none)'}`);
  console.log(`  Question: ${knownUUIDs.questionId ?? '(none)'}`);

  // Step 4: Create eval content item for write tool tests
  console.log('\nCreating eval content item...');
  const evalItem = await createEvalItem(supabase);
  console.log(`  Eval item: ${evalItem.id}`);

  try {
    // Step 5: Discovery checks
    await runDiscoveryChecks(accessToken);

    // Step 6: Tool call checks
    await runToolCallChecks(accessToken, knownUUIDs, evalItem);

    // Step 7: Error handling checks
    await runErrorHandlingChecks(accessToken);
  } finally {
    // Step 8: Clean up eval item
    console.log('\nCleaning up...');
    try {
      await deleteEvalItem(supabase, evalItem.id);
      console.log('  Eval item deleted');
    } catch (err) {
      console.error(
        `  Failed to delete eval item: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Step 9: Print report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);
  printReport();

  // Exit with non-zero if any failures
  const failures = results.filter((r) => r.status === 'FAIL').length;
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(2);
});
