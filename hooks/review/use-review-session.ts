'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import type {
  ReviewFilters as ReviewFiltersType,
  ReviewProgress,
  ReviewQueueSortField,
} from '@/types/review';
import type { QueueSortField } from '@/components/review/review-queue-panel';
// ReviewAssignmentInfo is used by other sub-hooks, not directly here

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseReviewSessionReturn {
  // Filter/sort
  filters: ReviewFiltersType;
  serverSort: ReviewQueueSortField | undefined;
  queueSort: QueueSortField;
  setFilters: React.Dispatch<React.SetStateAction<ReviewFiltersType>>;
  setQueueSort: (sort: QueueSortField) => void;
  handleFiltersChange: (newFilters: ReviewFiltersType) => void;

  // Progress
  progress: ReviewProgress;
  setProgress: React.Dispatch<React.SetStateAction<ReviewProgress>>;

  // Announcements
  announcement: string;
  setAnnouncement: (text: string) => void;

  // UI toggles
  showFlagInput: boolean;
  flagDetails: string;
  showQueuePanel: boolean;
  setShowFlagInput: (show: boolean) => void;
  setFlagDetails: (details: string) => void;
  handleTogglePanel: () => void;
  flagInputRef: React.RefObject<HTMLInputElement | null>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages ephemeral session state: filters, progress, UI toggles,
 * announcements. Pure client state — no server fetching.
 */
export function useReviewSession(
  searchParams: ReadonlyURLSearchParams,
): UseReviewSessionReturn {
  // -----------------------------------------------------------------------
  // Initialise filters from URL search params (for shareability / back-button)
  // -----------------------------------------------------------------------

  const initialFilters = useMemo((): ReviewFiltersType => {
    const status = searchParams.get('status');
    const domain = searchParams.getAll('domain').filter(Boolean);
    const content_type = searchParams.getAll('content_type').filter(Boolean);
    const source_file = searchParams.get('source_file');
    const source_document_id = searchParams.get('source_document_id');

    return {
      status: ['unverified', 'verified', 'flagged', 'draft', 'all'].includes(
        status ?? '',
      )
        ? (status as ReviewFiltersType['status'])
        : 'unverified',
      domain: domain.length > 0 ? domain : undefined,
      content_type: content_type.length > 0 ? content_type : undefined,
      source_file: source_file ?? undefined,
      source_document_id: source_document_id ?? undefined,
    };
    // Only compute once on mount — searchParams changes are handled by setFilters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Filter state
  // -----------------------------------------------------------------------

  const [filters, setFilters] = useState<ReviewFiltersType>(initialFilters);

  // Sync filters to URL search params for shareability
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'unverified') {
      params.set('status', filters.status);
    }
    if (filters.domain?.length) {
      for (const d of filters.domain) {
        params.append('domain', d);
      }
    }
    if (filters.content_type?.length) {
      for (const ct of filters.content_type) {
        params.append('content_type', ct);
      }
    }
    if (filters.source_file) {
      params.set('source_file', filters.source_file);
    }
    if (filters.source_document_id) {
      params.set('source_document_id', filters.source_document_id);
    }

    const search = params.toString();
    const newPath = search ? `/review?${search}` : '/review';
    window.history.replaceState(null, '', newPath);
  }, [filters]);

  const handleFiltersChange = useCallback((newFilters: ReviewFiltersType) => {
    setFilters(newFilters);
  }, []);

  // -----------------------------------------------------------------------
  // Sort state
  // -----------------------------------------------------------------------

  const [queueSort, setQueueSortInternal] = useState<QueueSortField>('default');

  /** Map client-side sort field to server-side API sort parameter */
  const apiSortForQueueSort = useCallback(
    (sort: QueueSortField): ReviewQueueSortField | undefined => {
      if (sort === 'confidence') return 'confidence_asc';
      if (sort === 'quality_score') return 'quality_score_asc';
      return undefined; // Other sorts are client-side only
    },
    [],
  );

  const [serverSort, setServerSort] = useState<
    ReviewQueueSortField | undefined
  >(undefined);

  const setQueueSort = useCallback(
    (sort: QueueSortField) => {
      setQueueSortInternal(sort);
      const newServerSort = apiSortForQueueSort(sort);
      setServerSort(newServerSort);
    },
    [apiSortForQueueSort],
  );

  // -----------------------------------------------------------------------
  // Progress state
  // -----------------------------------------------------------------------

  const [progress, setProgress] = useState<ReviewProgress>({
    verified: 0,
    flagged: 0,
    skipped: 0,
    total: 0,
    sessionReviewed: 0,
  });

  // -----------------------------------------------------------------------
  // Announcements (screen reader a11y)
  // -----------------------------------------------------------------------

  const [announcement, setAnnouncement] = useState('');

  // -----------------------------------------------------------------------
  // UI toggles
  // -----------------------------------------------------------------------

  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagDetails, setFlagDetails] = useState('');
  const [showQueuePanel, setShowQueuePanel] = useState(false);

  const handleTogglePanel = useCallback(() => {
    setShowQueuePanel((prev) => !prev);
  }, []);

  const flagInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    filters,
    serverSort,
    queueSort,
    setFilters,
    setQueueSort,
    handleFiltersChange,
    progress,
    setProgress,
    announcement,
    setAnnouncement,
    showFlagInput,
    flagDetails,
    showQueuePanel,
    setShowFlagInput,
    setFlagDetails,
    handleTogglePanel,
    flagInputRef,
  };
}
