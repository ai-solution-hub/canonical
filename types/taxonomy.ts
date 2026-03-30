// ---------------------------------------------------------------------------
// Canonical taxonomy types — single source of truth
//
// All modules that work with taxonomy domain/subtopic records should import
// from this file. Do NOT redefine these interfaces elsewhere.
//
// Consumers:
//   - contexts/taxonomy-context.tsx (client-side provider)
//   - lib/taxonomy/taxonomy-server.ts (server-side loading)
//   - lib/content/content-suggestions.ts (gap analysis engine)
// ---------------------------------------------------------------------------

export type TaxonomyProvenance = 'baseline' | 'client' | 'recommended';

export interface TaxonomyDomain {
  id: string;
  name: string;
  display_name?: string | null;
  display_order: number;
  colour: string | null;
  is_active: boolean;
  provenance: TaxonomyProvenance;
}

export interface TaxonomySubtopic {
  id: string;
  domain_id: string;
  name: string;
  display_name?: string | null;
  display_order: number;
  is_active: boolean;
  provenance: TaxonomyProvenance;
  description: string | null;
}
