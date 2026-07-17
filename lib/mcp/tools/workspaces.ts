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
        'List workspaces visible to the authenticated user. Optionally filter by application type (intelligence, sales_proposal, product_guide, competitor_research, training_onboarding). Procurement is no longer a workspace-resolved domain (ID-145 form-first re-architecture, W1e) — filtering by "procurement" or the legacy "bid" alias returns guidance to use list_active_procurement / get_procurement_detail instead of workspace rows. Returns id, name, and type for each non-archived workspace. Used by daily-briefing skill to resolve intelligence workspace before calling get_intelligence_summary. Viewer role or above required.',
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
            'Filter to a specific application type. "procurement" and the legacy "bid" alias no longer resolve to workspace rows (ID-145 W1e) — use list_active_procurement / get_procurement_detail for procurement data instead. Omit to list all types.',
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

        // ID-145 {145.39} (DR-038 form-first): procurement is no longer a
        // workspace-resolved domain post-W1e — the `workspaces` table's
        // procurement rows were wholesale-dropped (536->28 rows,
        // 20260712064000_id145_w1e_drop_workspace_stratum.sql), so a
        // type=procurement|bid query against `application_types.key` would
        // always silently return zero rows. Per id-71 RESEARCH.md §2.2 this
        // tool survives as workspace-resolver substrate ("keep-concept,
        // refine") for the OTHER application types — id-71 does not re-shape
        // this query onto `form_instances`. Surface the gap explicitly and
        // redirect callers to the {145.21} form-first tools rather than
        // synthesising fake workspace rows from form_instances.
        if (args.type === 'procurement' || args.type === 'bid') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Procurement is no longer a workspace-resolved domain (ID-145 form-first re-architecture dropped the procurement workspace stratum). Use `list_active_procurement` to list procurement forms, or `get_procurement_detail` for a specific one, instead of `list_user_workspaces`.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);

        // Post-T2: discriminator is application_types.key via JOIN, not the
        // dropped workspaces.type col. The enum mirrors the seeded
        // application_types vocabulary for the non-procurement domains
        // (procurement/bid are short-circuited above).
        let query = supabase
          .from('workspaces')
          .select('id, name, application_types!inner(key)')
          .eq('is_archived', false);

        if (args.type) {
          query = query.eq('application_types.key', args.type);
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
