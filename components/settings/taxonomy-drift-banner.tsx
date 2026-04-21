'use client';

import { useState } from 'react';
import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchTaxonomySyncStatus, mutationFetchJson } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxonomyDriftBannerProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Taxonomy drift-detection banner.
 *
 * Fetches `/api/admin/taxonomy-sync/status` on mount via TanStack Query.
 * Renders a warning when the live taxonomy diverges from the last synced
 * classification prompt. "Regenerate now" dispatches a GitHub Actions
 * workflow; "Dismiss" hides the banner for the current mount only.
 *
 * Accessibility: `role="status"` + `aria-live="polite"` so screen readers
 * announce the drift without pre-empting the rest of the page. Icon plus
 * text -- never colour alone for meaning. Buttons are keyboard-focusable
 * with focus-visible rings via the standard Button primitive.
 *
 * Spec: P0-TX SS3.2.4, AC-5/6/7.
 */
export function TaxonomyDriftBanner({ className }: TaxonomyDriftBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.taxonomySyncStatus,
    queryFn: fetchTaxonomySyncStatus,
    // Only fetch once per mount -- no aggressive polling
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const regenerateMutation = useMutation({
    mutationFn: () =>
      mutationFetchJson<{ dispatched: boolean; reason?: string; run_id?: string }>(
        '/api/admin/taxonomy-sync',
        {},
      ),
    onSuccess: (result) => {
      if (result.dispatched) {
        toast.success(
          'Sync dispatched -- changes will deploy in ~2–3 minutes',
        );
      } else {
        toast.success('Taxonomy is already in sync');
      }
      // Refresh drift status
      queryClient.invalidateQueries({
        queryKey: queryKeys.taxonomySyncStatus,
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to dispatch taxonomy sync');
    },
  });

  // Don't render while loading, on error, when in sync, or when dismissed
  if (isLoading || isError || !data || data.in_sync || dismissed) {
    return null;
  }

  const headingId = 'taxonomy-drift-banner-heading';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby={headingId}
      className={`rounded-md border border-status-warning/30 bg-status-warning/10 p-4${className ? ` ${className}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-status-warning"
            aria-hidden="true"
          />
          <div>
            <p
              id={headingId}
              className="text-sm font-medium text-status-warning"
            >
              Taxonomy has changed since the last sync
            </p>
            <p className="mt-1 text-sm text-foreground">
              The classification prompt and plugin files are out of date.
              Regenerate to apply your taxonomy changes to the AI pipeline.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5 border-status-warning/40 text-status-warning hover:bg-status-warning/10"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
              aria-label="Regenerate taxonomy sync files"
            >
              <RefreshCw
                className={`size-3.5${regenerateMutation.isPending ? ' animate-spin' : ''}`}
                aria-hidden="true"
              />
              {regenerateMutation.isPending
                ? 'Dispatching…'
                : 'Regenerate now'}
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss taxonomy drift warning"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
