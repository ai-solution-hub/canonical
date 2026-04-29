import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { FreshnessCalculateBodySchema } from '@/lib/validation/schemas';
import { batchCalculateFreshness } from '@/lib/freshness';
import {
  logger,
  updateRequestContext,
  withRequestContext,
} from '@/lib/logger';

export const maxDuration = 30;

/**
 * POST /api/freshness/calculate
 *
 * Batch calculate freshness for a list of content items.
 * Updates the freshness column in the database and returns the results.
 * Requires editor+ role.
 *
 * Phase 2 (S15 WP1): wrapped with `withRequestContext` so every log line
 * and any Sentry event raised from inside the handler carries the shared
 * `requestId` minted upstream by `proxy.ts`.
 */
export const POST = withRequestContext(async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    // Upgrade the request scope with the resolved user so subsequent
    // log lines + any Sentry events carry userId/userRole.
    updateRequestContext({ userId: user.id });

    const { allowed } = checkRateLimit(
      `freshness:calculate:${user.id}`,
      5,
      60_000,
    );
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const parsed = parseBody(FreshnessCalculateBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { item_ids } = parsed.data;

    // Fetch items with their lifecycle data
    const { data: items, error: fetchError } = await supabase
      .from('content_items')
      .select('id, lifecycle_type, updated_at, expiry_date')
      .in('id', item_ids);

    if (fetchError) {
      logger.error(
        { err: fetchError, op: 'freshness.calculate.fetch' },
        'Failed to fetch items for freshness calculation',
      );
      return NextResponse.json(
        { error: 'Failed to fetch items' },
        { status: 500 },
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'No items found for the provided IDs' },
        { status: 404 },
      );
    }

    // Calculate freshness
    const freshnessMap = batchCalculateFreshness(items);
    const now = new Date().toISOString();

    // Update each item's freshness in the database
    const results: Array<{ id: string; freshness: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const [itemId, freshness] of freshnessMap) {
      const { error: updateError } = await supabase
        .from('content_items')
        .update({
          freshness,
          freshness_checked_at: now,
        })
        .eq('id', itemId);

      if (updateError) {
        logger.error(
          { err: updateError, op: 'freshness.calculate.update', itemId },
          'Failed to update freshness for item',
        );
        failed.push({
          id: itemId,
          error: safeErrorMessage(updateError, 'Update failed'),
        });
      } else {
        results.push({ id: itemId, freshness });
      }
    }

    return NextResponse.json({
      updated: results.length,
      failed_count: failed.length,
      total: items.length,
      results,
      failed,
    });
  } catch (err) {
    logger.error(
      { err, op: 'freshness.calculate' },
      'Failed to calculate freshness',
    );
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to calculate freshness') },
      { status: 500 },
    );
  }
});
