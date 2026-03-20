import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

/** Co-occurrence pair returned by the API */
interface CoOccurrencePair {
  entity_a: string;
  type_a: string;
  entity_b: string;
  type_b: string;
  shared_count: number;
}

/**
 * GET /api/entities/co-occurrence — find entities that frequently appear
 * together in the same content items.
 *
 * Query params:
 *   limit  — max pairs to return (default 20, max 50)
 *   min    — minimum shared item count (default 2)
 *   type   — filter one or both entities to this entity_type
 *
 * Auth: any authenticated user (read-only).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const params = request.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(params.get('limit')) || 20, 1), 50);
    const minShared = Math.max(Number(params.get('min')) || 2, 1);
    const entityType = params.get('type') ?? undefined;

    // Fetch all entity mentions (canonical_name, entity_type, content_item_id)
    // We do the self-join in JS to avoid needing a custom RPC.
    let query = supabase
      .from('entity_mentions')
      .select('canonical_name, entity_type, content_item_id');

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    const { data: mentions, error } = await query.limit(5000);

    if (error) {
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to fetch entity mentions') },
        { status: 500 },
      );
    }

    // Group mentions by content_item_id
    const itemEntityMap = new Map<string, { name: string; type: string }[]>();
    for (const m of mentions ?? []) {
      const entities = itemEntityMap.get(m.content_item_id) ?? [];
      entities.push({ name: m.canonical_name, type: m.entity_type });
      itemEntityMap.set(m.content_item_id, entities);
    }

    // Count co-occurrences: for each content item with 2+ entities,
    // count each unique pair (a < b to avoid duplicates)
    const pairCounts = new Map<string, { entity_a: string; type_a: string; entity_b: string; type_b: string; items: Set<string> }>();

    for (const [itemId, entities] of itemEntityMap) {
      // Deduplicate entities within the same item (same canonical_name)
      const uniqueEntities = Array.from(
        new Map(entities.map((e) => [e.name, e])).values(),
      );

      if (uniqueEntities.length < 2) continue;

      // Sort by name for consistent pair keys
      uniqueEntities.sort((a, b) => a.name.localeCompare(b.name));

      for (let i = 0; i < uniqueEntities.length; i++) {
        for (let j = i + 1; j < uniqueEntities.length; j++) {
          const a = uniqueEntities[i];
          const b = uniqueEntities[j];
          const key = `${a.name}|||${b.name}`;

          let pair = pairCounts.get(key);
          if (!pair) {
            pair = {
              entity_a: a.name,
              type_a: a.type,
              entity_b: b.name,
              type_b: b.type,
              items: new Set(),
            };
            pairCounts.set(key, pair);
          }
          pair.items.add(itemId);
        }
      }
    }

    // Filter by minimum shared count and sort by frequency
    const pairs: CoOccurrencePair[] = Array.from(pairCounts.values())
      .filter((p) => p.items.size >= minShared)
      .map((p) => ({
        entity_a: p.entity_a,
        type_a: p.type_a,
        entity_b: p.entity_b,
        type_b: p.type_b,
        shared_count: p.items.size,
      }))
      .sort((a, b) => b.shared_count - a.shared_count)
      .slice(0, limit);

    return NextResponse.json({ pairs, total: pairs.length });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to compute co-occurrence') },
      { status: 500 },
    );
  }
}
