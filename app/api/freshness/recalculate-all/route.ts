import { NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { batchCalculateFreshness, FreshnessState } from '@/lib/freshness';

/**
 * POST /api/freshness/recalculate-all
 *
 * Recalculate freshness for ALL content items.
 * Admin-only. No request body required.
 */
export async function POST() {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    // Fetch all items with lifecycle data
    const { data: items, error: fetchError } = await supabase
      .from('content_items')
      .select('id, lifecycle_type, updated_at, expiry_date');

    if (fetchError) {
      console.error('Failed to fetch items for freshness recalculation:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch items' },
        { status: 500 },
      );
    }

    if (!items || items.length === 0) {
      return NextResponse.json({
        updated: 0,
        total: 0,
        summary: { fresh: 0, aging: 0, stale: 0, expired: 0 },
        recalculated_at: new Date().toISOString(),
      });
    }

    // Calculate freshness for all items
    const freshnessMap = batchCalculateFreshness(items);
    const now = new Date().toISOString();

    // Build summary counts
    const summary = { fresh: 0, aging: 0, stale: 0, expired: 0 };
    let updated = 0;

    // Group items by their new freshness state for efficient bulk updates
    const byState: Record<FreshnessState, string[]> = {
      fresh: [],
      aging: [],
      stale: [],
      expired: [],
    };

    for (const [itemId, freshness] of freshnessMap) {
      byState[freshness].push(itemId);
      summary[freshness]++;
    }

    // Update each group with a single query per freshness state
    for (const [state, ids] of Object.entries(byState)) {
      if (ids.length === 0) continue;

      const { error: updateError } = await supabase
        .from('content_items')
        .update({
          freshness: state,
          freshness_checked_at: now,
        })
        .in('id', ids);

      if (updateError) {
        console.error(`Failed to update ${state} items:`, updateError);
      } else {
        updated += ids.length;
      }
    }

    return NextResponse.json({
      updated,
      total: items.length,
      summary,
      recalculated_at: now,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to recalculate freshness') },
      { status: 500 },
    );
  }
}
