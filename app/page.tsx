import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { SearchBar } from '@/components/search-bar';
import { ContentGrid } from '@/components/content-grid';
import { Skeleton } from '@/components/ui/skeleton';
import { CONTENT_LIST_COLUMNS } from '@/types/content';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getTotalCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('content_items')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Failed to fetch total count:', error.message);
    return 0;
  }

  return count ?? 0;
}

async function getRecentItems(): Promise<ContentListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_items')
    .select(CONTENT_LIST_COLUMNS)
    .order('captured_date', { ascending: false, nullsFirst: false })
    .limit(12);

  if (error) {
    console.error('Failed to fetch recent items:', error.message);
    return [];
  }

  return (data ?? []) as ContentListItem[];
}

// ---------------------------------------------------------------------------
// Skeleton components for loading states
// ---------------------------------------------------------------------------

function HeroSkeleton() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

function ContentCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      <Skeleton className="aspect-[16/9] w-full rounded-b-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="mt-auto h-3 w-20" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

function RecentGridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <ContentCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Async sub-components for Suspense boundaries
// ---------------------------------------------------------------------------

async function HeroSection() {
  const totalCount = await getTotalCount();

  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-fluid-2xl font-bold tracking-tight">
          Knowledge Hub
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          AI-powered knowledge base for bid management
          {totalCount > 0 && (
            <>
              {' — '}
              <span className="font-medium text-foreground">
                {totalCount.toLocaleString()}
              </span>{' '}
              items indexed
            </>
          )}
        </p>
      </div>
      <SearchBar variant="hero" totalCount={totalCount} autoFocus />
    </section>
  );
}

async function RecentlyCapturedSection() {
  const items = await getRecentItems();

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No items found. Start by ingesting some content.
      </p>
    );
  }

  return <ContentGrid items={items} />;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      {/* Hero section */}
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection />
      </Suspense>

      {/* Recently captured section */}
      <section className="mt-16" aria-label="Recently captured">
        <h2 className="mb-6 text-lg font-semibold tracking-tight">
          Recently Added
        </h2>
        <Suspense fallback={<RecentGridSkeleton />}>
          <RecentlyCapturedSection />
        </Suspense>
      </section>
    </div>
  );
}
