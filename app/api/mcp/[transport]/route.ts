/**
 * MCP server route handler for Knowledge Hub.
 *
 * Serves the MCP protocol over HTTP (Streamable HTTP + SSE transports)
 * via the mcp-handler library. The [transport] dynamic segment routes
 * to the correct transport handler.
 *
 * Endpoint: /api/mcp/[transport]
 *   - /api/mcp/mcp   → Streamable HTTP transport
 *   - /api/mcp/sse   → SSE transport (legacy)
 *   - /api/mcp/message → SSE message endpoint (legacy)
 */
import { createMcpHandler } from 'mcp-handler';
import { registerTools } from '@/lib/mcp/tools';

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    capabilities: {},
  },
  {
    basePath: '/api/mcp',
    maxDuration: 60,
  },
);

export { handler as GET, handler as POST, handler as DELETE };
