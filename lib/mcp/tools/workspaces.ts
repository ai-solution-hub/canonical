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
        'List workspaces visible to the authenticated user. Optionally filter by application type (procurement, intelligence, sales_proposal, product_guide, competitor_research, training_onboarding; legacy "bid" is accepted as an alias for procurement). Returns id, name, and type for each non-archived workspace. Used by daily-briefing skill to resolve intelligence workspace before calling get_intelligence_summary. Viewer role or above required.',
      inputSchema: {
        type: z
          .enum([
            'procurement',
            'intelligence',
            'sales_proposal',
            'product_guide',
            'competitor_research',
            'training_onboarding',
            'bid',
          ])
          .optional()
          .describe(
            "Filter to a specific application type. Legacy value 'bid' is accepted as an alias for 'procurement'. Omit to list all types.",
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

        // Post-T2: discriminator is application_types.key via JOIN, not the
        // dropped workspaces.type col. The enum mirrors the seeded
        // application_types vocabulary; 'bid' survives only as a legacy alias
        // (Q-OQR1-02) — the retired 'content'/'kb_section' value was dropped
        // under ID-71 {71.5}.
        let query = supabase
          .from('workspaces')
          .select('id, name, application_types!inner(key)')
          .eq('is_archived', false);

        if (args.type) {
          const typeFilter = args.type === 'bid' ? 'procurement' : args.type;
          query = query.eq('application_types.key', typeFilter);
        }

        const workspaces = await sb(
          query.order('name', { ascending: true }),
          'mcp.tools.list_user_workspaces',
        );

        type WorkspaceRow = {
          id: string;
          name: string;
          application_types: { key: string } | { key: string }[] | null;
        };
        const result = (workspaces as unknown as WorkspaceRow[]).map((ws) => {
          const appType = Array.isArray(ws.application_types)
            ? (ws.application_types[0] ?? null)
            : ws.application_types;
          return {
            id: ws.id,
            name: ws.name,
            type: appType?.key ?? 'unknown',
          };
        });

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
