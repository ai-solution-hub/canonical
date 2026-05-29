'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import type {
  ReviewFilters as ReviewFiltersType,
  ReviewProgress,
} from '@/types/review';
// ReviewAssignmentInfo is used by other sub-hooks, not directly here

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/** @public */
export interface UseReviewSessionReturn {
  // Filter/sort
  filters: ReviewFiltersType;
  setFilters: React.Dispatch<React.SetStateAction<ReviewFiltersType>>;
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
 *
 * S215 W1: when `statusOverride` is provided (by the ReviewTabs parent),
 * the session boots with that status regardless of the URL `?status=`
 * value. Tabs are the source of truth for status post-S215; the URL
 * `?status=` parser is kept for backwards compatibility with legacy
 * deep-links (someone clicking an old `?status=draft` URL lands on the
 * Drafts tab via the page wrapper, NOT through this hook).
 */
export function useReviewSession(
  searchParams: ReadonlyURLSearchParams,
  statusOverride?: ReviewFiltersType['status'],
  unclassifiedOverride?: boolean,
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
    const assigned_to_me = searchParams.get('assigned_to_me') === 'true';
    // ID-63.12 — the "Unclassified" tab passes unclassifiedOverride; the
    // legacy URL parser path also honours `?unclassified=true` for deep links.
    const unclassified =
      unclassifiedOverride || searchParams.get('unclassified') === 'true';

    // statusOverride wins when provided (S215 ReviewTabs parent). Else
    // the legacy URL parser path runs unchanged.
    const resolvedStatus: ReviewFiltersType['status'] = statusOverride
      ? statusOverride
      : ['unverified', 'verified', 'flagged', 'draft', 'all'].includes(
            status ?? '',
          )
        ? (status as ReviewFiltersType['status'])
        : 'unverified';

    return {
      status: resolvedStatus,
      domain: domain.length > 0 ? domain : undefined,
      content_type: content_type.length > 0 ? content_type : undefined,
      source_file: source_file ?? undefined,
      source_document_id: source_document_id ?? undefined,
      assigned_to_me: assigned_to_me || undefined,
      unclassified: unclassified || undefined,
    };
    // Only compute once on mount — searchParams changes are handled by setFilters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Filter state
  // -----------------------------------------------------------------------

  const [filters, setFilters] = useState<ReviewFiltersType>(initialFilters);

  // Sync filters to URL search params for shareability.
  //
  // S215 W1: NO LONGER writes the `status` key — status is owned by the
  // ReviewTabs parent and encoded into the URL as `?tab=`. Writing
  // `status` here would cause two sources of truth and cause back-button
  // history to grow on every filter tweak. Tab-orthogonal filters
  // (domain, content_type, source_file, source_document_id,
  // assigned_to_me) continue to be written so deep-link sharing still
  // round-trips. The previous-session window.history.replaceState() is
  // preserved per `useReviewSession` semantics: filter writes are
  // history-replace, not history-push.
  //
  // Spec: docs/specs/review-page-tabs-refactor-spec.md §5 (URL state).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Remove only the keys this hook owns. We must NOT clobber `?tab=` or
    // any other unrelated query parameter the page renderer added.
    params.delete('status');
    params.delete('domain');
    params.delete('content_type');
    params.delete('source_file');
    params.delete('source_document_id');
    params.delete('assigned_to_me');
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
    if (filters.assigned_to_me) {
      params.set('assigned_to_me', 'true');
    }
    // ID-63.12 — round-trip the Unclassified-tab filter for deep-link sharing.
    params.delete('unclassified');
    if (filters.unclassified) {
      params.set('unclassified', 'true');
    }

    const search = params.toString();
    const newPath = search ? `/review?${search}` : '/review';
    window.history.replaceState(null, '', newPath);
  }, [filters]);

  const handleFiltersChange = useCallback((newFilters: ReviewFiltersType) => {
    setFilters(newFilters);
  }, []);

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
    setFilters,
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
