/**
 * Quality tool registrations (1 tool):
 *  31. suggest_content_creation  (KEPT — the callable resolution affordance the
 *      `where_are_we_exposed` gaps/opportunities layers reference, B-INV-4)
 *
 * ID-71.8 (M29/M4, B-INV-4/29) retired the former exposure reads in this file
 * — `get_quality_summary`, `get_coverage_gaps`, `audit_content`,
 * `get_quality_briefing`, `get_quality_actions` — into the consolidated
 * `where_are_we_exposed` five-layer entry (lib/mcp/tools/dashboard.ts).
 * ID-71.10 (M32, B-INV-32 dedup portion) consolidated the former
 * `find_all_duplicates` batch dedup read into the `find_duplicates` entry
 * co-located with `findSimilarItemsImpl` in lib/mcp/tools/search.ts.
 * ID-131.15 (G-DEDUP legacy dedup-family retirement, S446) later removed
 * that batch-scan branch entirely (the find_duplicate_pairs RPC it depended
 * on was dropped) — the id-120 q_a_pairs batch dedup-proposer is its
 * replacement. `suggest_content_creation` is the kept resolution affordance.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpClient } from '@/lib/mcp/auth';
import { truncateResponse } from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerQualityTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // 31. suggest_content_creation
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'suggest_content_creation',
    {
      title: 'Suggest Content to Create',
      description:
        'Analyse coverage gaps and suggest specific content to create. Returns prioritised suggestions based on empty subtopics, thin coverage, stale content, and template gaps. Use this to identify what content the knowledge base most needs.',
      inputSchema: {
        domain: z
          .string()
          .optional()
          .describe('Filter suggestions to a specific domain'),
        limit: z
          .number()
          .optional()
          .transform((v) => (v != null ? Math.max(1, Math.min(20, v)) : v))
          .describe('Maximum suggestions to return (default: 10)'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const supabase = createMcpClient(extra.authInfo);
        const { generateContentSuggestions } =
          await import('@/lib/content/content-suggestions');

        const suggestions = await generateContentSuggestions({
          supabase,
          maxSuggestions: args.limit ?? 10,
          domainFilter: args.domain || undefined,
          includeTemplateGaps: true,
        });

        if (suggestions.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: '# Content Suggestions\n\nNo content gaps found. The knowledge base has good coverage across all taxonomy subtopics.',
              },
            ],
            structuredContent: toStructuredContent({
              suggestions: [],
              count: 0,
            }),
          };
        }

        // Format as Markdown
        const lines: string[] = [
          '# Content Suggestions',
          '',
          `Found **${suggestions.length}** content creation ${suggestions.length === 1 ? 'opportunity' : 'opportunities'}:`,
          '',
        ];

        for (let i = 0; i < suggestions.length; i++) {
          const s = suggestions[i];
          lines.push(`## ${i + 1}. ${s.title}`);
          lines.push(`**Domain:** ${s.domain} > ${s.subtopic}`);
          lines.push(
            `**Priority:** ${s.priority} | **Type:** ${s.suggestion_type.replace(/_/g, ' ')}`,
          );
          if (s.suggested_content_type) {
            lines.push(
              `**Suggested content type:** ${s.suggested_content_type}`,
            );
          }
          if (s.related_template) {
            lines.push(`**Related template:** ${s.related_template}`);
          }
          lines.push(`**Current items:** ${s.item_count}`);
          if (s.freshness_breakdown) {
            const fb = s.freshness_breakdown;
            lines.push(
              `**Freshness:** ${fb.fresh} fresh, ${fb.aging} aging, ${fb.stale} stale, ${fb.expired} expired`,
            );
          }
          lines.push('');
          lines.push(s.description);
          lines.push('');
        }

        const markdown = truncateResponse(lines.join('\n'));

        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent({
            suggestions,
            count: suggestions.length,
          }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Content suggestion analysis failed: ${message}.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
