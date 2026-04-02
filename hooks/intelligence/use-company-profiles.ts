'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export interface CompanyProfile {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website_url: string | null;
  sectors: string[];
  services: string[];
  certifications: string[];
  geographic_scope: string[];
  competitors: Array<{ name: string; website?: string; notes?: string }>;
  target_customers: string | null;
  value_proposition: string | null;
  key_topics: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CompanyProfileInput = Omit<
  CompanyProfile,
  'id' | 'is_active' | 'created_by' | 'created_at' | 'updated_at'
>;

export function useCompanyProfiles() {
  return useQuery({
    queryKey: queryKeys.intelligence.profiles.list,
    queryFn: () => fetchJson<CompanyProfile[]>('/api/intelligence/profiles'),
  });
}

export function useCompanyProfile(id: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.profiles.detail(id),
    queryFn: () =>
      fetchJson<CompanyProfile>(`/api/intelligence/profiles/${id}`),
    enabled: !!id,
  });
}

export function useCreateCompanyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CompanyProfileInput) =>
      mutationFetchJson<CompanyProfile>('/api/intelligence/profiles', data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.profiles.all,
      });
      toast.success('Company profile created');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateCompanyProfile(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CompanyProfileInput>) =>
      mutationFetchJson<CompanyProfile>(
        `/api/intelligence/profiles/${id}`,
        data,
        {
          method: 'PATCH',
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.profiles.all,
      });
      toast.success('Profile updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteCompanyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      mutationFetchJson<void>(
        `/api/intelligence/profiles/${id}`,
        {},
        {
          method: 'DELETE',
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.profiles.all,
      });
      toast.success('Profile removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
