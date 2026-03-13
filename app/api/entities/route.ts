import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { parseSearchParams } from '@/lib/validation';
import { EntityListParamsSchema } from '@/lib/validation/schemas';

/**
 * GET /api/entities — list entities with counts, variants, and relationship counts.
 * Auth: admin only.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`entities:list:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const parsed = parseSearchParams(
      EntityListParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;

    const { type, search, variants_only, type_conflicts, limit, offset } =
      parsed.data;

    // ── Main entity query ────────────────────────────────────────────
    // Aggregate entity_mentions grouped by canonical_name, using
    // COALESCE(entity_type_override, entity_type) as the effective type.
    let query = supabase.from('entity_mentions').select(
      'canonical_name, entity_type, entity_type_override, entity_name, content_item_id',
    );

    if (type) {
      // Filter by effective type — match either entity_type_override or entity_type
      query = query.or(
        `entity_type_override.eq.${type},and(entity_type_override.is.null,entity_type.eq.${type})`,
      );
    }

    if (search) {
      query = query.ilike('canonical_name', `%${escapePostgrestValue(search)}%`);
    }

    const { data: mentions, error: mentionsError } = await query;
    if (mentionsError) {
      return NextResponse.json(
        { error: safeErrorMessage(mentionsError, 'Failed to fetch entities') },
        { status: 500 },
      );
    }

    // ── Aggregate in JS ──────────────────────────────────────────────
    interface EntityAgg {
      canonical_name: string;
      entity_type: string;
      effective_type: string;
      mention_count: number;
      variant_names: Set<string>;
      content_item_ids: Set<string>;
      types_seen: Set<string>;
    }

    const entityMap = new Map<string, EntityAgg>();

    for (const m of mentions ?? []) {
      const key = m.canonical_name;
      const effectiveType = m.entity_type_override ?? m.entity_type;
      let agg = entityMap.get(key);
      if (!agg) {
        agg = {
          canonical_name: m.canonical_name,
          entity_type: m.entity_type,
          effective_type: effectiveType,
          mention_count: 0,
          variant_names: new Set(),
          content_item_ids: new Set(),
          types_seen: new Set(),
        };
        entityMap.set(key, agg);
      }
      agg.mention_count++;
      agg.variant_names.add(m.entity_name);
      agg.content_item_ids.add(m.content_item_id);
      agg.types_seen.add(m.entity_type);
      if (m.entity_type_override) agg.types_seen.add(m.entity_type_override);
    }

    let entities = Array.from(entityMap.values());

    // ── Filters ──────────────────────────────────────────────────────
    if (variants_only) {
      entities = entities.filter((e) => e.variant_names.size > 1);
    }

    if (type_conflicts) {
      entities = entities.filter((e) => e.types_seen.size > 1);
    }

    // ── Relationship counts (batch) ──────────────────────────────────
    const entityNames = entities.map((e) => e.canonical_name);

    const { data: rels } = await supabase
      .from('entity_relationships')
      .select('source_entity, target_entity')
      .or(
        `source_entity.in.(${JSON.stringify(entityNames)}),target_entity.in.(${JSON.stringify(entityNames)})`,
      );

    const relCountMap = new Map<string, number>();
    for (const r of rels ?? []) {
      relCountMap.set(r.source_entity, (relCountMap.get(r.source_entity) ?? 0) + 1);
      if (r.target_entity !== r.source_entity) {
        relCountMap.set(r.target_entity, (relCountMap.get(r.target_entity) ?? 0) + 1);
      }
    }

    // ── Sort by mention count desc, then paginate ────────────────────
    entities.sort((a, b) => b.mention_count - a.mention_count);

    const total = entities.length;
    const paged = entities.slice(offset, offset + limit);

    const result = paged.map((e) => ({
      canonical_name: e.canonical_name,
      entity_type: e.effective_type,
      mention_count: e.mention_count,
      variant_count: e.variant_names.size,
      variant_names: Array.from(e.variant_names),
      relationship_count: relCountMap.get(e.canonical_name) ?? 0,
      has_type_conflict: e.types_seen.size > 1,
      types_seen: Array.from(e.types_seen),
    }));

    return NextResponse.json({ entities: result, total });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to list entities') },
      { status: 500 },
    );
  }
}
