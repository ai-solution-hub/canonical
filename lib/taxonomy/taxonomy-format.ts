/**
 * Shared taxonomy formatting utilities.
 *
 * Pure functions with no 'use client' or 'use server' directive so they can be
 * imported from client components, server components, and the taxonomy context
 * alike. This is the single source of truth for display-formatting taxonomy
 * slugs and for the abbreviation list used during formatting.
 */

// ---------------------------------------------------------------------------
// Abbreviations — words that should be fully uppercased in display strings
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  'ai',
  'ux',
  'gtd',
  'llms',
  'roi',
  'api',
  'css',
  'html',
  'url',
  'crm',
  'sla',
  'iso',
]);

// ---------------------------------------------------------------------------
// Fallback domain colour map
// Used when a taxonomy domain record has no explicit colour field set.
// ---------------------------------------------------------------------------

export const FALLBACK_COLOUR_MAP: Record<string, string> = {
  security: 'security',
  compliance: 'compliance',
  implementation: 'implementation',
  support: 'support',
  corporate: 'corporate',
  'product-feature': 'product',
  methodology: 'methodology',
  'safeguarding-child-protection': 'security',
  'safeguarding-adults': 'security',
  'multi-academy-trusts': 'corporate',
  education: 'implementation',
  'products-services': 'product',
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a subtopic slug for display (kebab-case to Title Case, abbreviations uppercased) */
export function formatSubtopic(subtopic: string): string {
  return subtopic
    .split('-')
    .map((word) => {
      if (ABBREVIATIONS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** Format a domain name for display. Uses displayName if provided, otherwise converts kebab-case to Title Case. */
export function formatDomainName(domain: string, displayName?: string | null): string {
  if (displayName) return displayName;
  return domain
    .split('-')
    .map((word) => {
      if (ABBREVIATIONS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
