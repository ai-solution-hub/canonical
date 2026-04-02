import { createClient } from '@/lib/supabase/server';
import { FALLBACK_COLOUR_MAP } from '@/lib/taxonomy/taxonomy-format';
import type { TaxonomyDomain, TaxonomySubtopic } from '@/types/taxonomy';

// Re-export formatting utilities so existing consumers don't break
export {
  formatSubtopic,
  formatDomainName,
} from '@/lib/taxonomy/taxonomy-format';

// Re-export shared types so existing `import { TaxonomyDomain } from '@/lib/taxonomy/taxonomy-server'`
// continues to work.
export type {
  TaxonomyProvenance,
  TaxonomyDomain,
  TaxonomySubtopic,
} from '@/types/taxonomy';

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
      .select('id, name, display_order, colour, is_active, provenance')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('taxonomy_subtopics')
      .select(
        'id, domain_id, name, display_order, is_active, provenance, description',
      )
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
  ]);

  if (domainsResult.error) {
    console.error(
      'Failed to fetch taxonomy domains:',
      domainsResult.error.message,
    );
  }
  if (subtopicsResult.error) {
    console.error(
      'Failed to fetch taxonomy subtopics:',
      subtopicsResult.error.message,
    );
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
  return subtopics.filter((s) => s.domain_id === domain.id).map((s) => s.name);
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
