import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const authResult = await getAuthenticatedClient();
      if (!authResult.success) return authFailureResponse(authResult);
      const { id } = await params;

      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return NextResponse.json(
          { error: 'Invalid document ID format' },
          { status: 400 },
        );
      }

      const serviceClient = createServiceClient();

      const { data: versions, error } = await serviceClient.rpc(
        'get_document_version_chain',
        { p_document_id: id },
      );

      if (error) {
        return NextResponse.json(
          {
            error: safeErrorMessage(error, 'Failed to fetch document versions'),
          },
          { status: 500 },
        );
      }

      if (!versions || versions.length === 0) {
        return NextResponse.json(
          { error: 'Source document not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({
        document_id: id,
        total_versions: versions.length,
        versions,
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to fetch document versions') },
        { status: 500 },
      );
    }
  },
);
