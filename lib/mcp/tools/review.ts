/**
 * Review workflow tool registrations (2 tools):
 *  whats_in_my_queue       (ID-71.9 — M30/OQ-5, B-INV-30; ONE faceted queue
 *                           concept over the lib/attention.ts producer
 *                           substrate, content_quality | governance | all)
 *  create_review_assignment (admin-only write — wraps POST /api/review/assignments)
 *
 * ID-71.9 retired into `whats_in_my_queue`: `get_review_queue`,
 * `get_assignments_for_user` (this file), `get_governance_queue`
 * (governance.ts), `get_dashboard_summary` (dashboard.ts). The /review +
 * /api/governance/review ROUTE layer is UNCHANGED (OQ-5).
 *
 * `create_review_assignment` is admin-only.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createMcpClient,
  checkMcpRole,
  getMcpUserId,
  getMcpUserRole,
} from '@/lib/mcp/auth';
import { tryQuery } from '@/lib/supabase/safe';
import {
  formatCreateReviewAssignment,
  formatWhatsInMyQueue,
} from '@/lib/mcp/formatters';
import type {
  CreateReviewAssignmentResult,
  QueueFacet,
  QueueItem,
  WhatsInMyQueueData,
} from '@/lib/mcp/formatters';
import {
  buildAttentionItems,
  type AttentionItem,
  type AttentionSourceData,
} from '@/lib/attention';
import {
  type ToolExtra,
  toStructuredContent,
  getDashboardModule,
  defineTool,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from './shared';

// ---------------------------------------------------------------------------
// Facet mapping — which AttentionItem.type belongs to which queue facet.
//
// `source_document_change` is deliberately ABSENT (scoped OUT of v1 — it has
// no producer in lib/attention.ts). `procurement_deadline` and `unread_notifications`
// are not queue-review items and are excluded from both facets.
// ---------------------------------------------------------------------------

const FACET_BY_TYPE: Record<string, 'content_quality' | 'governance'> = {
  governance_review: 'governance',
  quality_flag: 'content_quality',
  stale_content: 'content_quality',
  expired_content: 'content_quality',
  unverified_content: 'content_quality',
  coverage_gap: 'content_quality',
  taxonomy_coverage: 'content_quality',
  expiring_content_date: 'content_quality',
  expiring_certification: 'content_quality',
};

function toQueueItem(
  item: AttentionItem,
  facet: 'content_quality' | 'governance',
): QueueItem {
  return {
    id: item.id,
    type: item.type,
    facet,
    severity: item.severity,
    title: item.title,
    detail: item.detail,
    action_url: item.action_url,
    action_label: item.action_label,
    count: item.count,
  };
}

// outputSchema (M37 forward standard, new entry).
const QueueItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  facet: z.enum(['content_quality', 'governance']),
  severity: z.string(),
  title: z.string(),
  detail: z.string(),
  action_url: z.string(),
  action_label: z.string(),
  count: z.number().optional(),
});

const WhatsInMyQueueOutputSchema = {
  facet: z.enum(['content_quality', 'governance', 'all']),
  items: z.array(QueueItemSchema),
  total: z.number(),
  generated_at: z.string(),
};

export async function registerReviewTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // whats_in_my_queue (read-only — editor+)
  //
  // ONE queue concept distinguished by a facet, over the lib/attention.ts
  // producer substrate (B-INV-30 / OQ-5). content-review and governance
  // collapse into one entry; `source_document_change` is scoped OUT of v1.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'whats_in_my_queue',
    {
      title: `What's in my queue`,
      outputSchema: WhatsInMyQueueOutputSchema,
      description:
        'Show what needs my attention as ONE queue, distinguished by a facet. `facet` selects content-quality items (freshness, quality flags, coverage gaps, unverified, expiring) vs governance items (pending governance review), or `all` for both. Items are sorted by severity. Use this to triage the work in front of you. Editor or admin role required.',
      inputSchema: {
        facet: z
          .enum(['content_quality', 'governance', 'all'])
          .default('all')
          .describe(
            'Which queue facet to show: content_quality, governance, or all (default all).',
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin', 'editor']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: editor or admin role required to read the queue.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const userRole = await getMcpUserRole(extra.authInfo!);
        const isAdmin = userRole === 'admin';
        const facet = (args.facet ?? 'all') as QueueFacet;

        // Read the attention source counts, then run the lib/attention.ts
        // producers over them (greenfield read OVER the substrate, not a wrapper).
        const { fetchUnifiedDashboardData } = await getDashboardModule();
        const unified = await fetchUnifiedDashboardData(
          supabase,
          userId,
          isAdmin,
          userRole,
        );
        const sourceData: AttentionSourceData = {
          ...unified.attention_sources,
          active_bids: unified.active_bids,
        };
        const attentionItems = buildAttentionItems(sourceData);

        // Map each producer item to a facet; drop items with no queue facet
        // (procurement_deadline, unread_notifications, source_document_change).
        const queueItems: QueueItem[] = [];
        for (const item of attentionItems) {
          const itemFacet = FACET_BY_TYPE[item.type];
          if (!itemFacet) continue;
          if (facet !== 'all' && itemFacet !== facet) continue;
          queueItems.push(toQueueItem(item, itemFacet));
        }

        const result: WhatsInMyQueueData = {
          facet,
          items: queueItems,
          total: queueItems.length,
          generated_at: new Date().toISOString(),
        };

        const markdown = formatWhatsInMyQueue(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Queue read failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // create_review_assignment (admin-only)
  //
  // Wraps POST /api/review/assignments. Computes the matching item_count via
  // a head-count query over content_items with the supplied filters, inserts
  // the assignment with assigned_by = caller_user_id, then best-effort
  // dispatches a notification to the assignee.
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'create_review_assignment',
    {
      title: 'Create Review Assignment',
      description:
        'Assign content items to a reviewer based on filter criteria. Computes the matching item count automatically from the current content_items state. Notifies the assignee (best-effort — notification failures do not abort assignment creation). Admin role required.',
      inputSchema: {
        reviewer_id: z
          .string()
          .uuid()
          .describe('UUID of the user to assign the review to'),
        filter_domains: z
          .array(z.string())
          .default([])
          .describe(
            'Primary-domain filter (e.g. ["compliance", "audit-content"])',
          ),
        filter_content_types: z
          .array(z.string())
          .default([])
          .describe('content_type filter'),
        filter_freshness: z
          .array(z.string())
          .default([])
          .describe('freshness filter (fresh / aging / stale / expired)'),
        filter_date_from: z
          .string()
          .datetime()
          .nullable()
          .optional()
          .describe('ISO datetime — items captured on or after this date'),
        filter_date_to: z
          .string()
          .datetime()
          .nullable()
          .optional()
          .describe('ISO datetime — items captured on or before this date'),
        due_date: z
          .string()
          .datetime()
          .nullable()
          .optional()
          .describe('ISO datetime — assignment due date'),
        notes: z
          .string()
          .max(500)
          .nullable()
          .optional()
          .describe('Optional notes surfaced to the assignee'),
      },
      annotations: NON_IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async (args, extra: ToolExtra) => {
      try {
        const role = await checkMcpRole(extra.authInfo, ['admin']);
        if (!role) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: admin role required to create review assignments.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        if (!userId) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Permission denied: authenticated user ID missing.',
              },
            ],
            isError: true,
          };
        }

        // ID-131 (G-MCP-REPOINT, BI-9/18): content_items no longer exists —
        // domain/content_type/captured_date all live on source_documents;
        // `freshness` moved to the record_lifecycle facet (source_document
        // owner axis). When a freshness filter is supplied, pre-resolve the
        // matching source_document ids from the facet and constrain the
        // source_documents count query to them.
        let matchingSourceDocIds: string[] | null = null;
        if (args.filter_freshness.length > 0) {
          const freshnessRows = await tryQuery(
            supabase
              .from('record_lifecycle')
              .select('source_document_id')
              .eq('owner_kind', 'source_document')
              .in('freshness', args.filter_freshness),
            'mcp.review.create_review_assignment.freshness_filter',
          );
          if (!freshnessRows.ok) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Failed to compute item count for assignment: ${freshnessRows.error.message}`,
                },
              ],
              isError: true,
            };
          }
          matchingSourceDocIds = (
            freshnessRows.data as Array<{ source_document_id: string | null }>
          )
            .map((row) => row.source_document_id)
            .filter((id): id is string => !!id);
        }

        let countQuery = supabase
          .from('source_documents')
          .select('id', { count: 'exact', head: true });

        if (args.filter_domains.length > 0) {
          countQuery = countQuery.in('primary_domain', args.filter_domains);
        }
        if (args.filter_content_types.length > 0) {
          countQuery = countQuery.in('content_type', args.filter_content_types);
        }
        if (matchingSourceDocIds !== null) {
          countQuery = countQuery.in('id', matchingSourceDocIds);
        }
        if (args.filter_date_from) {
          countQuery = countQuery.gte('captured_date', args.filter_date_from);
        }
        if (args.filter_date_to) {
          countQuery = countQuery.lte('captured_date', args.filter_date_to);
        }

        const { count: itemCount, error: countError } = await countQuery;
        if (countError) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to compute item count for assignment: ${countError.message}`,
              },
            ],
            isError: true,
          };
        }

        const { data: assignment, error: insertError } = await supabase
          .from('review_assignments')
          .insert({
            reviewer_id: args.reviewer_id,
            assigned_by: userId,
            assignment_type: 'manual',
            filter_domains: args.filter_domains,
            filter_content_types: args.filter_content_types,
            filter_freshness: args.filter_freshness,
            filter_date_from: args.filter_date_from ?? null,
            filter_date_to: args.filter_date_to ?? null,
            item_count: itemCount ?? 0,
            due_date: args.due_date ?? null,
            notes: args.notes ?? null,
          })
          .select('*')
          .single();

        if (insertError || !assignment) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to create review assignment: ${
                  insertError?.message ?? 'insert returned no row'
                }`,
              },
            ],
            isError: true,
          };
        }

        // Best-effort notification — lazy import createNotification.
        let notificationSent = true;
        let notificationError: string | null = null;
        try {
          const { createNotification } = await import('@/lib/notifications');
          const { error: notifError } = await createNotification({
            supabase,
            userId: args.reviewer_id,
            type: 'governance_review_needed',
            entityType: 'content_item',
            entityId: assignment.id,
            title: 'New review assignment',
            message: args.notes
              ? `Review assignment: ${args.notes}`
              : `You have been assigned ${itemCount ?? 0} items to review.`,
          });
          if (notifError) {
            notificationSent = false;
            notificationError = notifError.message;
          }
        } catch (err) {
          notificationSent = false;
          notificationError =
            err instanceof Error ? err.message : 'Unknown error';
        }

        const result: CreateReviewAssignmentResult = {
          id: assignment.id,
          reviewer_id: args.reviewer_id,
          assigned_by: userId,
          item_count: itemCount ?? 0,
          due_date: args.due_date ?? null,
          filter_domains: args.filter_domains,
          filter_content_types: args.filter_content_types,
          filter_freshness: args.filter_freshness,
          filter_date_from: args.filter_date_from ?? null,
          filter_date_to: args.filter_date_to ?? null,
          notes: args.notes ?? null,
          notification_sent: notificationSent,
          notification_error: notificationError,
        };

        const markdown = formatCreateReviewAssignment(result);
        return {
          content: [{ type: 'text' as const, text: markdown }],
          structuredContent: toStructuredContent(result),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: `Create review assignment failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
