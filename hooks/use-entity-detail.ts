'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';

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

/** Response shape from PATCH /api/entities/[canonical_name]/type */
export interface EntityTypeChangeResponse {
  updated: boolean;
  canonical_name: string;
  entity_type: string;
  mentions_updated: number;
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
 * - Includes a `changeType` mutation with optimistic update, rollback on
 *   error, and cache invalidation on settle.
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

  // ─── Type change mutation (P1-22) ────────────────────────────────────
  const changeTypeMutation = useMutation<
    EntityTypeChangeResponse,
    Error,
    string,
    { previousDetail: EntityDetail | undefined }
  >({
    mutationFn: async (newType: string) => {
      const res = await fetch(
        `/api/entities/${encodeURIComponent(canonicalName!)}/type`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: newType }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update type');
      return data as EntityTypeChangeResponse;
    },

    onMutate: async (newType) => {
      // Cancel in-flight queries so they don't overwrite our optimistic update
      await queryClient.cancelQueries({
        queryKey: queryKeys.entities.detail(canonicalName!),
      });

      // Snapshot the previous detail cache for rollback
      const previousDetail = queryClient.getQueryData<EntityDetail>(
        queryKeys.entities.detail(canonicalName!),
      );

      // Optimistically update the detail cache
      if (previousDetail) {
        queryClient.setQueryData<EntityDetail>(
          queryKeys.entities.detail(canonicalName!),
          {
            ...previousDetail,
            effective_type: newType,
            has_type_override: true,
          },
        );
      }

      return { previousDetail };
    },

    onError: (err, _newType, context) => {
      // Rollback to the snapshot on failure
      if (context?.previousDetail) {
        queryClient.setQueryData(
          queryKeys.entities.detail(canonicalName!),
          context.previousDetail,
        );
      }
      toast.error(err.message || 'Failed to update entity type');
    },

    onSuccess: (data) => {
      const displayName = canonicalName
        ? formatEntityDisplayName(canonicalName)
        : 'Entity';
      toast.success(
        `Updated "${displayName}" type to ${data.entity_type} (${data.mentions_updated} mentions)`,
      );
    },

    onSettled: () => {
      // Refetch to ensure cache is accurate regardless of outcome
      if (canonicalName) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.entities.detail(canonicalName),
        });
        // Also invalidate the entity list to reflect the type change
        queryClient.invalidateQueries({
          queryKey: queryKeys.entities.all,
        });
        // Browse-panel entity filter options cache sits outside
        // queryKeys.entities.all — invalidate explicitly so downstream
        // filter data reflects the new type.
        queryClient.invalidateQueries({
          queryKey: queryKeys.filters.entities,
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

    /** Mutation to change entity type via PATCH (P1-22). Optimistic update. */
    changeType: changeTypeMutation.mutate,
    /** True while the type-change request is in flight. */
    isChangingType: changeTypeMutation.isPending,
    /** Error from the most recent type-change attempt, or null. */
    changeTypeError: changeTypeMutation.error?.message ?? null,
  };
}
