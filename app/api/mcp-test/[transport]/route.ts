/**
 * Minimal MCP test route — zero dependencies from our codebase.
 * Used to isolate whether the 500 crash is in mcp-handler/SDK or in our code.
 *
 * Test with: curl -X POST https://knowledge-hub-seven-kappa.vercel.app/api/mcp-test/mcp \
 *   -H "Content-Type: application/json" \
 *   -d '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{},"clientInfo":{"name":"test","version":"1.0"},"protocolVersion":"2025-03-26"},"id":1}'
 *
 * Then: curl -X POST https://knowledge-hub-seven-kappa.vercel.app/api/mcp-test/mcp \
 *   -H "Content-Type: application/json" \
 *   -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
 */
import { createMcpHandler } from 'mcp-handler';

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
        content: [{ type: 'text' as const, text: 'MCP test server is running.' }],
      }),
    );
  },
  {
    capabilities: { tools: {} },
    serverInfo: { name: 'knowledge-hub-test', version: '0.0.1' },
  },
  {
    basePath: '/api/mcp-test',
    verboseLogs: true,
  },
);

export const maxDuration = 60;

export { handler as GET, handler as POST, handler as DELETE };
