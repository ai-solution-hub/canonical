import { createClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Types (mirror context types for server use)
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

// ---------------------------------------------------------------------------
// Abbreviations for formatSubtopic
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  'ai', 'ux', 'gtd', 'llms', 'roi', 'api', 'css', 'html', 'url', 'crm',
  'sla', 'iso',
]);

// ---------------------------------------------------------------------------
// Fallback domain colour map
// ---------------------------------------------------------------------------

const FALLBACK_COLOUR_MAP: Record<string, string> = {
  security: 'security',
  compliance: 'compliance',
  implementation: 'implementation',
  support: 'support',
  corporate: 'corporate',
  'product-feature': 'product',
  methodology: 'methodology',
};

// ---------------------------------------------------------------------------
// Server-side taxonomy loading
// ---------------------------------------------------------------------------

/** Fetch all active taxonomy domains and subtopics from the database */
export async function loadTaxonomy(): Promise<{
  domains: TaxonomyDomain[];
  subtopics: TaxonomySubtopic[];
}> {
  const supabase = await createClient();

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

  if (domainsResult.error) {
    console.error('Failed to fetch taxonomy domains:', domainsResult.error.message);
  }
  if (subtopicsResult.error) {
    console.error('Failed to fetch taxonomy subtopics:', subtopicsResult.error.message);
  }

  return {
    domains: (domainsResult.data ?? []) as TaxonomyDomain[],
    subtopics: (subtopicsResult.data ?? []) as TaxonomySubtopic[],
  };
}

/** Get ordered array of domain names */
export function getDomainNames(domains: TaxonomyDomain[]): string[] {
  return domains.map((d) => d.name);
}

/** Get subtopic names for a given domain name */
export function getSubtopics(
  domainName: string,
  domains: TaxonomyDomain[],
  subtopics: TaxonomySubtopic[],
): string[] {
  const domain = domains.find((d) => d.name === domainName);
  if (!domain) return [];
  return subtopics
    .filter((s) => s.domain_id === domain.id)
    .map((s) => s.name);
}

/** Get CSS colour key for a domain name */
export function getDomainColourKey(
  domainName: string,
  domains: TaxonomyDomain[],
): string {
  const domain = domains.find((d) => d.name === domainName);
  if (domain?.colour) return domain.colour;
  return FALLBACK_COLOUR_MAP[domainName] ?? 'corporate';
}

/** Format a subtopic slug for display */
export function formatSubtopic(subtopic: string): string {
  return subtopic
    .split('-')
    .map((word) => {
      if (ABBREVIATIONS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Format a domain name for display */
export function formatDomainName(domain: string): string {
  return domain
    .split('-')
    .map((word) => {
      if (ABBREVIATIONS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
