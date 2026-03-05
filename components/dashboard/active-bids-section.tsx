import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BidSummaryCard } from './bid-summary-card';
import type { ActiveBidSummary } from '@/lib/dashboard';

interface ActiveBidsSectionProps {
  bids: ActiveBidSummary[];
}

export function ActiveBidsSection({ bids }: ActiveBidsSectionProps) {
  return (
    <section aria-label="Active bids">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Active Bids
      </h2>

      {bids.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">No active bids</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a new bid to get started.
          </p>
          <Button asChild size="sm" className="mt-3 gap-1.5">
            <Link href="/bid">
              <Plus className="size-3.5" />
              New Bid
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {bids.map((bid) => (
            <BidSummaryCard key={bid.id} bid={bid} />
          ))}
        </div>
      )}
    </section>
  );
}
