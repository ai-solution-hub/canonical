/**
 * MCP server route handler for Knowledge Hub.
 *
 * Uses the MCP SDK's WebStandardStreamableHTTPServerTransport directly
 * (not mcp-handler) for reliable operation on Vercel serverless. The
 * mcp-handler library has a bug where its shared Node.js transport gets
 * corrupted on warm function instances, causing 500 errors on the second
 * request (typically tools/list after initialize).
 *
 * Authentication: Supabase OAuth 2.1. Bearer tokens are validated via
 * supabase.auth.getUser(). Unauthenticated requests receive 401 with a
 * WWW-Authenticate header pointing to the Protected Resource Metadata.
 *
 * Endpoint: /api/mcp/[transport]
 *   - /api/mcp/mcp → Streamable HTTP transport (primary)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpUserClient } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';
import { registerResources, registerPrompts } from '@/lib/mcp/resources';

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  'https://knowledge-hub-seven-kappa.vercel.app';

// ---------------------------------------------------------------------------
// Auth — verify Supabase OAuth bearer tokens
// ---------------------------------------------------------------------------

async function verifyToken(
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  try {
    const supabase = createMcpUserClient(bearerToken);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) return undefined;

    // Cache user role in authInfo to avoid extra DB query per tool call
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
// Server factory — creates a fresh McpServer with all tools/resources/prompts
// ---------------------------------------------------------------------------

async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer(
    { name: 'knowledge-hub', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  await registerTools(server);
  await registerResources(server);
  registerPrompts(server);

  return server;
}

// ---------------------------------------------------------------------------
// Request handler — fresh server + transport per request
// ---------------------------------------------------------------------------

async function handleMcpRequest(request: Request): Promise<Response> {
  // Extract and verify bearer token
  const authHeader = request.headers.get('Authorization');
  const [type, token] = authHeader?.split(' ') ?? [];
  const bearerToken = type?.toLowerCase() === 'bearer' ? token : undefined;

  const authInfo = await verifyToken(bearerToken);

  if (!authInfo) {
    return new Response(
      JSON.stringify({
        error: 'invalid_token',
        error_description: 'No authorization provided',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${RESOURCE_URL}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }

  // Create fresh server + transport for each request.
  // This avoids the mcp-handler bug where shared transports get corrupted
  // on warm Vercel serverless instances.
  const server = await createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // Pass authInfo so tool callbacks can access it via extra.authInfo
  return await transport.handleRequest(request, { authInfo });
}

// Vercel serverless function config
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    return await handleMcpRequest(request);
  } catch (err) {
    console.error('MCP GET handler error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
export async function POST(request: Request) {
  try {
    return await handleMcpRequest(request);
  } catch (err) {
    console.error('MCP POST handler error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
export async function DELETE(request: Request) {
  try {
    return await handleMcpRequest(request);
  } catch (err) {
    console.error('MCP DELETE handler error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
