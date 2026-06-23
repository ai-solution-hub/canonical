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

      // Validate path belongs to this bid (prevent path traversal)
      if (!storagePath.startsWith(`${procurementId}/`)) {
        return NextResponse.json(
          { error: 'Invalid document path for this bid' },
          { status: 403 },
        );
      }

      // Verify bid exists.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: procurementError } = await supabase
        .from('workspaces')
        .select('id, application_types!inner(key)')
        .eq('id', procurementId)
        .eq('application_types.key', 'procurement')
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
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
