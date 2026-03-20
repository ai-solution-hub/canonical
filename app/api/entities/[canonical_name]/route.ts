import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 30;

/**
 * GET /api/entities/[canonical_name] — entity detail with variants,
 * content items, and relationships.
 *
 * Returns everything needed to render the entity detail panel:
 * - canonical_name, entity_type, effective type
 * - All variant names (distinct entity_name values)
 * - Content items that mention this entity (id, title, content_type)
 * - Related entities from entity_relationships
 * - Mention count
 *
 * Auth: admin only.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ canonical_name: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`entities:detail:${user.id}`, 30, 60_000);
    if (!allowed) return rateLimitResponse();

    const { canonical_name } = await params;
    const decodedName = decodeURIComponent(canonical_name);

    // ── Fetch all mentions for this canonical name ────────────────────
    const { data: mentions, error: mentionsError } = await supabase
      .from('entity_mentions')
      .select('entity_type, entity_type_override, entity_name, content_item_id, confidence, context_snippet')
      .eq('canonical_name', decodedName);

    if (mentionsError) {
      return NextResponse.json(
        { error: safeErrorMessage(mentionsError, 'Failed to fetch entity detail') },
        { status: 500 },
      );
    }

    if (!mentions || mentions.length === 0) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 },
      );
    }

    // ── Aggregate mention data ───────────────────────────────────────
    const variantNames = new Set<string>();
    const contentItemIds = new Set<string>();
    const typesSeen = new Set<string>();
    let entityType = mentions[0].entity_type;
    let effectiveType = mentions[0].entity_type_override ?? mentions[0].entity_type;

    for (const m of mentions) {
      variantNames.add(m.entity_name);
      contentItemIds.add(m.content_item_id);
      typesSeen.add(m.entity_type);
      if (m.entity_type_override) {
        typesSeen.add(m.entity_type_override);
        effectiveType = m.entity_type_override;
        entityType = m.entity_type;
      }
    }

    // ── Fetch content item details ───────────────────────────────────
    const itemIds = Array.from(contentItemIds);
    let contentItems: { id: string; title: string; content_type: string | null }[] = [];

    if (itemIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('content_items')
        .select('id, title, content_type')
        .in('id', itemIds);

      if (!itemsError && items) {
        contentItems = items.map((item) => ({
          id: item.id,
          title: item.title ?? 'Untitled',
          content_type: item.content_type,
        }));
      }
    }

    // ── Fetch relationships ──────────────────────────────────────────
    const { data: relRows, error: relError } = await supabase
      .from('entity_relationships')
      .select('source_entity, relationship_type, target_entity, confidence')
      .or(`source_entity.eq.${decodedName},target_entity.eq.${decodedName}`);

    const relationships = (!relError && relRows)
      ? relRows.map((r) => ({
          source_entity: r.source_entity,
          relationship_type: r.relationship_type,
          target_entity: r.target_entity,
          confidence: Number(r.confidence),
        }))
      : [];

    return NextResponse.json({
      canonical_name: decodedName,
      entity_type: entityType,
      effective_type: effectiveType,
      has_type_override: effectiveType !== entityType,
      mention_count: mentions.length,
      variant_names: Array.from(variantNames).sort(),
      variant_count: variantNames.size,
      types_seen: Array.from(typesSeen),
      has_type_conflict: typesSeen.size > 1,
      content_items: contentItems,
      content_item_count: contentItems.length,
      relationships,
      relationship_count: relationships.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch entity detail') },
      { status: 500 },
    );
  }
}
