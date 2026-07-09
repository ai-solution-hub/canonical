import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthenticatedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';
import type { Database } from '@/supabase/types/database.types';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

/** One row of the `get_document_version_chain` RPC (shipped return shape). */
export type DocumentVersionRow =
  Database['public']['Functions']['get_document_version_chain']['Returns'][number];

/**
 * Response envelope from this route (id-135 {135.13} BI-25) — declared here
 * (the route handler) and imported by
 * `hooks/source-document-detail/use-source-document-detail.ts`'s
 * `useDocumentVersions`, per the type-drift-detect conformance convention
 * (response types live at the route, hooks import from the route — never the
 * reverse; see `app/api/review/history/route.ts` / `ReviewHistoryEntry` for
 * the precedent pair).
 */
export interface DocumentVersionsResponse {
  document_id: string;
  total_versions: number;
  versions: DocumentVersionRow[];
}

export const GET = defineRoute(
  z.unknown(),
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse<DocumentVersionsResponse> | NextResponse> => {
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
