'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  formatSubtopic as formatSubtopicUtil,
  formatDomainName as formatDomainNameUtil,
  FALLBACK_COLOUR_MAP,
} from '@/lib/taxonomy-format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaxonomyDomain {
  id: string;
  name: string;
  display_order: number;
  colour: string | null;
  is_active: boolean;
}

export interface TaxonomySubtopic {
  id: string;
  domain_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

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
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const TaxonomyContext = createContext<TaxonomyContextValue | null>(null);

export function TaxonomyProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [domains, setDomains] = useState<TaxonomyDomain[]>([]);
  const [subtopics, setSubtopics] = useState<TaxonomySubtopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    async function fetchTaxonomy() {
      try {
        const [domainsResult, subtopicsResult] = await Promise.all([
          supabase
            .from('taxonomy_domains')
            .select('id, name, display_order, colour, is_active')
            .eq('is_active', true)
            .order('display_order', { ascending: true }),
          supabase
            .from('taxonomy_subtopics')
            .select('id, domain_id, name, display_order, is_active')
            .eq('is_active', true)
            .order('display_order', { ascending: true }),
        ]);

        if (!isMountedRef.current) return;

        if (domainsResult.error) {
          setError(`Failed to fetch domains: ${domainsResult.error.message}`);
          setLoading(false);
          return;
        }

        if (subtopicsResult.error) {
          setError(`Failed to fetch subtopics: ${subtopicsResult.error.message}`);
          setLoading(false);
          return;
        }

        setDomains((domainsResult.data ?? []) as TaxonomyDomain[]);
        setSubtopics((subtopicsResult.data ?? []) as TaxonomySubtopic[]);
        setLoading(false);
      } catch (err) {
        if (!isMountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load taxonomy');
        setLoading(false);
      }
    }

    fetchTaxonomy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, []);

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

  const formatSubtopic = useCallback(
    (subtopic: string): string => formatSubtopicUtil(subtopic),
    [],
  );

  const formatDomainName = useCallback(
    (domain: string): string => formatDomainNameUtil(domain),
    [],
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
  if (!ctx)
    throw new Error('useTaxonomy must be used within TaxonomyProvider');
  return ctx;
}
