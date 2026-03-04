/**
 * Static taxonomy exports for components that cannot use React hooks
 * (server components, non-React code, tests).
 *
 * Client components should prefer useTaxonomy() from contexts/taxonomy-context.tsx
 * for database-driven taxonomy data.
 *
 * Formatting utilities (formatSubtopic, formatDomainName, ABBREVIATIONS) live
 * in lib/taxonomy-format.ts and are re-exported here for convenience.
 *
 * NOTE: The static DOMAINS object below duplicates data that is also stored in
 * the taxonomy_domains/taxonomy_subtopics database tables. It exists as a
 * fallback for server components (e.g. domain-badge, domain-card) that cannot
 * use React hooks and need synchronous access to domain metadata such as colour
 * keys and subtopic lists. If you add or remove domains in the database, update
 * this object to match.
 */

import { FALLBACK_COLOUR_MAP } from '@/lib/taxonomy-format';

// Re-export formatting utilities from the shared module
export { formatSubtopic, formatDomainName } from '@/lib/taxonomy-format';

export const DOMAINS = {
  security: {
    colour: 'security',
    subtopics: [
      'data-protection',
      'cyber-security',
      'encryption',
      'access-control',
      'iso-27001',
    ],
  },
  compliance: {
    colour: 'compliance',
    subtopics: ['standards', 'regulatory', 'audit', 'certification'],
  },
  implementation: {
    colour: 'implementation',
    subtopics: ['deployment', 'migration', 'onboarding', 'integration'],
  },
  support: {
    colour: 'support',
    subtopics: ['sla', 'helpdesk', 'maintenance', 'incident'],
  },
  corporate: {
    colour: 'corporate',
    subtopics: [
      'company-info',
      'financial',
      'insurance',
      'references',
      'staffing',
    ],
  },
  'product-feature': {
    colour: 'product',
    subtopics: ['functionality', 'technical', 'reporting', 'usability'],
  },
  methodology: {
    colour: 'methodology',
    subtopics: ['approach', 'project-management', 'quality', 'delivery'],
  },
} as const;

export type Domain = keyof typeof DOMAINS;
export type Subtopic = (typeof DOMAINS)[Domain]['subtopics'][number];

/** Get all subtopics for a given domain */
export function getSubtopics(domain: Domain): readonly string[] {
  return DOMAINS[domain].subtopics;
}

/** Get the colour key for a domain (maps to CSS var --domain-{key}-*) */
export function getDomainColourKey(domain: string): string {
  const entry = Object.entries(DOMAINS).find(([key]) => key === domain);
  if (entry) return entry[1].colour;
  return FALLBACK_COLOUR_MAP[domain] ?? 'corporate';
}

/** Get all domain names */
export function getDomainNames(): Domain[] {
  return Object.keys(DOMAINS) as Domain[];
}

/** All valid content types (matches DB CHECK constraint) */
export const CONTENT_TYPES = [
  'post',
  'article',
  'blog',
  'pdf',
  'product-page',
  'podcast',
  'video',
  'comment',
  'newsletter',
  'bookmark',
  'transcript',
  'note',
  'course',
  'research',
  'other',
  'q_a_pair',
  'case_study',
  'policy',
  'certification',
  'compliance',
  'methodology',
  'capability',
  'product_description',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** All valid platforms (matches DB CHECK constraint) */
export const PLATFORMS = [
  'web',
  'email',
  'manual',
  'upload',
  'extraction',
  'other',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Content type to Lucide icon name mapping */
export const CONTENT_TYPE_ICONS: Record<ContentType, string> = {
  post: 'MessageSquare',
  article: 'FileText',
  blog: 'BookOpen',
  pdf: 'File',
  'product-page': 'Package',
  podcast: 'Headphones',
  video: 'Play',
  comment: 'MessageCircle',
  newsletter: 'Mail',
  bookmark: 'Bookmark',
  transcript: 'ScrollText',
  note: 'StickyNote',
  course: 'GraduationCap',
  research: 'FlaskConical',
  other: 'HelpCircle',
  q_a_pair: 'CircleHelp',
  case_study: 'FileCheck',
  policy: 'Shield',
  certification: 'Award',
  compliance: 'ClipboardCheck',
  methodology: 'Workflow',
  capability: 'Star',
  product_description: 'ShoppingBag',
};
