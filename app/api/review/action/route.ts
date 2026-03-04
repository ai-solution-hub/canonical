import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { ReviewActionBodySchema } from '@/lib/validation/schemas';

/**
 * POST /api/review/action — perform a review action on a content item.
 *
 * Actions:
 * - verify: mark item as verified (sets verified_at and verified_by)
 * - flag: create a review_needed quality flag in ingestion_quality_log
 * - skip: no database operation, returns success
 * - unverify: clear verified_at and verified_by
 */
export async function POST(request: NextRequest) {
  try {
    // Auth + role check — editors and admins only
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    // Rate limit: 30 requests per minute
    const { allowed } = checkRateLimit(`review-action:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(ReviewActionBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { item_id, action, flag_details } = parsed.data;

    // Validate that the content item exists
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select('id')
      .eq('id', item_id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: 'Content item not found' },
        { status: 404 },
      );
    }

    if (action === 'verify') {
      const { error } = await supabase
        .from('content_items')
        .update({
          verified_at: new Date().toISOString(),
          verified_by: user.id,
          updated_by: user.id,
        })
        .eq('id', item_id);

      if (error) {
        console.error('Failed to verify content item:', error);
        return NextResponse.json(
          { error: 'Failed to verify item' },
          { status: 500 },
        );
      }
    } else if (action === 'flag') {
      const { error } = await supabase
        .from('ingestion_quality_log')
        .insert({
          content_item_id: item_id,
          flag_type: 'review_needed',
          severity: 'warning',
          details: flag_details ? { notes: flag_details } : {},
          created_by: user.id,
        });

      if (error) {
        console.error('Failed to flag content item:', error);
        return NextResponse.json(
          { error: 'Failed to flag item' },
          { status: 500 },
        );
      }
    } else if (action === 'unverify') {
      const { error } = await supabase
        .from('content_items')
        .update({
          verified_at: null,
          verified_by: null,
          updated_by: user.id,
        })
        .eq('id', item_id);

      if (error) {
        console.error('Failed to unverify content item:', error);
        return NextResponse.json(
          { error: 'Failed to unverify item' },
          { status: 500 },
        );
      }
    }
    // action === 'skip': no database operation needed

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process review action') },
      { status: 500 },
    );
  }
}
