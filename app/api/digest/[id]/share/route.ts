import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { DigestShareBodySchema } from '@/lib/validation/schemas';
import { toJson } from '@/lib/validation/jsonb';
import type { DigestShareResponse } from '@/types/digest';

// Vercel production URL for share links
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://ims-xi-ten.vercel.app';

/**
 * POST /api/digest/[id]/share
 * Generate or update a share token for a digest.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id: digestId } = await params;

    // Parse and validate request body
    const raw = await request.json();
    const validated = parseBody(DigestShareBodySchema, raw);
    if (!validated.success) return validated.response;
    const { expires_in_days, branding } = validated.data;

    // Fetch the existing digest
    const { data: digest, error: fetchError } = await supabase
      .from('digests')
      .select('id, share_token, domain_summaries, item_ids')
      .eq('id', digestId)
      .maybeSingle();

    if (fetchError) {
      console.error('Failed to fetch digest:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch digest' },
        { status: 500 },
      );
    }

    if (!digest) {
      return NextResponse.json(
        { error: 'Digest not found' },
        { status: 404 },
      );
    }

    // Determine the share token: reuse existing or generate new
    const shareToken = digest.share_token || randomBytes(32).toString('hex');

    // Calculate expiry
    const shareExpiresAt = expires_in_days > 0
      ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Fetch source_urls for top items referenced in domain_summaries
    const domainSummaries = Array.isArray(digest.domain_summaries)
      ? (digest.domain_summaries as Array<{ top_items?: Array<{ id: string }> }>)
      : [];

    const topItemIds: string[] = [];
    for (const ds of domainSummaries) {
      if (Array.isArray(ds.top_items)) {
        for (const item of ds.top_items) {
          if (item.id) topItemIds.push(item.id);
        }
      }
    }

    const shareItemUrls: Record<string, string> = {};

    if (topItemIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('content_items')
        .select('id, source_url')
        .in('id', topItemIds);

      if (itemsError) {
        console.error('Failed to fetch item URLs:', itemsError);
        // Non-fatal: proceed without item URLs
      } else if (items) {
        for (const item of items) {
          if (item.source_url) {
            shareItemUrls[item.id] = item.source_url;
          }
        }
      }
    }

    // Update the digest with share data
    const { error: updateError } = await supabase
      .from('digests')
      .update({
        share_token: shareToken,
        share_expires_at: shareExpiresAt,
        share_branding: branding ? toJson(branding) : null,
        share_item_urls: toJson(shareItemUrls),
      })
      .eq('id', digestId);

    if (updateError) {
      console.error('Failed to update digest with share data:', updateError);
      return NextResponse.json(
        { error: 'Failed to generate share link' },
        { status: 500 },
      );
    }

    const response: DigestShareResponse = {
      share: {
        share_token: shareToken,
        share_url: `${BASE_URL}/share/digest/${shareToken}`,
        share_expires_at: shareExpiresAt,
        share_branding: branding ?? null,
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate share link') },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/digest/[id]/share
 * Revoke a share token for a digest.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id: digestId } = await params;

    // Verify the digest exists
    const { data: digest, error: fetchError } = await supabase
      .from('digests')
      .select('id')
      .eq('id', digestId)
      .maybeSingle();

    if (fetchError) {
      console.error('Failed to fetch digest:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch digest' },
        { status: 500 },
      );
    }

    if (!digest) {
      return NextResponse.json(
        { error: 'Digest not found' },
        { status: 404 },
      );
    }

    // Nullify all share columns
    const { error: updateError } = await supabase
      .from('digests')
      .update({
        share_token: null,
        share_expires_at: null,
        share_branding: null,
        share_item_urls: null,
      })
      .eq('id', digestId);

    if (updateError) {
      console.error('Failed to revoke share link:', updateError);
      return NextResponse.json(
        { error: 'Failed to revoke share link' },
        { status: 500 },
      );
    }

    return NextResponse.json({ revoked: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to revoke share link') },
      { status: 500 },
    );
  }
}
