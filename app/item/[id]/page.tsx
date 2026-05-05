import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ItemDetailClient } from './item-detail-client';
import { CONTENT_DETAIL_COLUMNS } from '@/types/content';
import { parseJsonb, SummaryDataSchema } from '@/lib/validation/jsonb';
import type { ContentListItem } from '@/types/content';
import type { ItemData } from './item-detail-client';
import { logger } from '@/lib/logger';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

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
    logger.warn(
      `[item/${id}] Retry ${attempt + 1}/2: item not found yet (read-after-write race)`,
    );
    await new Promise((r) => setTimeout(r, 500));
  }

  if (error || !item) {
    notFound();
  }

  // Fetch related items (RPC) + RSS feed-article linkage in parallel so the
  // item-detail page load does not serialise on two independent reads.
  // S197 §1.19 Phase 5: feed_articles → feed_sources lookup becomes the
  // canonical source for RSS-ingested article metadata in the Source
  // Information accordion. `maybeSingle()` returns `null` cleanly for items
  // that did not come from a feed.
  // OPS-31: wrap each leg with `tryQuery` so failures route via
  // `logBestEffortWarn` instead of silently dropping the error and
  // degrading to empty arrays / null without observability.
  const [relatedResult, feedArticleResult] = await Promise.all([
    tryQuery(
      supabase.rpc('find_related_items', {
        p_item_id: id,
        p_similarity_threshold: 0.6,
        p_limit_count: 6,
      }),
      'item.detail.related_items',
    ),
    tryQuery(
      supabase
        .from('feed_articles')
        .select(
          'published_at, feed_sources:feed_source_id (name, url, source_type)',
        )
        .eq('content_item_id', id)
        .maybeSingle(),
      'item.detail.feed_article',
    ),
  ]);

  const relatedItems = relatedResult.ok ? relatedResult.data : null;
  if (!relatedResult.ok) {
    logBestEffortWarn(
      'item.detail.related_items',
      'find_related_items RPC failed',
      {
        itemId: id,
        err: relatedResult.error.message,
        code: relatedResult.error.code,
      },
    );
  }

  const feedArticleRaw = feedArticleResult.ok ? feedArticleResult.data : null;
  if (!feedArticleResult.ok) {
    logBestEffortWarn(
      'item.detail.feed_article',
      'feed_articles lookup failed',
      {
        itemId: id,
        err: feedArticleResult.error.message,
        code: feedArticleResult.error.code,
      },
    );
  }

  // PostgREST returns nested relations as either an object or (historically)
  // a one-element array depending on the FK shape. Normalise to object|null.
  const feedArticle =
    feedArticleRaw != null
      ? {
          published_at: feedArticleRaw.published_at ?? null,
          feed_source: Array.isArray(feedArticleRaw.feed_sources)
            ? (feedArticleRaw.feed_sources[0] ?? null)
            : ((feedArticleRaw.feed_sources as {
                name: string;
                url: string;
                source_type: 'rss' | 'web' | 'api';
              } | null) ?? null),
        }
      : null;

  // Parse JSONB columns with runtime validation
  // Scalar fields match between Supabase row and ItemData; only JSONB columns
  // differ and are immediately overridden below with validated versions.
  const itemData: ItemData = {
    ...(item as ItemData),
    summary_data: parseJsonb(SummaryDataSchema, item.summary_data),
    feed_article: feedArticle,
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
