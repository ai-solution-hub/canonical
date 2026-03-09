/**
 * MCP test route 6 — SDK direct, no auth, full tools.
 * Tests whether fresh-transport-per-request pattern works across
 * initialize → tools/list on warm Vercel instances.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools } from '@/lib/mcp/tools';
import { registerResources, registerPrompts } from '@/lib/mcp/resources';

// ---------------------------------------------------------------------------
// Server initialisation function — called fresh per request
// ---------------------------------------------------------------------------

function createInitialisedServer(): McpServer {
  const server = new McpServer(
    { name: 'knowledge-hub-test6', version: '0.0.1' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health check.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: 'text' as const, text: 'Test6 running.' }],
    }),
  );

  return server;
}

// ---------------------------------------------------------------------------
// Request handler — fresh server + transport per request
// ---------------------------------------------------------------------------

async function handleMcpRequest(request: Request): Promise<Response> {
  const server = createInitialisedServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true, // Return JSON instead of SSE for simpler response handling
  });

  await server.connect(transport);

  // Don't close transport/server — the response stream needs them alive.
  // Vercel will clean up when the function instance is recycled.
  return await transport.handleRequest(request);
}

export const maxDuration = 60;

export async function GET(request: Request) {
  return handleMcpRequest(request);
}
export async function POST(request: Request) {
  return handleMcpRequest(request);
}
export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}
