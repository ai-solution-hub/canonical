import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

/**
 * GET /api/source-documents/[id]/versions — get the full version chain
 * for a source document.
 *
 * Uses the get_document_version_chain RPC to walk the parent_id chain
 * and return all versions with their content item counts.
 *
 * Auth: any authenticated user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await getAuthenticatedClient();
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    const { id } = await params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
        { error: safeErrorMessage(error, 'Failed to fetch document versions') },
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
}
