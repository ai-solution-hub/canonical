'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AttentionCounts {
  reviewQueueCount: number;
  governanceReviewCount: number;
}

/**
 * Banner shown at the top of the home page when items need attention.
 *
 * Shows counts for:
 * - Content review queue (unverified items)
 * - Governance reviews pending
 *
 * Dismissible per session.
 */
export function NeedsAttentionBanner({ className }: { className?: string }) {
  const [counts, setCounts] = useState<AttentionCounts | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCounts() {
      try {
        // Fetch review queue count
        const reviewRes = await fetch(
          '/api/review/stats',
        );
        let reviewCount = 0;
        if (reviewRes.ok) {
          const reviewData = await reviewRes.json();
          reviewCount = reviewData.unverified ?? 0;
        }

        // Fetch governance review count (items pending governance review)
        const govRes = await fetch(
          '/api/governance/review?count_only=true',
        );
        let govCount = 0;
        if (govRes.ok) {
          const govData = await govRes.json();
          govCount = govData.count ?? 0;
        }

        setCounts({
          reviewQueueCount: reviewCount,
          governanceReviewCount: govCount,
        });
      } catch {
        // Non-critical — fail silently
      } finally {
        setLoading(false);
      }
    }

    fetchCounts();
  }, []);

  if (loading || dismissed || !counts) return null;

  const total = counts.reviewQueueCount + counts.governanceReviewCount;
  if (total === 0) return null;

  return (
    <div
      className={cn(
        'relative rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30',
        className,
      )}
      role="alert"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-foreground"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss banner"
      >
        <X className="size-4" />
      </Button>

      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Items Need Attention
          </h3>
          <div className="flex flex-wrap gap-4 text-sm">
            {counts.reviewQueueCount > 0 && (
              <Link
                href="/review"
                className="flex items-center gap-1.5 text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
              >
                <Eye className="size-3.5" />
                <span>
                  {counts.reviewQueueCount} unverified{' '}
                  {counts.reviewQueueCount === 1 ? 'item' : 'items'}
                </span>
              </Link>
            )}
            {counts.governanceReviewCount > 0 && (
              <Link
                href="/review?status=all"
                className="flex items-center gap-1.5 text-amber-800 underline-offset-2 hover:underline dark:text-amber-300"
              >
                <ShieldAlert className="size-3.5" />
                <span>
                  {counts.governanceReviewCount} governance{' '}
                  {counts.governanceReviewCount === 1 ? 'review' : 'reviews'}{' '}
                  pending
                </span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
