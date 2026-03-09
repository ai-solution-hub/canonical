/**
 * MCP test route 4 — full tools + resources but NO auth.
 * Tests whether tools/list crashes during Zod schema serialization.
 */
import { createMcpHandler } from 'mcp-handler';
import { registerTools } from '@/lib/mcp/tools';
import { registerResources, registerPrompts } from '@/lib/mcp/resources';

console.log('[MCP-TEST4] Module loaded');

const handler = createMcpHandler(
  (server) => {
    console.log('[MCP-TEST4] Init callback called');
    try {
      registerTools(server);
      console.log('[MCP-TEST4] Tools registered OK');
    } catch (err) {
      console.error('[MCP-TEST4] Tools failed:', err);
    }
    try {
      registerResources(server);
      console.log('[MCP-TEST4] Resources registered OK');
    } catch (err) {
      console.error('[MCP-TEST4] Resources failed:', err);
    }
    try {
      registerPrompts(server);
      console.log('[MCP-TEST4] Prompts registered OK');
    } catch (err) {
      console.error('[MCP-TEST4] Prompts failed:', err);
    }
  },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    serverInfo: { name: 'knowledge-hub-test4', version: '0.0.1' },
  },
  {
    basePath: '/api/mcp-test4',
    verboseLogs: true,
  },
);

export const maxDuration = 60;

export { handler as GET, handler as POST, handler as DELETE };
