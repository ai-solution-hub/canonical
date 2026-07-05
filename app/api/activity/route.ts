import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseSearchParams } from '@/lib/validation';
import { ActivityParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

// GroupedActivityItem (extends ActivityItem) from @/lib/dashboard, produced by
// mapGroupedActivityRows.
const ActivityGroupedActivityItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  summary: z.string(),
  user_id: z.string().nullable(),
  created_at: z.string().nullable(),
  latest_at: z.string().nullable(),
  earliest_at: z.string().nullable(),
  event_count: z.number(),
});

const ActivityResponseSchema = z.object({
  activities: z.array(ActivityGroupedActivityItemSchema),
  limit: z.number(),
  has_more: z.boolean(),
});

export const GET = defineRoute(
  ActivityResponseSchema,
  async (request: NextRequest) => {
    try {
      const auth = await getAuthorisedClient(['admin']);
      if (!auth.success) return authFailureResponse(auth);

      const parsed = parseSearchParams(
        ActivityParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const { limit } = parsed.data;

      // ID-131.19 (M6, S450 GO tail): get_grouped_activity_feed dropped (IMS
      // activity-feed feature, content_items-anchored). Mirrors the identical
      // stub in lib/dashboard.ts's unified aggregator (query 1) — the RPC
      // call is removed and this route always returns an empty feed so
      // callers (components/dashboard/activity-feed.tsx) keep working
      // against the same response shape. Flagged for the Orchestrator/
      // Curator: no facet/typed-record-based activity feed replacement
      // exists yet.
      return NextResponse.json({
        activities: [],
        limit,
        has_more: false,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch activity feed') },
        { status: 500 },
      );
    }
  },
);
