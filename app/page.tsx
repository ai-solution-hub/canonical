import { Suspense } from 'react';
import { BRANDING } from '@/lib/client-config';
import { createClient } from '@/lib/supabase/server';
import { SearchBar } from '@/components/browse/search-bar';
import { ActiveBidsSection } from '@/components/dashboard/active-bids-section';
import { QuickStatsStrip } from '@/components/dashboard/quick-stats-strip';
import { DashboardActivityFeed } from '@/components/dashboard/dashboard-activity-feed';
import { UnifiedAttentionSection } from '@/components/dashboard/unified-attention-section';
import { ComplianceStatusSection } from '@/components/dashboard/compliance-status-section';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchUnifiedDashboardData } from '@/lib/dashboard';
import { buildAttentionItems } from '@/lib/attention';
import { ReorientSection } from '@/components/dashboard/reorient-section';
import { OwnedContentHealth } from '@/components/dashboard/owned-content-health';
import { ContentPerformanceSection } from '@/components/dashboard/content-performance-section';
import { WarningsBanner } from '@/components/dashboard/warnings-banner';
import { McpSetupNudge } from '@/components/shell/mcp-setup-nudge';
import { PipelineRunsPanel } from '@/components/intelligence/pipeline-runs-panel';
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

  // Check role. PGRST116 (no rows) is benign — the user has no explicit role
  // and defaults to viewer. Any other DB error must surface as a warning so an
  // admin who hits a transient DB glitch is not silently downgraded to the
  // viewer dashboard. Mirrors `app/api/dashboard/route.ts` lines 31-41.
  const { data: roleData, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const roleWarnings: string[] = [];
  if (roleError && roleError.code !== 'PGRST116') {
    console.error('Failed to look up user role for dashboard:', roleError);
    roleWarnings.push(
      'Could not verify your role; some sections may be hidden until you reload.',
    );
  }
  const isAdmin = roleData?.role === 'admin';
  const role = roleData?.role ?? 'viewer';

  const unified = await fetchUnifiedDashboardData(
    supabase,
    user.id,
    isAdmin,
    role,
  );
  return { unified, roleWarnings };
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

  const { unified, roleWarnings } = result;

  // Compose the warnings array consumed by `<WarningsBanner />`. Mirrors the
  // `warnings: [...roleWarnings, ...dashboard.errors]` envelope built by
  // `app/api/dashboard/route.ts:71-84` so the page render and the client
  // refresh path surface the same partial-failure messages.
  const warnings: readonly string[] = [
    ...roleWarnings,
    ...unified.errors,
  ];

  // Build attention items from unified source data.
  const allItems = buildAttentionItems({
    ...unified.attention_sources,
    active_bids: unified.active_bids,
  });

  // Build ReorientData from the unified data for ReorientSection
  const reorientData: ReorientData = {
    last_active_at: unified.reorient.last_active_at,
    last_active_relative: unified.reorient.last_active_relative,
    // Empty — the dashboard UI moved to the unified attention model (S157 WP5).
    // The field is retained on `ReorientData` because MCP dashboard tooling
    // still consumes `fetchReorientData().urgent` server-side.
    urgent: [],
    team_changes: unified.reorient.team_changes,
    my_recent_work: unified.reorient.my_recent_work,
    bid_summary: unified.reorient.bid_summary,
    counts: {
      unread_notifications: unified.attention_sources.unread_notification_count,
      pending_reviews: unified.attention_sources.governance_review_count,
      stale_or_expired:
        unified.attention_sources.stale_content_count +
        unified.attention_sources.expired_content_count,
      quality_flags: unified.attention_sources.quality_flag_count,
    },
    generated_at: new Date().toISOString(),
    user_display_name: unified.reorient.user_display_name,
    has_display_name: unified.reorient.has_display_name,
    errors: unified.errors,
  };

  return (
    <>
      {/* Partial-failure banner — surfaces non-fatal sub-query errors from
          the unified dashboard fetch (and the page-level role lookup). Hidden
          when there are no warnings to show. */}
      {warnings.length > 0 && (
        <div className="mt-6">
          <WarningsBanner warnings={warnings} />
        </div>
      )}

      {/* MCP setup nudge — one-shot discoverability prompt for the MCP
          connector (S157 WP5, M5). Dismisses permanently via localStorage.
          Gated on KB having ≥1 item (P0-14) — no point nudging when empty. */}
      <div className="mt-6">
        <McpSetupNudge
          hasContent={
            unified.freshness_summary.fresh +
              unified.freshness_summary.aging +
              unified.freshness_summary.stale +
              unified.freshness_summary.expired >
            0
          }
        />
      </div>

      {/* Reorient Me — personalised briefing */}
      <div className="mt-6">
        <ReorientSection data={reorientData} />
      </div>

      {/* Two-column layout: Unified Attention + Active Bids */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <UnifiedAttentionSection
          items={allItems}
          userRole={unified.user_role}
        />
        <ActiveBidsSection bids={unified.active_bids} />
      </div>

      {/* Owned Content Health — personal content ownership card */}
      <div className="mt-6">
        <OwnedContentHealth />
      </div>

      {/* Content Performance — aggregate win-rate analytics */}
      <div className="mt-6">
        <ContentPerformanceSection />
      </div>

      {/* QuickStatsStrip — content health at a glance */}
      <div className="mt-6">
        <QuickStatsStrip
          freshness={unified.freshness_summary}
          activeBidCount={unified.active_bids.length}
          unreadNotificationCount={
            unified.attention_sources.unread_notification_count
          }
        />
      </div>

      {/* Compliance Status */}
      <div className="mt-6">
        <ComplianceStatusSection />
      </div>

      {/* Pipeline runs (admin-only, S152B WP4) — passive 24h health glance
          paired with Sentry alerting in `lib/pipeline/record-run.ts`. */}
      {unified.user_role === 'admin' && (
        <div className="mt-6">
          <PipelineRunsPanel />
        </div>
      )}

      {/* Recent Activity */}
      <section
        className="mt-6 rounded-lg border bg-card p-4"
        aria-label="Recent activity"
      >
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
          {BRANDING.productName}
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
