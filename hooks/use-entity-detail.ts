'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItemRef {
  id: string;
  title: string;
  content_type: string | null;
}

interface EntityRelationship {
  source_entity: string;
  relationship_type: string;
  target_entity: string;
  confidence: number;
}

export interface EntityDetail {
  canonical_name: string;
  entity_type: string;
  effective_type: string;
  has_type_override: boolean;
  mention_count: number;
  variant_names: string[];
  variant_count: number;
  types_seen: string[];
  has_type_conflict: boolean;
  content_items: ContentItemRef[];
  content_item_count: number;
  relationships: EntityRelationship[];
  relationship_count: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches entity detail from `/api/entities/{name}` using TanStack Query.
 *
 * - `enabled` controls whether the query fires (typically `open && !!name`).
 * - Cached results make re-opening the same panel instant.
 * - Includes a `saveMetadata` mutation that invalidates the detail cache on
 *   success.
 */
export function useEntityDetail(
  canonicalName: string | null,
  enabled: boolean,
) {
  const queryClient = useQueryClient();

  const query = useQuery<EntityDetail>({
    queryKey: queryKeys.entities.detail(canonicalName ?? ''),
    queryFn: () =>
      fetchJson<EntityDetail>(
        `/api/entities/${encodeURIComponent(canonicalName!)}`,
      ),
    enabled: enabled && !!canonicalName,
  });

  const saveMetadataMutation = useMutation<
    unknown,
    Error,
    Record<string, unknown>
  >({
    mutationFn: (metadata: Record<string, unknown>) =>
      mutationFetchJson(
        `/api/entities/${encodeURIComponent(canonicalName!)}/metadata`,
        metadata,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      if (canonicalName) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.entities.detail(canonicalName),
        });
      }
    },
  });

  return {
    /** The fetched entity detail, or undefined while loading / on error. */
    detail: query.data ?? null,
    /** True while the initial fetch is in flight (no cached data yet). */
    isLoading: query.isLoading,
    /** Error message if the fetch failed. */
    error: query.error?.message ?? null,

    /** Mutation to save metadata via PATCH. */
    saveMetadata: saveMetadataMutation.mutateAsync,
    /** True while the save request is in flight. */
    isSaving: saveMetadataMutation.isPending,
    /** Error from the most recent save attempt, or null. */
    saveError: saveMetadataMutation.error?.message ?? null,
    /** True if the last save succeeded (resets on next mutation). */
    saveSuccess: saveMetadataMutation.isSuccess,
    /** Reset the mutation state (clears success/error). */
    resetSaveState: saveMetadataMutation.reset,
  };
}
