'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Briefcase,
  LayoutGrid,
  List,
  Calendar,
  Building2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProcurementListCard } from '@/components/procurement/procurement-list-card';
import { ProcurementWorkflowBadge } from '@/components/procurement/procurement-workflow-indicator';
import { ProcurementCreationWizard } from '@/components/procurement/procurement-creation-wizard';
import { useUserRole } from '@/hooks/use-user-role';
import { useViewMode } from '@/hooks/ui/use-view-mode';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/domains/procurement/procurement-helpers';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ErrorBoundary } from '@/components/shared/error-boundary';
import type {
  Procurement,
  ProcurementMetadata,
  ProcurementWorkflowState,
} from '@/types/procurement';
import { logger } from '@/lib/logger/client';

const PROCUREMENTS_PER_PAGE = 20;

type StatusFilter = 'all' | 'draft' | 'active' | 'submitted' | 'completed';
type SortOption = 'newest' | 'deadline' | 'alphabetical';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'active', label: 'Active' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'completed', label: 'Completed' },
];

/** Maps each filter to the bid states it includes */
const FILTER_STATES: Record<StatusFilter, ProcurementWorkflowState[] | null> = {
  all: null,
  draft: ['draft', 'questions_extracted'],
  active: ['matching', 'drafting', 'in_review', 'ready_for_export'],
  submitted: ['submitted'],
  completed: ['won', 'lost', 'withdrawn'],
};

export default function FormsPage() {
  const router = useRouter();
  const { canEdit } = useUserRole();
  const [bids, setProcurements] = useState<Procurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const { viewMode, setViewMode } = useViewMode('kb-bid-view', 'grid');
  const [currentPage, setCurrentPage] = useState(1);

  const fetchProcurements = useCallback(async () => {
    try {
      const response = await fetch('/api/procurement');
      if (!response.ok) throw new Error('Failed to fetch procurements');
      const data = await response.json();
      setProcurements(data.procurements ?? []);
    } catch (err) {
      logger.error({ err }, 'Failed to load procurements');
      toast.error('Failed to load procurements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProcurements();
  }, [fetchProcurements]);

  const filteredProcurements = useMemo(() => {
    const allowedStates = FILTER_STATES[statusFilter];
    const result = allowedStates
      ? bids.filter((bid) => {
          const procurementStatus = bid.status as ProcurementWorkflowState;
          return allowedStates.includes(procurementStatus);
        })
      : [...bids];

    // Apply sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        case 'deadline': {
          const deadlineA = (a.domain_metadata as ProcurementMetadata).deadline;
          const deadlineB = (b.domain_metadata as ProcurementMetadata).deadline;
          // Bids without deadlines sort to the end
          if (!deadlineA && !deadlineB) return 0;
          if (!deadlineA) return 1;
          if (!deadlineB) return -1;
          return new Date(deadlineA).getTime() - new Date(deadlineB).getTime();
        }
        case 'alphabetical':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [bids, statusFilter, sortBy]);

  // Pagination
  const totalPages = Math.max(
    1,
    Math.ceil(filteredProcurements.length / PROCUREMENTS_PER_PAGE),
  );
  const paginatedProcurements = filteredProcurements.slice(
    (currentPage - 1) * PROCUREMENTS_PER_PAGE,
    currentPage * PROCUREMENTS_PER_PAGE,
  );

  // Reset to page 1 when filter or sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, sortBy]);

  function handleProcurementCreated(bid: { id: string; name: string }) {
    toast.success(`Procurement "${bid.name}" created`);
    router.push(`/procurement/${bid.id}`);
  }

  return (
    <ErrorBoundary label="Error loading procurements">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Procurement
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage your procurement engagements and the forms within them
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="size-4" aria-hidden="true" />
              New Procurement
            </Button>
          )}
        </div>

        {/* Status filter and sort */}
        {!loading && bids.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Filter by status"
            >
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={statusFilter === filter.id}
                  onClick={() => setStatusFilter(filter.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                    statusFilter === filter.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div
                className="inline-flex rounded-md border"
                role="group"
                aria-label="View mode"
              >
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  onClick={() => setViewMode('grid')}
                  aria-pressed={viewMode === 'grid'}
                  aria-label="Grid view"
                  className="rounded-r-none border-r border-border"
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                  aria-label="List view"
                  className="rounded-l-none"
                >
                  <List className="size-4" />
                </Button>
              </div>
              <Select
                value={sortBy}
                onValueChange={(v) => setSortBy(v as SortOption)}
              >
                <SelectTrigger
                  className="h-8 w-[160px] text-xs"
                  aria-label="Sort procurements by"
                >
                  <SelectValue placeholder="Sort by..." />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="deadline">Deadline soonest</SelectItem>
                  <SelectItem value="alphabetical">Alphabetical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="mt-6">
          {loading ? (
            <ProcurementListSkeleton viewMode={viewMode} />
          ) : bids.length === 0 ? (
            <EmptyState
              canEdit={canEdit}
              onCreateClick={() => setShowCreate(true)}
            />
          ) : filteredProcurements.length === 0 ? (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              role="status"
            >
              No procurements match the selected filter.
            </p>
          ) : viewMode === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {paginatedProcurements.map((bid) => (
                <ProcurementListCard key={bid.id} bid={bid} />
              ))}
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {paginatedProcurements.map((bid) => (
                <ProcurementListRow key={bid.id} procurement={bid} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && filteredProcurements.length > PROCUREMENTS_PER_PAGE && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span
              className="text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}

        {/* Create wizard */}
        <ProcurementCreationWizard
          open={showCreate}
          onOpenChange={setShowCreate}
          onCreated={handleProcurementCreated}
        />
      </div>
    </ErrorBoundary>
  );
}

function EmptyState({
  canEdit,
  onCreateClick,
}: {
  canEdit: boolean;
  onCreateClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <Briefcase
        className="size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h2 className="mt-4 text-lg font-medium text-foreground">
        No procurements yet
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Create your first procurement to start managing tender responses.
      </p>
      {canEdit && (
        <Button onClick={onCreateClick} className="mt-4 gap-1.5">
          <Plus className="size-4" aria-hidden="true" />
          Create Procurement
        </Button>
      )}
    </div>
  );
}

function ProcurementListRow({ procurement }: { procurement: Procurement }) {
  const metadata = procurement.domain_metadata as ProcurementMetadata;
  const procurementStatus =
    procurement.status as import('@/types/procurement').ProcurementWorkflowState;
  const proximity = getDeadlineProximity(metadata.deadline);

  return (
    <Link
      href={`/procurement/${procurement.id}`}
      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {procurement.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          {metadata.buyer && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3" aria-hidden="true" />
              {metadata.buyer}
            </span>
          )}
          {metadata.deadline && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" aria-hidden="true" />
              {formatDateUK(metadata.deadline)}
            </span>
          )}
          {proximity && (
            <span
              className={cn(
                'inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium',
                proximity.isOverdue
                  ? 'bg-bid-overdue-bg text-bid-overdue'
                  : 'bg-status-warning/10 text-status-warning',
              )}
            >
              {proximity.label}
            </span>
          )}
        </div>
      </div>
      <ProcurementWorkflowBadge state={procurementStatus} />
    </Link>
  );
}

function ProcurementListSkeleton({ viewMode }: { viewMode: 'grid' | 'list' }) {
  if (viewMode === 'list') {
    return (
      <div className="divide-y rounded-lg border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex animate-pulse items-center gap-4 px-4 py-3"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-48 rounded bg-muted" />
              <div className="flex gap-3">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
              </div>
            </div>
            <div className="h-5 w-20 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    );
  }

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
