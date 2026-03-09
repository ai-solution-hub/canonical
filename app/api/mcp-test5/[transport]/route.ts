/**
 * MCP test route 5 — uses SDK's WebStandardStreamableHTTPServerTransport directly.
 * Bypasses mcp-handler to avoid its stateful transport bug on Vercel serverless.
 *
 * The MCP SDK's web standard transport natively handles Request/Response,
 * so no Node.js shims (createFakeIncomingMessage, createServerResponseAdapter)
 * are needed.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpUserClient } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';
import { registerResources, registerPrompts } from '@/lib/mcp/resources';

console.log('[MCP-TEST5] Module loading...');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function verifyToken(bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  try {
    const supabase = createMcpUserClient(bearerToken);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return undefined;
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    const role = (roleData?.role as string) ?? 'viewer';
    return {
      token: bearerToken,
      clientId: 'mcp-client',
      scopes: [],
      extra: { userId: user.id, email: user.email, role },
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Server setup (module-level — runs once per cold start)
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: 'knowledge-hub', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

registerTools(server);
registerResources(server);
registerPrompts(server);

server.registerTool(
  'ping',
  {
    title: 'Ping',
    description: 'Health check — returns server status.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => ({
    content: [{ type: 'text' as const, text: 'Knowledge Hub MCP server is running.' }],
  }),
);

console.log('[MCP-TEST5] Server created and tools registered');

// ---------------------------------------------------------------------------
// Request handler — creates a fresh transport per request
// ---------------------------------------------------------------------------

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://knowledge-hub-seven-kappa.vercel.app';

async function handleMcpRequest(request: Request): Promise<Response> {
  // Auth: extract and verify bearer token
  const authHeader = request.headers.get('Authorization');
  const [type, token] = authHeader?.split(' ') ?? [];
  const bearerToken = type?.toLowerCase() === 'bearer' ? token : undefined;

  const authInfo = await verifyToken(bearerToken);

  if (!authInfo) {
    return new Response(
      JSON.stringify({ error: 'invalid_token', error_description: 'No authorization provided' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_URL}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }

  // Create a fresh stateless transport for each request
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  // Connect server to transport
  await server.connect(transport);

  try {
    // The SDK handles the full JSON-RPC flow and returns a Web Response
    const response = await transport.handleRequest(request, { authInfo });
    return response;
  } finally {
    // Clean up: close transport after request completes
    await transport.close();
  }
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
