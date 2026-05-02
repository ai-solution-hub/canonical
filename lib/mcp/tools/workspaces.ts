/**
 * Workspace tool registrations (1 tool):
 *   list_user_workspaces
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient, checkMcpRole } from '@/lib/mcp/auth';
import { sb } from '@/lib/supabase/safe';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerWorkspaceTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // list_user_workspaces
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'list_user_workspaces',
    {
      title: 'List User Workspaces',
      description:
        'List workspaces visible to the authenticated user. Optionally filter by workspace type (intelligence, bid, content). Returns id, name, type, and archived status for each workspace. Used by daily-briefing skill to resolve intelligence workspace before calling get_intelligence_summary. Viewer role or above required.',
      inputSchema: {
        type: z
          .enum(['intelligence', 'bid', 'content'])
          .optional()
          .describe(
            'Filter to a specific workspace type. Omit to list all types.',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        // Viewer+ role gate
        const role = await checkMcpRole(extra.authInfo, [
          'admin',
          'editor',
          'viewer',
        ]);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: authenticated user role required to list workspaces.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);

        let query = supabase
          .from('workspaces')
          .select('id, name, type')
          .eq('is_archived', false);

        if (args.type) {
          // Map 'content' filter to the DB enum value 'kb_section'
          const dbType = args.type === 'content' ? 'kb_section' : args.type;
          query = query.eq('type', dbType);
        }

        const workspaces = await sb(
          query.order('name', { ascending: true }),
          'mcp.tools.list_user_workspaces',
        );

        const result = workspaces.map(
          (ws: { id: string; name: string; type: string }) => ({
            id: ws.id,
            name: ws.name,
            type: ws.type,
          }),
        );

        const markdown =
          result.length === 0
            ? 'No workspaces found.'
            : [
                `## Workspaces (${result.length})`,
                '',
                '| Name | Type | ID |',
                '|------|------|----|',
                ...result.map(
                  (ws: { name: string; type: string; id: string }) =>
                    `| ${ws.name} | ${ws.type} | ${ws.id.slice(0, 8)}... |`,
                ),
              ].join('\n');

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({ workspaces: result }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to list workspaces: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
