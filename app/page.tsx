import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { SearchBar } from '@/components/search-bar';
import { ActiveBidsSection } from '@/components/dashboard/active-bids-section';
import { QuickStatsStrip } from '@/components/dashboard/quick-stats-strip';
import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';
import { NeedsAttentionSection } from '@/components/dashboard/needs-attention-section';
import { ComplianceStatusSection } from '@/components/dashboard/compliance-status-section';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchUnifiedDashboardData } from '@/lib/dashboard';
import { buildAttentionItems, filterByRole } from '@/lib/attention';
import { ReorientSection } from '@/components/dashboard/reorient-section';
import type { ReorientData } from '@/types/reorient';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getDashboardData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Check role
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();
  const isAdmin = roleData?.role === 'admin';
  const role = roleData?.role ?? 'viewer';

  const unified = await fetchUnifiedDashboardData(supabase, user.id, isAdmin, role);
  return { unified };
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function SearchSkeleton() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}

function AttentionSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

function BidsSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}

function StatsSkeleton() {
  return <Skeleton className="h-14 w-full rounded-lg" />;
}

function ActivitySkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-md" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Async dashboard content
// ---------------------------------------------------------------------------

async function DashboardContent() {
  const result = await getDashboardData();

  if (!result) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in to view your dashboard.
        </p>
      </div>
    );
  }

  const { unified } = result;

  // Build attention items from unified source data.
  // roleItems is ready for Wave 4 (UnifiedAttentionSection).
  const allItems = buildAttentionItems({
    ...unified.attention_sources,
    active_bids: unified.active_bids,
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const roleItems = filterByRole(allItems, unified.user_role);

  // Build ReorientData from the unified data for ReorientSection
  const reorientData: ReorientData = {
    last_active_at: unified.reorient.last_active_at,
    last_active_relative: unified.reorient.last_active_relative,
    urgent: [],  // Empty — urgent items are now in the attention model
    team_changes: unified.reorient.team_changes,
    my_recent_work: unified.reorient.my_recent_work,
    bid_summary: unified.reorient.bid_summary,
    counts: {
      unread_notifications: unified.attention_sources.unread_notification_count,
      pending_reviews: unified.attention_sources.governance_review_count,
      stale_or_expired: unified.attention_sources.stale_content_count + unified.attention_sources.expired_content_count,
      quality_flags: unified.attention_sources.quality_flag_count,
    },
    generated_at: new Date().toISOString(),
    user_display_name: unified.reorient.user_display_name,
    has_display_name: unified.reorient.has_display_name,
    errors: unified.errors,
  };

  return (
    <>
      {/* QuickStatsStrip — content health at a glance */}
      <div className="mt-6">
        <QuickStatsStrip
          freshness={unified.freshness_summary}
          activeBidCount={unified.active_bids.length}
          unreadNotificationCount={unified.attention_sources.unread_notification_count}
        />
      </div>

      {/* Reorient Me — personalised briefing */}
      <div className="mt-6">
        <ReorientSection data={reorientData} />
      </div>

      {/* Two-column layout: Needs Attention + Active Bids */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div>
          <NeedsAttentionSection
            governance_review_count={unified.attention_sources.governance_review_count}
            unverified_count={unified.attention_sources.unverified_count}
            quality_flag_count={unified.attention_sources.quality_flag_count}
            stale_content_count={unified.attention_sources.stale_content_count}
            expired_content_count={unified.attention_sources.expired_content_count}
            expiringCertCount={unified.attention_sources.expiring_cert_count}
            expiringContentCount={unified.attention_sources.expiring_content_date_count}
            userRole={unified.user_role}
          />
        </div>
        <ActiveBidsSection bids={unified.active_bids} />
      </div>

      {/* Compliance Status */}
      <div className="mt-6">
        <ComplianceStatusSection />
      </div>

      {/* Recent Activity */}
      <section className="mt-6 rounded-lg border border-border bg-card p-4" aria-label="Recent activity">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Activity
        </h2>
        <DashboardActivityFeed activities={unified.recent_activity} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Compact search bar */}
      <section className="mb-6 text-center" aria-label="Search">
        <h1 className="mb-4 text-fluid-2xl font-bold tracking-tight">
          Knowledge Hub
        </h1>
        <Suspense fallback={<SearchSkeleton />}>
          <SearchBar variant="hero" autoFocus />
        </Suspense>
      </section>

      {/* Dashboard content with Suspense */}
      <Suspense
        fallback={
          <div className="mt-8 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <AttentionSkeleton />
              <BidsSkeleton />
            </div>
            <StatsSkeleton />
            <ActivitySkeleton />
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </div>
  );
}
