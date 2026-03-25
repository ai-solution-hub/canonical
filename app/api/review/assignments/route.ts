import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import {
  ReviewAssignmentBodySchema,
  ReviewAssignmentUpdateSchema,
} from '@/lib/validation/schemas';
import { createNotification } from '@/lib/notifications';

export const maxDuration = 30;

/**
 * Row shape for review_assignments table.
 * Defined here until `supabase gen types` is run after migration is pushed.
 */
interface ReviewAssignmentRow {
  id: string;
  reviewer_id: string;
  assigned_by: string;
  assignment_type: string;
  filter_domains: string[];
  filter_content_types: string[];
  filter_freshness: string[];
  filter_date_from: string | null;
  filter_date_to: string | null;
  item_count: number | null;
  status: string;
  notes: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Table name cast — `review_assignments` is created by migration but types
// may not be regenerated yet. Remove this cast after `supabase gen types`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLE = 'review_assignments' as any;

/**
 * GET /api/review/assignments
 *
 * List review assignments. Non-admins see only their own active assignments.
 * Admins see all assignments (optionally filtered by status).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase, role } = auth;

    const { allowed } = checkRateLimit(`review-assignments:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const { searchParams } = request.nextUrl;
    const statusFilter = searchParams.get('status') ?? 'active';

    let query = supabase
      .from(TABLE)
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
      console.error('Failed to fetch review assignments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch review assignments' },
        { status: 500 },
      );
    }

    return NextResponse.json({ assignments: (data ?? []) as unknown as ReviewAssignmentRow[] });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch review assignments') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/review/assignments
 *
 * Create a new review assignment. Admin only.
 * Computes item_count based on the provided filter criteria.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`review-assignments-create:${user.id}`, 10, 60_000);
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

    // Compute item_count by running a count query with the filter criteria
    let countQuery = supabase
      .from('content_items')
      .select('id', { count: 'exact', head: true });

    if (filter_domains.length > 0) {
      countQuery = countQuery.in('primary_domain', filter_domains);
    }
    if (filter_content_types.length > 0) {
      countQuery = countQuery.in('content_type', filter_content_types);
    }
    if (filter_freshness.length > 0) {
      countQuery = countQuery.in('freshness', filter_freshness);
    }
    if (filter_date_from) {
      countQuery = countQuery.gte('captured_date', filter_date_from);
    }
    if (filter_date_to) {
      countQuery = countQuery.lte('captured_date', filter_date_to);
    }

    const { count: itemCount, error: countError } = await countQuery;

    if (countError) {
      console.error('Failed to count matching items:', countError);
      return NextResponse.json(
        { error: 'Failed to compute item count for assignment' },
        { status: 500 },
      );
    }

    // Insert the assignment
    const { data: rawAssignment, error: insertError } = await supabase
      .from(TABLE)
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

    const assignment = rawAssignment as ReviewAssignmentRow | null;

    if (insertError || !assignment) {
      console.error('Failed to create review assignment:', insertError);
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
        entityId: assignment.id,
        title: 'New review assignment',
        message: notes
          ? `Review assignment: ${notes}`
          : `You have been assigned ${itemCount ?? 0} items to review.`,
      });
    } catch (notifErr) {
      // Non-fatal — log but don't fail the assignment creation
      console.warn('Failed to create assignment notification:', notifErr);
    }

    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create review assignment') },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/review/assignments
 *
 * Update an assignment's status (complete or cancel). Editor+ role required.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`review-assignments-update:${user.id}`, 20, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(ReviewAssignmentUpdateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { id, status } = parsed.data;

    const updateData: Record<string, unknown> = { status };
    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }

    const { data: rawUpdated, error: updateError } = await supabase
      .from(TABLE)
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    const updated = rawUpdated as ReviewAssignmentRow | null;

    if (updateError) {
      console.error('Failed to update review assignment:', updateError);
      return NextResponse.json(
        { error: 'Failed to update review assignment' },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 },
      );
    }

    return NextResponse.json({ assignment: updated });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update review assignment') },
      { status: 500 },
    );
  }
}
