/**
 * MCP test route 2 — adds withMcpAuth + our auth module.
 * Tests whether the crash is in auth or in tools/resources.
 *
 * curl test:
 * curl -X POST https://knowledge-hub-seven-kappa.vercel.app/api/mcp-test2/mcp \
 *   -H "Content-Type: application/json" \
 *   -H "Accept: application/json, text/event-stream" \
 *   -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { createMcpUserClient } from '@/lib/mcp/auth';

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://knowledge-hub-seven-kappa.vercel.app';

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'ping',
      {
        title: 'Ping',
        description: 'Health check — returns server status.',
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async () => ({
        content: [{ type: 'text' as const, text: 'MCP test2 server is running (with auth imports).' }],
      }),
    );
  },
  {
    capabilities: { tools: {} },
    serverInfo: { name: 'knowledge-hub-test2', version: '0.0.1' },
  },
  {
    basePath: '/api/mcp-test2',
    verboseLogs: true,
  },
);

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
      extra: { userId: user.id, email: user.email, role: 'viewer' },
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

export const maxDuration = 60;

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
