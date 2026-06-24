import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { fetchReorientData } from '@/lib/reorient';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

// ReorientData (@/types/reorient) returned by fetchReorientData — mirrored
// field-for-field including nested item types.
const ReorientUrgentItemSchema = z.object({
  type: z.enum([
    'procurement_deadline',
    'review_pending',
    'content_expired',
    'quality_flag',
    'notification',
  ]),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string(),
  detail: z.string(),
  href: z.string(),
  entity_id: z.string(),
  deadline: z.string().nullable().optional(),
});

const ReorientTeamChangeSchema = z.object({
  user_id: z.string(),
  user_name: z.string().nullable(),
  action: z.enum(['created', 'updated', 'reviewed', 'flagged']),
  entity_type: z.enum(['content_item', 'bid_response']),
  entity_id: z.string(),
  entity_title: z.string(),
  domain: z.string().optional(),
  created_at: z.string(),
  workspace_id: z.string().optional(),
  question_id: z.string().optional(),
});

const ReorientRecentWorkItemSchema = z.object({
  entity_type: z.enum(['content_item', 'bid_response']),
  entity_id: z.string(),
  entity_title: z.string(),
  action: z.enum(['edited', 'created', 'reviewed', 'drafted']),
  href: z.string(),
  created_at: z.string(),
  workspace_id: z.string().optional(),
  question_id: z.string().optional(),
});

const ReorientProcurementBriefingSchema = z.object({
  id: z.string(),
  name: z.string(),
  buyer: z.string().nullable(),
  status: z.string(),
  deadline: z.string().nullable(),
  days_until_deadline: z.number().nullable(),
  urgency: z.enum(['overdue', 'urgent', 'approaching', 'normal', 'unknown']),
  total_questions: z.number(),
  answered_questions: z.number(),
  approved_questions: z.number(),
  gap_count: z.number(),
  href: z.string(),
});

const ReorientResponseSchema = z.object({
  last_active_at: z.string().nullable(),
  last_active_relative: z.string(),
  urgent: z.array(ReorientUrgentItemSchema),
  team_changes: z.array(ReorientTeamChangeSchema),
  my_recent_work: z.array(ReorientRecentWorkItemSchema),
  bid_summary: z.array(ReorientProcurementBriefingSchema),
  counts: z.object({
    unread_notifications: z.number(),
    pending_reviews: z.number(),
    stale_or_expired: z.number(),
    quality_flags: z.number(),
  }),
  generated_at: z.string(),
  user_display_name: z.string().nullable(),
  has_display_name: z.boolean(),
  errors: z.array(z.string()),
});

export const GET = defineRoute(ReorientResponseSchema, async () => {
  try {
    const auth = await getAuthorisedClient();
    if (!auth.success) return authFailureResponse(auth);

    const { user, supabase, role } = auth;
    const isAdmin = role === 'admin';

    const data = await fetchReorientData(supabase, user.id, isAdmin, role);

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch reorientation data') },
      { status: 500 },
    );
  }
});
