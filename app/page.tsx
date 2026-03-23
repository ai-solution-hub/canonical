import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { SearchBar } from '@/components/search-bar';
import { ActiveBidsSection } from '@/components/dashboard/active-bids-section';
import { QuickStatsStrip } from '@/components/dashboard/quick-stats-strip';
import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchDashboardData } from '@/lib/dashboard';
import { fetchReorientData } from '@/lib/reorient';
import { ReorientSection } from '@/components/dashboard/reorient-section';
import { ClaudeActionsSection } from '@/components/dashboard/claude-actions-section';
import { ContentSuggestionsSection } from '@/components/dashboard/content-suggestions-section';
import { ClientAttentionBridge } from '@/components/dashboard/client-attention-bridge';
import { generateSuggestedActions } from '@/lib/claude-prompts';

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

  // Fetch dashboard and reorient data in parallel
  const [dashboard, reorient] = await Promise.all([
    fetchDashboardData(supabase, user.id, isAdmin, role),
    fetchReorientData(supabase, user.id, isAdmin, role).catch(() => null),
  ]);

  return { dashboard, reorient };
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

  const { dashboard: data, reorient } = result;

  return (
    <>
      {/* Reorient Me — personalised briefing */}
      {reorient && (
        <div className="mt-6">
          <ReorientSection data={reorient} />
        </div>
      )}

      {/* Two-column layout: Needs Attention + Active Bids
           ClientAttentionBridge wires client-side expiring counts
           (certifications + content) into NeedsAttentionSection */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div>
          <ClientAttentionBridge
            needsAttention={data.needs_attention}
            userRole={data.user_role}
          />
        </div>
        <ActiveBidsSection bids={data.active_bids} />
      </div>

      {/* Content Health strip */}
      <div className="mt-6">
        <QuickStatsStrip
          freshness={data.freshness_summary}
          activeBidCount={data.active_bids.length}
          unreadNotificationCount={data.unread_notification_count}
        />
      </div>

      {/* Content Suggestions */}
      <div className="mt-6">
        <ContentSuggestionsSection limit={5} />
      </div>

      {/* Suggested Actions for Claude */}
      <div className="mt-6">
        <ClaudeActionsSection actions={generateSuggestedActions(data)} />
      </div>

      {/* Recent Activity */}
      <section className="mt-6 rounded-lg border border-border bg-card p-4" aria-label="Recent activity">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Activity
        </h2>
        <DashboardActivityFeed activities={data.recent_activity} />
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
