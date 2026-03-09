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
    registerTools(server);
    registerResources(server);
    registerPrompts(server);
  },
  {
    capabilities: {},
  },
  {
    basePath: '/api/mcp',
    maxDuration: 60,
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

    return {
      token: bearerToken,
      clientId: 'mcp-client',
      scopes: [],
      extra: { userId: user.id, email: user.email },
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

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
