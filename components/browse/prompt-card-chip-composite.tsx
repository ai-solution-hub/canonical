'use client';

/**
 * PromptCardChipComposite — renders a single "Browse by domain" card with
 * inline chips + a "More domains…" button. Used only by the F-1
 * chipComposite variant in `SearchPromptCards` (spec §1.20 §6).
 *
 * The chip container is a live region so screen-reader users hear an
 * announcement when chips populate from the `useTopDomains` query.
 */

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { useTopDomains } from '@/hooks/browse/use-top-domains';
import type { BrowseFilters } from '@/types/content';

/** Stable DOM id for `aria-labelledby` linking chip group → card heading. */
const CARD_TITLE_ID = 'browse-by-domain-title';

/** Max chips shown (spec §6.2 Option A). */
const CHIP_COUNT = 3;

interface PromptCardChipCompositeProps {
  title: string;
  description: string;
  moreLabel: string;
  /** Called with a domain preset when a chip is clicked. */
  onApplyFilter: (preset: Partial<BrowseFilters>) => void;
  /** Called when the "More domains…" button is clicked. */
  onOpenFilterPanel: (target: 'domain') => void;
}

export function PromptCardChipComposite({
  title,
  description,
  moreLabel,
  onApplyFilter,
  onOpenFilterPanel,
}: PromptCardChipCompositeProps) {
  const { domains: topDomains, isLoading, isError } = useTopDomains(CHIP_COUNT);
  const { getDomainNames, formatDomainName } = useTaxonomy();

  // Resolve chip sources per spec §6.2 fallback ladder:
  //   1. Top-N by item count (live from get_filter_counts RPC, cached 24h).
  //   2. First N active taxonomy names from the DB-driven taxonomy context.
  //   3. (handled below as the empty-state "Browse all domains" button.)
  const chipDomains = useMemo<ReadonlyArray<string>>(() => {
    if (!isLoading && !isError && topDomains.length > 0) {
      return topDomains.map((d) => d.domain);
    }
    // Fallback ladder step 2 — first N taxonomy names.
    const taxonomyNames = getDomainNames();
    return taxonomyNames.slice(0, CHIP_COUNT);
  }, [topDomains, isLoading, isError, getDomainNames]);

  const emptyState = !isLoading && chipDomains.length === 0;

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 transition-colors"
      data-testid="prompt-card-chip-composite"
    >
      <p id={CARD_TITLE_ID} className="text-sm font-medium text-foreground">
        {title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      {emptyState ? (
        // Empty-DB / no-taxonomy fallback (spec §6.2 step 5).
        <div className="mt-3">
          <button
            type="button"
            onClick={() => onOpenFilterPanel('domain')}
            aria-label="Browse all domains — open filter panel"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Browse all domains
            <ArrowRight className="size-3" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          {/* Live region: chips are data-fetched; announce when they
              populate (spec §6.6). */}
          <div
            role="group"
            aria-labelledby={CARD_TITLE_ID}
            aria-live="polite"
            aria-label="Domain filter chips"
            className="mt-3 flex flex-wrap gap-2"
          >
            {isLoading && chipDomains.length === 0 ? (
              // Skeleton chip placeholders while the RPC is in flight.
              <>
                <span
                  aria-hidden="true"
                  className="h-6 w-24 animate-pulse rounded-full bg-muted"
                />
                <span
                  aria-hidden="true"
                  className="h-6 w-28 animate-pulse rounded-full bg-muted"
                />
                <span
                  aria-hidden="true"
                  className="h-6 w-20 animate-pulse rounded-full bg-muted"
                />
                <span className="sr-only">Loading domains…</span>
              </>
            ) : (
              chipDomains.map((domain) => {
                const displayName = formatDomainName(domain);
                return (
                  <button
                    key={domain}
                    type="button"
                    onClick={() => onApplyFilter({ domain: [domain] })}
                    aria-label={`Filter to ${displayName}`}
                    className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {displayName}
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => onOpenFilterPanel('domain')}
              aria-label="Open filter panel to choose a different domain"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {moreLabel}
              <ArrowRight className="size-3" aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
