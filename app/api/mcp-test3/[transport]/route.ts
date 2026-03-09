/**
 * MCP test route 3 — auth + full tools + resources.
 * Identical to production route but with verbose error logging.
 *
 * curl test:
 * curl -X POST https://knowledge-hub-seven-kappa.vercel.app/api/mcp-test3/mcp \
 *   -H "Content-Type: application/json" \
 *   -H "Accept: application/json, text/event-stream" \
 *   -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":1}'
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { createMcpUserClient } from '@/lib/mcp/auth';
import { registerTools } from '@/lib/mcp/tools';
import { registerResources, registerPrompts } from '@/lib/mcp/resources';

console.log('[MCP-TEST3] Module loaded — imports succeeded');

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://knowledge-hub-seven-kappa.vercel.app';

let handler: (request: Request) => Promise<Response>;
try {
  console.log('[MCP-TEST3] Creating handler...');
  handler = createMcpHandler(
    (server) => {
      console.log('[MCP-TEST3] Initialization callback called');
      try {
        registerTools(server);
        console.log('[MCP-TEST3] Tools registered');
      } catch (err) {
        console.error('[MCP-TEST3] Failed to register tools:', err);
      }
      try {
        registerResources(server);
        console.log('[MCP-TEST3] Resources registered');
      } catch (err) {
        console.error('[MCP-TEST3] Failed to register resources:', err);
      }
      try {
        registerPrompts(server);
        console.log('[MCP-TEST3] Prompts registered');
      } catch (err) {
        console.error('[MCP-TEST3] Failed to register prompts:', err);
      }

      server.registerTool(
        'ping',
        {
          title: 'Ping',
          description: 'Health check.',
          annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
        },
        async () => ({
          content: [{ type: 'text' as const, text: 'MCP test3 is running (full route).' }],
        }),
      );
    },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: 'knowledge-hub-test3', version: '0.0.1' },
    },
    {
      basePath: '/api/mcp-test3',
      verboseLogs: true,
    },
  );
  console.log('[MCP-TEST3] Handler created');
} catch (err) {
  console.error('[MCP-TEST3] FATAL: Handler creation failed:', err);
  handler = async () =>
    new Response(JSON.stringify({ error: 'Handler creation failed', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
}

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

export const maxDuration = 60;

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
