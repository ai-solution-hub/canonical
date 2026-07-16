'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { Json } from '@/supabase/types/database.types';

/**
 * API contract for intelligence workspaces.
 *
 * Post-T2 (S246 WP2b): the 3 intelligence-context fields are typed top-level
 * fields on the API response, fed from the `intelligence_workspaces` satellite
 * via JOIN in the `/api/intelligence/*` routes. The pre-T2 `workspaces.type`
 * text column is gone — the discriminator is `application_type_id` (FK to
 * `application_types`), but API consumers should treat this hook's mere
 * existence as evidence that the workspace IS an intelligence workspace; no
 * client-side type-key check is required.
 *
 * `domain_metadata` stays as loose `Json | null` because non-intelligence
 * workspaces still use it for their own per-domain payloads.
 */
export interface IntelligenceWorkspace {
  id: string;
  name: string;
  description: string | null;
  /** FK to `application_types.id` (post-T2 discriminator). */
  application_type_id: string;
  /** FK to `company_profiles.id`; null when no profile is bound. */
  company_profile_id: string | null;
  /** FK to `guides.id`; null when no guide is bound. */
  guide_id: string | null;
  /** SI-L5: admin-only relevance cutoff (0.1–1.0); null when unset. */
  relevance_threshold: number | null;
  /**
   * Loose JSONB carrier for non-intelligence-context payloads. The 3
   * intelligence-context fields are surfaced as typed top-level fields
   * (above) — do NOT read them from here.
   */
  domain_metadata: Json | null;
  is_archived: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  /** Joined from company_profiles */
  company_profile_name?: string;
  /** Aggregate counts */
  source_count?: number;
  article_count?: number;
  passed_article_count?: number;
}

/** @public */
export interface IntelligenceWorkspaceInput {
  name: string;
  description?: string;
  company_profile_id: string;
}

/**
 * Update payload for PATCH /api/intelligence/workspaces/:id.
 * `relevance_threshold` is admin-only and is written server-side to the
 * `intelligence_workspaces.relevance_threshold` typed satellite column
 * (post-T2 — pre-T2 it was merged into `workspaces.domain_metadata` JSONB).
 */
/** @public */
export interface IntelligenceWorkspaceUpdateInput {
  name?: string;
  description?: string;
  /** SI-L5: relevance threshold between 0.1 and 1.0 (admin only) */
  relevance_threshold?: number;
}

export function useIntelligenceWorkspaces() {
  return useQuery({
    queryKey: queryKeys.intelligence.workspaces.list,
    queryFn: () =>
      fetchJson<IntelligenceWorkspace[]>('/api/intelligence/workspaces'),
  });
}

export function useIntelligenceWorkspace(id: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.workspaces.detail(id),
    queryFn: () =>
      fetchJson<IntelligenceWorkspace>(`/api/intelligence/workspaces/${id}`),
    enabled: !!id,
  });
}

export function useCreateIntelligenceWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IntelligenceWorkspaceInput) =>
      mutationFetchJson<IntelligenceWorkspace>(
        '/api/intelligence/workspaces',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.workspaces.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      toast.success('Intelligence workspace created');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateIntelligenceWorkspace(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IntelligenceWorkspaceUpdateInput) =>
      mutationFetchJson<IntelligenceWorkspace>(
        `/api/intelligence/workspaces/${id}`,
        data,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.workspaces.all,
      });
      toast.success('Workspace updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
