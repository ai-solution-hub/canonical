'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import {
  isProfileComplete,
  type OrganisationProfile,
  type OrganisationProfileStatus,
} from '@/lib/organisation-profile';

const EDIT_URL = '/settings?section=organisation';

/**
 * Client-side hook returning the primary organisation profile status.
 *
 * Consumers:
 * - Dashboard nudge (P1-15 Phase 1)
 * - P1-10 search cold-start (Phase 2)
 * - Bid creation wizard (Phase 2)
 */
export function useOrganisationProfile(): OrganisationProfileStatus {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.organisationProfile.primary,
    queryFn: () =>
      fetchJson<{ profile: OrganisationProfile | null }>(
        '/api/organisation/profile',
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const profile = data?.profile ?? null;

  const isComplete = useMemo(() => isProfileComplete(profile), [profile]);

  return {
    profile,
    isLoaded: !isLoading,
    isComplete,
    editUrl: EDIT_URL,
  };
}
