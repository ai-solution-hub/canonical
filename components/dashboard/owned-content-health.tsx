'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OwnedHealthData {
  staleCount: number;
  expiredCount: number;
  totalOwned: number;
}

// ---------------------------------------------------------------------------
// Owned Content Health Card
// ---------------------------------------------------------------------------

/**
 * Dashboard card that shows the current user's owned content health.
 * Only renders when the user owns content with items needing attention.
 * Fetches data client-side to avoid adding overhead to the server-rendered
 * dashboard when the user has no owned content.
 */
export function OwnedContentHealth() {
  const [data, setData] = useState<OwnedHealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchOwnedHealth() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setLoading(false);
          return;
        }

        // Count stale items owned by current user
        const { count: staleCount } = await supabase
          .from('content_items')
          .select('id', { count: 'exact', head: true })
          .eq('content_owner_id', user.id)
          .eq('freshness', 'stale')
          .is('archived_at', null);

        // Count expired items owned by current user
        const { count: expiredCount } = await supabase
          .from('content_items')
          .select('id', { count: 'exact', head: true })
          .eq('content_owner_id', user.id)
          .eq('freshness', 'expired')
          .is('archived_at', null);

        // Count total owned items
        const { count: totalOwned } = await supabase
          .from('content_items')
          .select('id', { count: 'exact', head: true })
          .eq('content_owner_id', user.id)
          .is('archived_at', null);

        setData({
          staleCount: staleCount ?? 0,
          expiredCount: expiredCount ?? 0,
          totalOwned: totalOwned ?? 0,
        });
      } catch (err) {
        console.error('Failed to fetch owned content health:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchOwnedHealth();
  }, []);

  // Don't render while loading
  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border bg-card p-4 shadow-sm">
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading owned content health" />
      </div>
    );
  }

  // Don't render if user owns no content
  if (!data || data.totalOwned === 0) return null;

  const needsAttention = data.staleCount + data.expiredCount;

  // All owned content is healthy
  if (needsAttention === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border bg-card p-4 shadow-sm">
        <CheckCircle2
          className="mt-0.5 size-5 shrink-0 text-quality-good"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Your {data.totalOwned} owned {data.totalOwned === 1 ? 'item is' : 'items are'} all up to date
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            No stale or expired content in your ownership.
          </p>
        </div>
      </div>
    );
  }

  // Build detail text
  const parts: string[] = [];
  if (data.staleCount > 0) {
    parts.push(`${data.staleCount} stale`);
  }
  if (data.expiredCount > 0) {
    parts.push(`${data.expiredCount} expired`);
  }
  const detailText = parts.join(', ');

  // Build browse link filtered to owner + stale/expired
  const browseHref = '/browse?owner=me&freshness=stale,expired';

  return (
    <div
      className="group flex items-start gap-3 rounded-lg border border-border border-l-2 border-l-status-warning bg-card p-4 transition-colors hover:bg-accent/50"
      data-testid="owned-content-health"
    >
      <AlertTriangle
        className="mt-0.5 size-5 shrink-0 text-status-warning"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {needsAttention} of your {data.totalOwned} owned {data.totalOwned === 1 ? 'item needs' : 'items need'} attention
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {detailText} — review and refresh to keep your content current.
        </p>
        <div className="mt-1.5">
          <Link
            href={browseHref}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
            aria-label={`${needsAttention} owned items need attention — view in browse`}
          >
            View my stale content
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
