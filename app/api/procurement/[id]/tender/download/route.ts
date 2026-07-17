import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/validation';
import { TenderDownloadParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ID-145 {145.19} folded-in gap (journalled S479, DR-068 §A6): an
 * engagement-scoped `form_attachments` row ({147.7/147.8}) stores its
 * `storage_path` as `engagement/<engagement_group_id>/<uuid>-<filename>`,
 * outside this form's own `${procurementId}/` prefix, so it always 403'd
 * here — the Documents tab listed it but could never preview it. Matches
 * the leading `engagement/<groupId>/` segment so the caller (the route
 * handler below) can verify it against the REQUESTING form's own
 * `engagement_group_id` — a parent-child predicate, not a blanket
 * `engagement/*` allow (this must not let an ungrouped form, or a form in a
 * DIFFERENT engagement group, read another group's attachment by guessing
 * its path).
 */
const ENGAGEMENT_PATH_RE = /^engagement\/([^/]+)\//;

export const GET = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthenticatedClient();
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id: procurementId } = await params;
      if (!UUID_RE.test(procurementId)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Validate and extract the storage path from query params
      const parsed = parseSearchParams(
        TenderDownloadParamsSchema,
        request.nextUrl.searchParams,
      );
      if (!parsed.success) return parsed.response;
      const storagePath = parsed.data.path;

      // Verify bid exists — fetch `engagement_group_id` too, needed below to
      // validate an engagement-scoped path (ID-145 {145.19} folded-in gap).
      // ID-145 {145.23} round-2 runtime grep sweep (mandatory extra #2, DR-056):
      // workspaces/procurement_workspaces are wholesale-deleted for
      // procurement (W1e, {145.6}) — [id] IS the form_instances PK now.
      const { data: bid, error: procurementError } = await supabase
        .from('form_instances')
        .select('id, engagement_group_id')
        .eq('id', procurementId)
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Validate the path belongs to this form's OWN storage prefix, or —
      // ID-145 {145.19} folded-in gap (DR-068 §A6) — to the engagement group
      // THIS form itself belongs to (prevents path traversal AND cross-group
      // access; an ungrouped form or a form in a different group cannot read
      // another group's attachment by guessing its path).
      const engagementGroupId =
        typeof bid.engagement_group_id === 'string'
          ? bid.engagement_group_id
          : null;
      const engagementMatch = storagePath.match(ENGAGEMENT_PATH_RE);
      const isOwnFormPath = storagePath.startsWith(`${procurementId}/`);
      const isOwnEngagementPath =
        engagementMatch !== null &&
        engagementGroupId !== null &&
        engagementMatch[1] === engagementGroupId;

      if (!isOwnFormPath && !isOwnEngagementPath) {
        return NextResponse.json(
          { error: 'Invalid document path for this bid' },
          { status: 403 },
        );
      }

      // Generate signed URL (5-minute expiry) using service client
      const serviceClient = createServiceClient();
      const { data: signedUrl, error: signError } = await serviceClient.storage
        .from('tender-documents')
        .createSignedUrl(storagePath, 300);

      if (signError || !signedUrl?.signedUrl) {
        logger.error(
          { err: signError },
          'Failed to create signed URL for tender document',
        );
        return NextResponse.json(
          { error: 'Failed to generate download link' },
          { status: 500 },
        );
      }

      return NextResponse.json({
        download_url: signedUrl.signedUrl,
        expires_in: 300,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to generate download link') },
        { status: 500 },
      );
    }
  },
);
