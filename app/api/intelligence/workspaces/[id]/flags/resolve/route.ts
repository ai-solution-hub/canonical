// app/api/intelligence/workspaces/[id]/flags/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Bulk flag resolution request body.
 *
 * `resolution_type` is constrained to the values accepted by the
 * `feed_flags.resolution_type` CHECK constraint
 * (see `supabase/migrations/20260330230240_create_feed_tables.sql`):
 *   `resolution_type varchar CHECK (resolution_type IN ('addressed', 'dismissed'))`
 *
 * `prompt_version_id` is required when `resolution_type = 'addressed'` so
 * we can trace which prompt version addressed each flag (Task 5 spec).
 */
const BulkResolveFlagsSchema = z
  .object({
    flag_ids: z
      .array(z.string().uuid())
      .min(1, 'At least one flag_id is required')
      .max(500, 'Cannot resolve more than 500 flags in a single request'),
    resolution_type: z.enum(['addressed', 'dismissed']),
    prompt_version_id: z.string().uuid().nullable().optional(),
    resolved_notes: z.string().max(1000).optional(),
  })
  .refine(
    (data) =>
      data.resolution_type !== 'addressed' ||
      (typeof data.prompt_version_id === 'string' &&
        data.prompt_version_id.length > 0),
    {
      message:
        "prompt_version_id is required when resolution_type is 'addressed'",
      path: ['prompt_version_id'],
    },
  );

interface FlagLookupRow {
  id: string;
  resolved: boolean;
  feed_articles: { workspace_id: string } | null;
}

/**
 * POST /api/intelligence/workspaces/:id/flags/resolve
 *
 * Bulk-marks `feed_flags.resolved = true` for the supplied flag ids, linking
 * them to the prompt version that addressed them. Returns counts plus any
 * per-flag warnings (e.g. already-resolved flags are listed rather than
 * failing the whole request).
 *
 * Security: every `flag_id` is verified to belong to a `feed_article` in
 * the route's workspace. A request that mixes flags from another workspace
 * is rejected with 400 to prevent horizontal privilege escalation.
 *
 * Auth: admin or editor.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: workspaceId } = await context.params;

    // Validate workspace id is a UUID up-front so we don't leak route shape
    // via a 500 from the workspace lookup. Inline regex (not a Zod schema
    // parse) to satisfy the validation-sweep guard that forbids inline Zod
    // parse calls in route files.
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(workspaceId)) {
      return NextResponse.json(
        { error: 'Invalid workspace id' },
        { status: 400 },
      );
    }

    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const raw = await request.json().catch((_err) => null);
    if (raw === null) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = parseBody(BulkResolveFlagsSchema, raw);
    if (!parsed.success) return parsed.response;

    const {
      flag_ids: flagIds,
      resolution_type: resolutionType,
      prompt_version_id: promptVersionId,
      resolved_notes: resolvedNotes,
    } = parsed.data;

    // Verify the workspace exists and is an intelligence workspace (post-T2:
    // discriminator is application_types.key via JOIN, not workspaces.type col).
    const workspace = await sb(
      supabase
        .from('workspaces')
        .select('id, is_archived, application_types!inner(key)')
        .eq('id', workspaceId)
        .eq('application_types.key', 'intelligence')
        .eq('is_archived', false)
        .maybeSingle(),
      'workspaces.byId',
    );

    if (!workspace) {
      return NextResponse.json(
        { error: 'Intelligence workspace not found' },
        { status: 404 },
      );
    }

    // Fetch all requested flags with their article workspace_id so we can
    // (a) reject cross-workspace flag_ids and (b) skip already-resolved rows.
    const lookupRows = await sb<FlagLookupRow[]>(
      supabase
        .from('feed_flags')
        .select('id, resolved, feed_articles!inner(workspace_id)')
        .in('id', flagIds),
      'feed_flags.bulkLookup',
    );

    const foundIds = new Set(lookupRows.map((r) => r.id));
    const crossWorkspace = lookupRows.filter(
      (r) => r.feed_articles?.workspace_id !== workspaceId,
    );

    if (crossWorkspace.length > 0) {
      return NextResponse.json(
        {
          error:
            'One or more flag_ids belong to a different workspace. Refusing to resolve.',
        },
        { status: 400 },
      );
    }

    const warnings = createWarningsCollector();

    // Flags that were requested but not returned by the lookup — they either
    // do not exist or the caller cannot see them. Surface as a warning,
    // don't fail the whole request.
    const missingIds = flagIds.filter((fid) => !foundIds.has(fid));
    for (const missingId of missingIds) {
      warnings.add(`Flag ${missingId} not found — skipped`);
    }

    const alreadyResolvedIds = lookupRows
      .filter((r) => r.resolved === true)
      .map((r) => r.id);
    for (const resolvedId of alreadyResolvedIds) {
      warnings.add(`Flag ${resolvedId} was already resolved — skipped`);
    }

    const resolvableIds = lookupRows
      .filter((r) => r.resolved === false)
      .map((r) => r.id);

    let resolvedCount = 0;

    if (resolvableIds.length > 0) {
      const updated = await sb<Array<{ id: string }>>(
        supabase
          .from('feed_flags')
          .update({
            resolved: true,
            resolution_type: resolutionType,
            resolved_at: new Date().toISOString(),
            resolved_by: user.id,
            resolved_notes: resolvedNotes ?? null,
            // Only overwrite prompt_version_id when the caller supplied one;
            // null means "leave whatever the flag was created with".
            ...(promptVersionId !== undefined && promptVersionId !== null
              ? { prompt_version_id: promptVersionId }
              : {}),
          })
          .in('id', resolvableIds)
          .select('id'),
        'feed_flags.bulkResolve',
      );

      resolvedCount = updated.length;

      // Defensive: if the update returned fewer rows than we asked for,
      // surface the gap as a warning rather than silently dropping them.
      if (resolvedCount < resolvableIds.length) {
        const updatedSet = new Set(updated.map((r) => r.id));
        for (const missedId of resolvableIds.filter(
          (rid) => !updatedSet.has(rid),
        )) {
          warnings.add(`Flag ${missedId} could not be updated — skipped`);
        }
      }
    }

    return warningsEnvelope(
      {
        resolved_count: resolvedCount,
        requested_count: flagIds.length,
      },
      warnings,
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to resolve flags') },
      { status: 500 },
    );
  }
}
