import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  authFailureResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/bids/:id/templates/:templateId/completions/:completionId/download -- signed download URL */
export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      templateId: string;
      completionId: string;
    }>;
  },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: bidId, templateId, completionId } = await params;
    if (
      !UUID_RE.test(bidId) ||
      !UUID_RE.test(templateId) ||
      !UUID_RE.test(completionId)
    ) {
      return NextResponse.json(
        { error: 'Invalid ID format -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Verify template belongs to bid
    const { data: template, error: templateError } = await supabase
      .from('templates')
      .select('id')
      .eq('id', templateId)
      .eq('project_id', bidId)
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 },
      );
    }

    // Fetch completion record
    const { data: completion, error: completionError } = await supabase
      .from('template_completions')
      .select('id, storage_path, fields_filled')
      .eq('id', completionId)
      .eq('template_id', templateId)
      .single();

    if (completionError || !completion) {
      return NextResponse.json(
        { error: 'Completion not found' },
        { status: 404 },
      );
    }

    // Generate signed URL (5-minute expiry)
    const serviceClient = createServiceClient();
    const { data: signedUrl, error: signError } = await serviceClient.storage
      .from('templates')
      .createSignedUrl(completion.storage_path, 300);

    if (signError || !signedUrl?.signedUrl) {
      console.error('Failed to create signed URL:', signError);
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
