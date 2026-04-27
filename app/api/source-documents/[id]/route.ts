import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

/**
 * GET /api/source-documents/[id] — get a single source document with
 * its linked content items.
 *
 * Auth: any authenticated user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await getAuthenticatedClient();
    if (!authResult.success) return authFailureResponse(authResult);
    const { id } = await params;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid document ID format' },
        { status: 400 },
      );
    }

    const serviceClient = createServiceClient();

    // Fetch the source document
    const { data: doc, error: docErr } = await serviceClient
      .from('source_documents')
      .select('*')
      .eq('id', id)
      .single();

    if (docErr || !doc) {
      return NextResponse.json(
        { error: 'Source document not found' },
        { status: 404 },
      );
    }

    // Fetch linked content items
    const { data: items } = await serviceClient
      .from('content_items')
      .select(
        'id, title, content_type, primary_domain, primary_subtopic, freshness, created_at',
      )
      .eq('source_document_id', id)
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      ...doc,
      content_items: items ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch source document') },
      { status: 500 },
    );
  }
}
