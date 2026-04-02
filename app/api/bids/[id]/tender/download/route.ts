import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';
import { parseSearchParams } from '@/lib/validation';
import { TenderDownloadParamsSchema } from '@/lib/validation/schemas';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/bids/:id/tender/download?path=<storagePath> -- signed download URL for tender documents */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id: bidId } = await params;
    if (!UUID_RE.test(bidId)) {
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
    if (!storagePath.startsWith(`${bidId}/`)) {
      return NextResponse.json(
        { error: 'Invalid document path for this bid' },
        { status: 403 },
      );
    }

    // Verify bid exists
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', bidId)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    // Generate signed URL (5-minute expiry) using service client
    const serviceClient = createServiceClient();
    const { data: signedUrl, error: signError } = await serviceClient.storage
      .from('tender-documents')
      .createSignedUrl(storagePath, 300);

    if (signError || !signedUrl?.signedUrl) {
      console.error(
        'Failed to create signed URL for tender document:',
        signError,
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
}
