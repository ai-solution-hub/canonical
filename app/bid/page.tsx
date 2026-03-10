'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BidListCard } from '@/components/bid-list-card';
import { BidCreationForm } from '@/components/bid-creation-form';
import { useUserRole } from '@/hooks/use-user-role';
import { toast } from 'sonner';
import type { Bid, BidMetadata, BidState } from '@/types/bid';

type StatusFilter = 'all' | 'draft' | 'active' | 'submitted' | 'completed';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'active', label: 'Active' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'completed', label: 'Completed' },
];

/** Maps each filter to the bid states it includes */
const FILTER_STATES: Record<StatusFilter, BidState[] | null> = {
  all: null,
  draft: ['draft', 'questions_extracted'],
  active: ['matching', 'drafting', 'in_review', 'ready_for_export'],
  submitted: ['submitted'],
  completed: ['won', 'lost', 'withdrawn'],
};

export default function BidsPage() {
  const router = useRouter();
  const { canEdit } = useUserRole();
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const fetchBids = useCallback(async () => {
    try {
      const response = await fetch('/api/bids');
      if (!response.ok) throw new Error('Failed to fetch bids');
      const data = await response.json();
      setBids(data.bids ?? []);
    } catch (err) {
      console.error('Failed to load bids:', err);
      toast.error('Failed to load bids');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBids();
  }, [fetchBids]);

  const filteredBids = useMemo(() => {
    const allowedStates = FILTER_STATES[statusFilter];
    if (!allowedStates) return bids;
    return bids.filter((bid) => {
      const bidStatus = (bid.status ??
        (bid.domain_metadata as BidMetadata).status) as BidState;
      return allowedStates.includes(bidStatus);
    });
  }, [bids, statusFilter]);

  function handleBidCreated(bid: { id: string; name: string }) {
    toast.success(`Bid "${bid.name}" created`);
    router.push(`/bid/${bid.id}`);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bids</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage bid submissions and tender responses
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="size-4" aria-hidden="true" />
            New Bid
          </Button>
        )}
      </div>

      {/* Status filter */}
      {!loading && bids.length > 0 && (
        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={statusFilter === filter.id}
              onClick={() => setStatusFilter(filter.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                statusFilter === filter.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="mt-6">
        {loading ? (
          <BidListSkeleton />
        ) : bids.length === 0 ? (
          <EmptyState
            canEdit={canEdit}
            onCreateClick={() => setShowCreate(true)}
          />
        ) : filteredBids.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No bids match the selected filter.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredBids.map((bid) => (
              <BidListCard key={bid.id} bid={bid} />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <BidCreationForm
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleBidCreated}
      />
    </div>
  );
}

function EmptyState({ canEdit, onCreateClick }: { canEdit: boolean; onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Briefcase className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-medium text-foreground">No bids yet</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first bid to start managing tender responses.
      </p>
      {canEdit && (
        <Button onClick={onCreateClick} className="mt-4 gap-1.5">
          <Plus className="size-4" aria-hidden="true" />
          Create Bid
        </Button>
      )}
    </div>
  );
}

function BidListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between">
            <div className="h-5 w-48 rounded bg-muted" />
            <div className="h-5 w-20 rounded-full bg-muted" />
          </div>
          <div className="mt-3 flex gap-4">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
