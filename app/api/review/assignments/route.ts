import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createNotification } from '@/lib/notifications';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody, parseSearchParams } from '@/lib/validation';
import {
  AssignmentsResponseSchema,
  ReviewAssignmentBodySchema,
  ReviewAssignmentUpdateSchema,
  ReviewAssignmentsParamsSchema,
} from '@/lib/validation/schemas';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

type ReviewAssignmentUpdate =
  Database['public']['Tables']['review_assignments']['Update'];

export const GET = defineRoute(
  AssignmentsResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase, role } = auth;

      const { allowed } = checkRateLimit(
        `review-assignments:${user.id}`,
        30,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const parsed = parseSearchParams(
        ReviewAssignmentsParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const statusFilter = parsed.data.status;

      let query = supabase
        .from('review_assignments')
        .select('*')
        .order('created_at', { ascending: false });

      // Non-admins only see their own assignments
      if (role !== 'admin') {
        query = query.eq('reviewer_id', user.id);
      }

      // Apply status filter
      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) {
        logger.error({ err: error }, 'Failed to fetch review assignments');
        return NextResponse.json(
          { error: 'Failed to fetch review assignments' },
          { status: 500 },
        );
      }

      return NextResponse.json({ assignments: data ?? [] });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch review assignments') },
        { status: 500 },
      );
    }
  },
);

/** A `review_assignments` row as returned by `.select('*').single()` on
 *  create (POST) / update (PATCH). Both methods return `{ assignment: <row> }`. */
const ReviewAssignmentRowSchema = z.object({
  id: z.string(),
  reviewer_id: z.string(),
  assigned_by: z.string().nullable(),
  assignment_type: z.string().nullable().optional(),
  filter_domains: z.array(z.string()).nullable(),
  filter_content_types: z.array(z.string()).nullable(),
  filter_freshness: z.array(z.string()).nullable(),
  filter_date_from: z.string().nullable().optional(),
  filter_date_to: z.string().nullable().optional(),
  item_count: z.number().nullable(),
  status: z.string(),
  notes: z.string().nullable(),
  due_date: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const PostReviewAssignmentResponseSchema = z.object({
  assignment: ReviewAssignmentRowSchema,
});

export const POST = defineRoute(
  PostReviewAssignmentResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { allowed } = checkRateLimit(
        `review-assignments-create:${user.id}`,
        10,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(ReviewAssignmentBodySchema, raw);
      if (!parsed.success) return parsed.response;

      const {
        reviewer_id,
        filter_domains,
        filter_content_types,
        filter_freshness,
        filter_date_from,
        filter_date_to,
        due_date,
        notes,
      } = parsed.data;

      // Compute item_count by running a count query with the filter criteria.
      // ID-131 {131.19} G-GOV-FACET: content_items is dying — freshness lives
      // on the record_lifecycle facet (owner_kind='source_document', SD-only
      // per D7); primary_domain/content_type/captured_date live on the
      // owning source_documents row, joined via the FK embed.
      let countQuery = supabase
        .from('record_lifecycle')
        .select(
          'source_document_id, source_documents!inner(primary_domain, content_type, captured_date)',
          {
            count: 'exact',
            head: true,
          },
        )
        .eq('owner_kind', 'source_document');

      if (filter_domains.length > 0) {
        countQuery = countQuery.in(
          'source_documents.primary_domain',
          filter_domains,
        );
      }
      if (filter_content_types.length > 0) {
        countQuery = countQuery.in(
          'source_documents.content_type',
          filter_content_types,
        );
      }
      if (filter_freshness.length > 0) {
        countQuery = countQuery.in('freshness', filter_freshness);
      }
      if (filter_date_from) {
        countQuery = countQuery.gte(
          'source_documents.captured_date',
          filter_date_from,
        );
      }
      if (filter_date_to) {
        countQuery = countQuery.lte(
          'source_documents.captured_date',
          filter_date_to,
        );
      }

      const { count: itemCount, error: countError } = await countQuery;

      if (countError) {
        logger.error({ err: countError }, 'Failed to count matching items');
        return NextResponse.json(
          { error: 'Failed to compute item count for assignment' },
          { status: 500 },
        );
      }

      // Insert the assignment
      const { data: rawAssignment, error: insertError } = await supabase
        .from('review_assignments')
        .insert({
          reviewer_id,
          assigned_by: user.id,
          assignment_type: 'manual',
          filter_domains,
          filter_content_types,
          filter_freshness,
          filter_date_from: filter_date_from ?? null,
          filter_date_to: filter_date_to ?? null,
          item_count: itemCount ?? 0,
          due_date: due_date ?? null,
          notes: notes ?? null,
        })
        .select('*')
        .single();

      if (insertError || !rawAssignment) {
        logger.error(
          { err: insertError },
          'Failed to create review assignment',
        );
        return NextResponse.json(
          { error: 'Failed to create review assignment' },
          { status: 500 },
        );
      }

      // Create notification for the assignee
      try {
        await createNotification({
          supabase,
          userId: reviewer_id,
          type: 'governance_review_needed',
          entityType: 'content_item',
          entityId: rawAssignment.id,
          title: 'New review assignment',
          message: notes
            ? `Review assignment: ${notes}`
            : `You have been assigned ${itemCount ?? 0} items to review.`,
        });
      } catch (notifErr) {
        // Non-fatal — log but don't fail the assignment creation
        logger.warn(
          { err: notifErr },
          'Failed to create assignment notification',
        );
      }

      return NextResponse.json({ assignment: rawAssignment }, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to create review assignment') },
        { status: 500 },
      );
    }
  },
);

/** PATCH returns `{ assignment: <updated review_assignments row> }`. The
 *  update select returns the full row at runtime, but only id/status are
 *  guaranteed on every 2xx path — the rest are nullable DB columns. */
const PatchReviewAssignmentResponseSchema = z.object({
  assignment: z.object({
    id: z.string(),
    status: z.string(),
    reviewer_id: z.string().optional(),
    assigned_by: z.string().nullable().optional(),
    assignment_type: z.string().nullable().optional(),
    filter_domains: z.array(z.string()).nullable().optional(),
    filter_content_types: z.array(z.string()).nullable().optional(),
    filter_freshness: z.array(z.string()).nullable().optional(),
    filter_date_from: z.string().nullable().optional(),
    filter_date_to: z.string().nullable().optional(),
    item_count: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  }),
});

export const PATCH = defineRoute(
  PatchReviewAssignmentResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { allowed } = checkRateLimit(
        `review-assignments-update:${user.id}`,
        20,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const raw = await request.json();
      const parsed = parseBody(ReviewAssignmentUpdateSchema, raw);
      if (!parsed.success) return parsed.response;

      const { id, status } = parsed.data;

      const updateData: ReviewAssignmentUpdate = { status };
      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { data: rawUpdated, error: updateError } = await supabase
        .from('review_assignments')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (updateError) {
        logger.error(
          { err: updateError },
          'Failed to update review assignment',
        );
        return NextResponse.json(
          { error: 'Failed to update review assignment' },
          { status: 500 },
        );
      }

      if (!rawUpdated) {
        return NextResponse.json(
          { error: 'Assignment not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({ assignment: rawUpdated });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to update review assignment') },
        { status: 500 },
      );
    }
  },
);
