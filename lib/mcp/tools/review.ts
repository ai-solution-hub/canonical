/**
 * Review workflow tool registrations (3 tools — S180 WP3 / P0-23 A1):
 *  get_review_queue
 *  get_assignments_for_user
 *  create_review_assignment
 *
 * All three wrap existing API routes:
 *  - GET /api/review/queue
 *  - GET /api/review/assignments (listing)
 *  - POST /api/review/assignments (creation, admin-only)
 *
 * The read tools require editor+ role. Non-admin callers of
 * `get_assignments_for_user` are auto-scoped to their own `reviewer_id`
 * regardless of the `reviewer_id` arg — mirrors API route behaviour.
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
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  formatReviewQueue,
  formatReviewAssignments,
  formatCreateReviewAssignment,
} from '@/lib/mcp/formatters';
import type {
  ReviewQueueToolData,
  ReviewQueueToolItem,
  ReviewAssignmentSummary,
  ReviewAssignmentsData,
  CreateReviewAssignmentResult,
} from '@/lib/mcp/formatters';
import {
  type ToolExtra,
  toStructuredContent,
  defineTool,
  NON_IDEMPOTENT_WRITE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from './shared';

export async function registerReviewTools(server: McpServer): Promise<void> {
  // -------------------------------------------------------------------------
  // get_review_queue (read-only — editor+)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_review_queue',
    {
      title: 'Get Review Queue',
      description:
        'List content items in the review queue. Filter by verification status, domain, content type. Used by review / daily-briefing skills to triage what needs reviewer attention. Flagged status is not yet available via MCP — the web review queue covers that sub-workflow. Editor or admin role required.',
      inputSchema: {
        status: z
          .enum(['unverified', 'verified', 'flagged', 'draft', 'all'])
          .default('unverified')
          .describe(
            'Verification-status filter. Note: "flagged" returns a friendly not-yet-available message — use the web review queue for flagged items.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe('Maximum items to return (default 20, max 100)'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Offset for pagination (default 0)'),
        domain: z
          .string()
          .optional()
          .describe('Optional primary_domain filter'),
        content_type: z
          .string()
          .optional()
          .describe('Optional content_type filter'),
        sort: z
          .enum(['created_at', 'confidence_asc', 'quality_score_asc'])
          .optional()
          .describe('Sort order (default created_at desc)'),
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
                text: 'Permission denied: editor or admin role required to read the review queue.',
              },
            ],
            isError: true,
          };
        }

        if (args.status === 'flagged') {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Flagged items view is not yet available via MCP. Use the web review queue (Status: Flagged) for flagged items — the route joins `ingestion_quality_log` and is not yet mirrored here. All other statuses (unverified, verified, draft, all) work as expected.',
              },
            ],
          };
        }

        const supabase = createMcpClient(extra.authInfo);

        // Mirror the non-flagged path of app/api/review/queue/route.ts.
        // Column list matches the REVIEW_COLUMNS in the route but trimmed
        // to the fields the formatter + structured payload actually consume.
        const selectCols =
          'id, title, suggested_title, primary_domain, content_type, quality_score, classification_confidence, verified_at, governance_review_status';

        let query = supabase
          .from('content_items')
          .select(selectCols, { count: 'exact' });

        // S202 §5.2 Phase 2.5 (T8b) — read filters target the new
        // publication_status (NOT NULL post-S201). SELECT clause + response
        // shape (lines 125, 191, 246) intentionally retain
        // governance_review_status until Phase 1f NULLs the legacy column.
        if (args.status === 'draft') {
          query = query.eq('publication_status', 'draft');
        } else {
          query = query.neq('publication_status', 'draft');
        }

        if (args.status === 'unverified') {
          query = query.is('verified_at', null);
        } else if (args.status === 'verified') {
          query = query.not('verified_at', 'is', null);
        }

        if (args.domain) {
          query = query.eq('primary_domain', args.domain);
        }
        if (args.content_type) {
          query = query.eq('content_type', args.content_type);
        }

        if (args.sort === 'confidence_asc') {
          query = query.order('classification_confidence', {
            ascending: true,
            nullsFirst: true,
          });
        } else if (args.sort === 'quality_score_asc') {
          query = query.order('quality_score', {
            ascending: true,
            nullsFirst: true,
          });
        } else {
          query = query.order('created_at', { ascending: false });
        }
        query = query.order('id', { ascending: true });
        query = query.range(args.offset, args.offset + args.limit - 1);

        const { data, error, count } = await query;

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch review queue: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        const rows = (data ?? []) as Array<{
          id: string;
          title: string | null;
          suggested_title: string | null;
          primary_domain: string | null;
          content_type: string | null;
          quality_score: number | null;
          classification_confidence: number | null;
          verified_at: string | null;
          governance_review_status: string | null;
        }>;

        // Batch-fetch last-reviewed dates from verification_history. This is
        // a display nicety — a query failure degrades the output (items show
        // no last-reviewed date) but must not fail the whole tool, so we
        // surface the failure via `logBestEffortWarn` (Sentry breadcrumb +
        // console.warn) rather than aborting the response.
        const itemIds = rows.map((r) => r.id);
        const reviewDates = new Map<string, string>();
        if (itemIds.length > 0) {
          const { data: vhData, error: vhError } = await supabase
            .from('verification_history')
            .select('content_item_id, performed_at')
            .in('content_item_id', itemIds)
            .order('performed_at', { ascending: false });
          if (vhError) {
            logBestEffortWarn(
              'mcp.review.last_reviewed_lookup',
              'verification_history lookup failed in get_review_queue',
              { error: vhError.message, item_count: itemIds.length },
            );
          }
          for (const row of (vhData ?? []) as Array<{
            content_item_id: string;
            performed_at: string;
          }>) {
            if (!reviewDates.has(row.content_item_id)) {
              reviewDates.set(row.content_item_id, row.performed_at);
            }
          }
        }

        // Supplementary counts — match the route's progress-bar payload.
        const [verifiedResult, flaggedResult] = await Promise.all([
          supabase
            .from('content_items')
            .select('id', { count: 'exact', head: true })
            .not('verified_at', 'is', null),
          supabase
            .from('ingestion_quality_log')
            .select('content_item_id', { count: 'exact', head: true })
            .eq('flag_type', 'review_needed')
            .eq('resolved', false),
        ]);

        const items: ReviewQueueToolItem[] = rows.map((row) => ({
          id: row.id,
          title: row.title,
          suggested_title: row.suggested_title,
          primary_domain: row.primary_domain,
          content_type: row.content_type,
          quality_score: row.quality_score,
          classification_confidence: row.classification_confidence,
          verified_at: row.verified_at,
          governance_review_status: row.governance_review_status,
          last_reviewed_at: reviewDates.get(row.id) ?? null,
        }));

        const result: ReviewQueueToolData = {
          items,
          total: count ?? items.length,
          verified_count: verifiedResult.count ?? 0,
          flagged_count: flaggedResult.count ?? 0,
          offset: args.offset,
          limit: args.limit,
          status: args.status,
          domain_filter: args.domain ?? null,
          content_type_filter: args.content_type ?? null,
        };

        const markdown = formatReviewQueue(result);
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
              text: `Review queue read failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------------------------
  // get_assignments_for_user (read-only — editor+; non-admin auto-scoped)
  // -------------------------------------------------------------------------
  defineTool(
    server,
    'get_assignments_for_user',
    {
      title: 'Get Review Assignments',
      description:
        'List review assignments. Non-admin callers see only their own assignments regardless of the reviewer_id arg. Admin callers can query any reviewer or omit the filter to see all assignments. Filter by status: active (default) / completed / cancelled / all. Editor or admin role required.',
      inputSchema: {
        status: z
          .enum(['active', 'completed', 'cancelled', 'all'])
          .default('active')
          .describe('Assignment status filter'),
        reviewer_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            'Filter to a specific reviewer (admin-only — non-admin callers are always auto-scoped to themselves regardless of this value).',
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
                text: 'Permission denied: editor or admin role required to read review assignments.',
              },
            ],
            isError: true,
          };
        }

        const supabase = createMcpClient(extra.authInfo);
        const userId = getMcpUserId(extra.authInfo);
        const userRole = await getMcpUserRole(extra.authInfo!);

        let query = supabase
          .from('review_assignments')
          .select('*')
          .order('created_at', { ascending: false });

        // Non-admins are auto-scoped to self regardless of the arg — matches
        // app/api/review/assignments/route.ts:55-57.
        let scope: 'self' | 'all' | 'reviewer' = 'all';
        let targetReviewerId: string | null = null;
        if (userRole !== 'admin') {
          if (userId) {
            query = query.eq('reviewer_id', userId);
          }
          scope = 'self';
          targetReviewerId = userId ?? null;
        } else if (args.reviewer_id) {
          query = query.eq('reviewer_id', args.reviewer_id);
          scope = 'reviewer';
          targetReviewerId = args.reviewer_id;
        }

        if (args.status !== 'all') {
          query = query.eq('status', args.status);
        }

        const { data, error } = await query;

        if (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Failed to fetch assignments: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        const assignments = (data ?? []) as ReviewAssignmentSummary[];
        const result: ReviewAssignmentsData = {
          assignments,
          status_filter: args.status,
          scope,
          target_reviewer_id: targetReviewerId,
        };

        const markdown = formatReviewAssignments(result);
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
              text: `Assignments read failed: ${message}`,
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

        let countQuery = supabase
          .from('content_items')
          .select('id', { count: 'exact', head: true });

        if (args.filter_domains.length > 0) {
          countQuery = countQuery.in('primary_domain', args.filter_domains);
        }
        if (args.filter_content_types.length > 0) {
          countQuery = countQuery.in('content_type', args.filter_content_types);
        }
        if (args.filter_freshness.length > 0) {
          countQuery = countQuery.in('freshness', args.filter_freshness);
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
