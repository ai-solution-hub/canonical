'use client';

import { createContext, useContext, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query/query-keys';
import {
  formatSubtopic as formatSubtopicUtil,
  formatDomainName as formatDomainNameUtil,
  FALLBACK_COLOUR_MAP,
} from '@/lib/taxonomy/taxonomy-format';
import type { TaxonomyDomain, TaxonomySubtopic } from '@/types/taxonomy';

// Re-export shared types so existing `import { TaxonomyDomain } from '@/contexts/taxonomy-context'`
// continues to work (even though no external file currently does this).
export type {
  TaxonomyProvenance,
  TaxonomyDomain,
  TaxonomySubtopic,
} from '@/types/taxonomy';

interface TaxonomyContextValue {
  /** All active taxonomy domains, ordered by display_order */
  domains: TaxonomyDomain[];
  /** All active taxonomy subtopics, ordered by display_order */
  subtopics: TaxonomySubtopic[];
  /** Whether taxonomy data is still loading */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Get ordered array of domain names */
  getDomainNames: () => string[];
  /** Get subtopic names for a given domain name */
  getSubtopics: (domainName: string) => string[];
  /** Get CSS colour key for a domain name (maps to --domain-{key}-*) */
  getDomainColourKey: (domainName: string) => string;
  /** Format a subtopic slug for display (kebab-case to Title Case) */
  formatSubtopic: (subtopic: string) => string;
  /** Format a domain name for display (kebab-case to Title Case) */
  formatDomainName: (domain: string) => string;
  /** Force re-fetch taxonomy from DB (called after admin mutations) */
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchTaxonomyDomains(): Promise<TaxonomyDomain[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('taxonomy_domains')
    .select(
      'id, name, display_name, display_order, colour, is_active, provenance',
    )
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) throw new Error(`Failed to fetch domains: ${error.message}`);
  return (data ?? []) as TaxonomyDomain[];
}

async function fetchTaxonomySubtopics(): Promise<TaxonomySubtopic[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('taxonomy_subtopics')
    .select(
      'id, domain_id, name, display_name, display_order, is_active, provenance, description',
    )
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (error) throw new Error(`Failed to fetch subtopics: ${error.message}`);
  return (data ?? []) as TaxonomySubtopic[];
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const TaxonomyContext = createContext<TaxonomyContextValue | null>(null);

export function TaxonomyProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const {
    data: domains = [],
    isLoading: domainsLoading,
    error: domainsError,
  } = useQuery({
    queryKey: queryKeys.taxonomy.domains,
    queryFn: fetchTaxonomyDomains,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: subtopics = [],
    isLoading: subtopicsLoading,
    error: subtopicsError,
  } = useQuery({
    queryKey: queryKeys.taxonomy.subtopics,
    queryFn: fetchTaxonomySubtopics,
    staleTime: 5 * 60 * 1000,
  });

  const loading = domainsLoading || subtopicsLoading;
  const rawError = domainsError ?? subtopicsError;
  const error = rawError
    ? rawError instanceof Error
      ? rawError.message
      : 'Failed to load taxonomy'
    : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.taxonomy.all });
  }, [queryClient]);

  // Build lookup maps for efficient access
  const domainByName = useMemo(() => {
    const map = new Map<string, TaxonomyDomain>();
    for (const d of domains) {
      map.set(d.name, d);
    }
    return map;
  }, [domains]);

  const subtopicsByDomainId = useMemo(() => {
    const map = new Map<string, TaxonomySubtopic[]>();
    for (const s of subtopics) {
      const existing = map.get(s.domain_id) ?? [];
      existing.push(s);
      map.set(s.domain_id, existing);
    }
    return map;
  }, [subtopics]);

  const getDomainNames = useCallback((): string[] => {
    return domains.map((d) => d.name);
  }, [domains]);

  const getSubtopics = useCallback(
    (domainName: string): string[] => {
      const domain = domainByName.get(domainName);
      if (!domain) return [];
      const subs = subtopicsByDomainId.get(domain.id) ?? [];
      return subs.map((s) => s.name);
    },
    [domainByName, subtopicsByDomainId],
  );

  const getDomainColourKey = useCallback(
    (domainName: string): string => {
      const domain = domainByName.get(domainName);
      if (domain?.colour) return domain.colour;
      // Fallback for known domains
      return FALLBACK_COLOUR_MAP[domainName] ?? 'corporate';
    },
    [domainByName],
  );

  const subtopicByName = useMemo(() => {
    const map = new Map<string, TaxonomySubtopic>();
    for (const s of subtopics) {
      map.set(s.name, s);
    }
    return map;
  }, [subtopics]);

  const formatSubtopic = useCallback(
    (subtopic: string): string => {
      const record = subtopicByName.get(subtopic);
      if (record?.display_name) return record.display_name;
      return formatSubtopicUtil(subtopic);
    },
    [subtopicByName],
  );

  const formatDomainName = useCallback(
    (domain: string): string => {
      const domainRecord = domainByName.get(domain);
      if (domainRecord?.display_name) return domainRecord.display_name;
      return formatDomainNameUtil(domain);
    },
    [domainByName],
  );

  const contextValue: TaxonomyContextValue = useMemo(
    () => ({
      domains,
      subtopics,
      loading,
      error,
      getDomainNames,
      getSubtopics,
      getDomainColourKey,
      formatSubtopic,
      formatDomainName,
      refresh,
    }),
    [
      domains,
      subtopics,
      loading,
      error,
      getDomainNames,
      getSubtopics,
      getDomainColourKey,
      formatSubtopic,
      formatDomainName,
      refresh,
    ],
  );

  return (
    <TaxonomyContext.Provider value={contextValue}>
      {children}
    </TaxonomyContext.Provider>
  );
}

export function useTaxonomy(): TaxonomyContextValue {
  const ctx = useContext(TaxonomyContext);
  if (!ctx) throw new Error('useTaxonomy must be used within TaxonomyProvider');
  return ctx;
}
