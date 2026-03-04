import { Suspense } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SearchBar } from '@/components/search-bar';
import { ContentGrid } from '@/components/content-grid';
import { DomainCard } from '@/components/domain-card';
import { NeedsAttentionBanner } from '@/components/needs-attention-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { CONTENT_LIST_COLUMNS } from '@/types/content';
import type { ContentListItem } from '@/types/content';
import {
  loadTaxonomy,
  getDomainNames as getServerDomainNames,
  getDomainColourKey as getServerDomainColourKey,
} from '@/lib/taxonomy-server';
import {
  FileText,
  ShieldCheck,
  Clock,
  FolderTree,
  ArrowRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

interface DashboardStats {
  totalItems: number;
  verifiedItems: number;
  verifiedPercentage: number;
  recentItems: number;
  domainCount: number;
  domainCounts: Record<string, number>;
}

async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();

  const [totalResult, verifiedResult, recentResult, domainResult] =
    await Promise.all([
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .not('verified_at', 'is', null),
      supabase
        .from('content_items')
        .select('*', { count: 'exact', head: true })
        .gte(
          'captured_date',
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        ),
      supabase.rpc('get_filter_counts'),
    ]);

  const totalItems = totalResult.count ?? 0;
  const verifiedItems = verifiedResult.count ?? 0;
  const recentItems = recentResult.count ?? 0;

  let domainCounts: Record<string, number> = {};
  if (domainResult.data && typeof domainResult.data === 'object') {
    const filterCounts = domainResult.data as Record<
      string,
      Record<string, number>
    >;
    domainCounts = filterCounts.domain ?? {};
  }

  const domainCount = Object.keys(domainCounts).filter(
    (k) => domainCounts[k] > 0,
  ).length;

  const verifiedPercentage =
    totalItems > 0 ? Math.round((verifiedItems / totalItems) * 100) : 0;

  return {
    totalItems,
    verifiedItems,
    verifiedPercentage,
    recentItems,
    domainCount,
    domainCounts,
  };
}

async function getRecentItems(): Promise<ContentListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_items')
    .select(CONTENT_LIST_COLUMNS)
    .order('captured_date', { ascending: false, nullsFirst: false })
    .limit(8);

  if (error) {
    console.error('Failed to fetch recent items:', error.message);
    return [];
  }

  return (data ?? []) as ContentListItem[];
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function HeroSkeleton() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <Skeleton className="mb-2 h-3 w-16" />
      <Skeleton className="h-8 w-20" />
    </div>
  );
}

function DomainGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-4"
        >
          <Skeleton className="mb-2 h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

function RecentGridSkeleton() {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-lg border border-border"
        >
          <Skeleton className="aspect-[16/9] w-full rounded-b-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="mt-auto h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Async sub-components
// ---------------------------------------------------------------------------

async function HeroSection() {
  const stats = await getDashboardStats();

  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-fluid-2xl font-bold tracking-tight">
          Knowledge Hub
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          AI-powered knowledge base for bid management
          {stats.totalItems > 0 && (
            <>
              {' \u2014 '}
              <span className="font-medium text-foreground">
                {stats.totalItems.toLocaleString()}
              </span>{' '}
              items indexed
            </>
          )}
        </p>
      </div>
      <SearchBar variant="hero" totalCount={stats.totalItems} autoFocus />
    </section>
  );
}

async function StatsSection() {
  const stats = await getDashboardStats();

  const statCards = [
    {
      label: 'Total Items',
      value: stats.totalItems.toLocaleString(),
      icon: FileText,
    },
    {
      label: 'Verified',
      value: `${stats.verifiedPercentage}%`,
      icon: ShieldCheck,
    },
    {
      label: 'Last 7 Days',
      value: stats.recentItems.toLocaleString(),
      icon: Clock,
    },
    {
      label: 'Domains',
      value: stats.domainCount.toString(),
      icon: FolderTree,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {statCards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Icon className="size-3.5" aria-hidden="true" />
              {card.label}
            </div>
            <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              {card.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

async function DomainCoverageSection() {
  const [stats, taxonomy] = await Promise.all([
    getDashboardStats(),
    loadTaxonomy(),
  ]);
  const domainNames = getServerDomainNames(taxonomy.domains);

  // Only show domains that have items or are in the taxonomy
  const domainsWithCounts = domainNames.map((name) => ({
    name,
    count: stats.domainCounts[name] ?? 0,
    colourKey: getServerDomainColourKey(name, taxonomy.domains),
  }));

  // Sort by count descending
  domainsWithCounts.sort((a, b) => b.count - a.count);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {domainsWithCounts.map((domain) => (
        <DomainCard
          key={domain.name}
          domain={domain.name}
          count={domain.count}
        />
      ))}
    </div>
  );
}

async function RecentItemsSection() {
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
      {/* Needs attention banner */}
      <NeedsAttentionBanner className="mb-8" />

      {/* Hero section with search */}
      <Suspense fallback={<HeroSkeleton />}>
        <HeroSection />
      </Suspense>

      {/* Stats cards */}
      <section className="mt-10" aria-label="Knowledge base statistics">
        <Suspense
          fallback={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))}
            </div>
          }
        >
          <StatsSection />
        </Suspense>
      </section>

      {/* Domain coverage */}
      <section className="mt-10" aria-label="Domain coverage">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Domain Coverage
          </h2>
          <Link
            href="/browse"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Browse all
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <Suspense fallback={<DomainGridSkeleton />}>
          <DomainCoverageSection />
        </Suspense>
      </section>

      {/* Recent items */}
      <section className="mt-10" aria-label="Recently added">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Recently Added
          </h2>
          <Link
            href="/browse?sort=captured_date&order=desc"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <Suspense fallback={<RecentGridSkeleton />}>
          <RecentItemsSection />
        </Suspense>
      </section>
    </div>
  );
}
