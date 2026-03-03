import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ItemDetailClient } from './item-detail-client';
import { CONTENT_DETAIL_COLUMNS } from '@/types/content';
import {
  parseJsonb,
  parseJsonbArray,
  SummaryDataSchema,
  TranscriptSegmentSchema,
  TranscriptHighlightSchema,
} from '@/lib/validation/jsonb';
import type { ContentListItem } from '@/types/content';
import type { ItemData } from './item-detail-client';

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch item with explicit columns + embedding (for related items query)
  const { data: item, error } = await supabase
    .from('content_items')
    .select(`${CONTENT_DETAIL_COLUMNS}, embedding`)
    .eq('id', id)
    .single();

  if (error || !item) {
    notFound();
  }

  // Separate embedding from item data (embedding stays server-side)
  const { embedding, ...itemWithoutEmbedding } = item;

  // Fetch related items server-side
  let relatedItems: Array<ContentListItem & { similarity: number }> = [];
  if (embedding) {
    const { data: similar } = await supabase.rpc('find_similar_content', {
      query_embedding: embedding,
      similarity_threshold: 0.6,
      limit_count: 7,
    });

    if (similar) {
      const filtered = similar
        .filter((r: { id: string }) => r.id !== id)
        .slice(0, 6);

      if (filtered.length > 0) {
        const ids = filtered.map((r: { id: string }) => r.id);
        const { data: details } = await supabase
          .from('content_items')
          .select(
            'id, title, suggested_title, ai_summary, primary_domain, primary_subtopic, content_type, platform, author_name, source_domain, thumbnail_url, captured_date, ai_keywords, classification_confidence, priority, user_tags',
          )
          .in('id', ids);

        if (details) {
          relatedItems = filtered.map(
            (r: { id: string; similarity: number }) => ({
              ...(details.find((d) => d.id === r.id) as ContentListItem),
              similarity: r.similarity,
            }),
          );
        }
      }
    }
  }

  // Parse JSONB columns with runtime validation
  // Scalar fields match between Supabase row and ItemData; only JSONB columns
  // differ and are immediately overridden below with validated versions.
  const itemData: ItemData = {
    ...(itemWithoutEmbedding as ItemData),
    summary_data: parseJsonb(
      SummaryDataSchema,
      itemWithoutEmbedding.summary_data,
    ),
    segments: parseJsonbArray(
      TranscriptSegmentSchema,
      itemWithoutEmbedding.segments,
    ),
    highlights: parseJsonbArray(
      TranscriptHighlightSchema,
      itemWithoutEmbedding.highlights,
    ),
  };

  return <ItemDetailClient item={itemData} relatedItems={relatedItems} />;
}
