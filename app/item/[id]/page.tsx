import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ItemDetailClient } from './item-detail-client';
import { CONTENT_DETAIL_COLUMNS } from '@/types/content';
import { parseJsonb, SummaryDataSchema } from '@/lib/validation/jsonb';
import type { ContentListItem } from '@/types/content';
import type { ItemData } from './item-detail-client';

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch item with retry to handle read-after-write race when redirecting
  // from the creation form (different connection pool connections).
  // Only retry on PGRST116 (single row not found) — other errors fail fast.
  let item = null;
  let error = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await supabase
      .from('content_items')
      .select(CONTENT_DETAIL_COLUMNS)
      .eq('id', id)
      .single();
    item = result.data;
    error = result.error;
    if (item) break;
    const isNotFound = error?.code === 'PGRST116';
    if (!isNotFound || attempt >= 2) break;
    console.warn(
      `[item/${id}] Retry ${attempt + 1}/2: item not found yet (read-after-write race)`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }

  if (error || !item) {
    notFound();
  }

  // Fetch related items server-side (single RPC — no embedding round-trip)
  const { data: relatedItems } = await supabase.rpc('find_related_items', {
    p_item_id: id,
    p_similarity_threshold: 0.6,
    p_limit_count: 6,
  });

  // Parse JSONB columns with runtime validation
  // Scalar fields match between Supabase row and ItemData; only JSONB columns
  // differ and are immediately overridden below with validated versions.
  const itemData: ItemData = {
    ...(item as ItemData),
    summary_data: parseJsonb(SummaryDataSchema, item.summary_data),
  };

  return (
    <ItemDetailClient
      item={itemData}
      relatedItems={
        (relatedItems as Array<ContentListItem & { similarity: number }>) ?? []
      }
    />
  );
}
