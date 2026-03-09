/**
 * MCP server route handler for Knowledge Hub.
 *
 * Serves the MCP protocol over HTTP (Streamable HTTP + SSE transports)
 * via the mcp-handler library. The [transport] dynamic segment routes
 * to the correct transport handler.
 *
 * Authentication: Uses Supabase OAuth 2.1 via withMcpAuth. Unauthenticated
 * requests are rejected with 401 and directed to the Supabase auth server.
 *
 * Endpoint: /api/mcp/[transport]
 *   - /api/mcp/mcp   → Streamable HTTP transport
 *   - /api/mcp/sse   → SSE transport (legacy)
 *   - /api/mcp/message → SSE message endpoint (legacy)
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { createMcpUserClient } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';
import { registerResources, registerPrompts } from '@/lib/mcp/resources';

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://knowledge-hub-seven-kappa.vercel.app';

const handler = createMcpHandler(
  (server) => {
    try {
      registerTools(server);
    } catch (err) {
      console.error('[MCP] Failed to register tools:', err);
    }
    try {
      registerResources(server);
    } catch (err) {
      console.error('[MCP] Failed to register resources:', err);
    }
    try {
      registerPrompts(server);
    } catch (err) {
      console.error('[MCP] Failed to register prompts:', err);
    }

    // Diagnostic tool — always available, no dependencies
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
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
    serverInfo: {
      name: 'knowledge-hub',
      version: '1.0.0',
    },
  },
  {
    basePath: '/api/mcp',
    maxDuration: 60,
    disableSse: false,
    verboseLogs: true,
    onEvent: (event: { type: string; error?: unknown; context?: unknown }) => {
      if (event.type === 'ERROR') {
        console.error('[MCP]', event.error, event.context);
      }
    },
  },
);

/**
 * Verify a bearer token by creating a Supabase client and calling getUser().
 * Returns AuthInfo on success, undefined on failure.
 */
async function verifyToken(
  _req: Request,
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

const authedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource',
  resourceUrl: RESOURCE_URL,
});

// Vercel serverless function config — default is 10s which causes silent 500s
// on cold starts with heavy imports. MCP needs longer for tool execution.
export const maxDuration = 60;

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
