import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ItemDetailClient } from './item-detail-client';
import { CONTENT_DETAIL_COLUMNS } from '@/types/content';
import { parseJsonb, SummaryDataSchema } from '@/lib/validation/jsonb';
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

  // TODO({131.17}): legacy IMS page — deleted by G-IMS-DELETE. The
  // find_related_items RPC was dropped by migration
  // 20260702120000_id131_search_rpcs.sql (owner-ratified, no surviving
  // caller), so the related-items rail renders empty until this page is
  // removed.
  //
  // S197 §1.19 Phase 5: feed_articles → feed_sources lookup is the
  // canonical source for RSS-ingested article metadata in the Source
  // Information accordion. `maybeSingle()` returns `null` cleanly for items
  // that did not come from a feed.
  // OPS-31: wrap with `tryQuery` so failures route via `logBestEffortWarn`
  // instead of silently dropping the error and degrading to null without
  // observability.
  const feedArticleResult = await tryQuery(
    supabase
      .from('feed_articles')
      // Embed by relation name, not FK column: the client runs in the `api`
      // schema (lib/supabase/schema.ts), whose views carry no FK constraints,
      // so `feed_sources:feed_source_id` 400s with PGRST200. The single FK
      // makes `feed_sources` unambiguous.
      .select('published_at, feed_sources (name, url, source_type)')
      .eq('content_item_id', id)
      .maybeSingle(),
    'item.detail.feed_article',
  );

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
    // TODO({131.17}): legacy IMS page — deleted by G-IMS-DELETE. Related
    // items always empty (RPC dropped, see above).
    <ItemDetailClient item={itemData} relatedItems={[]} />
  );
}
