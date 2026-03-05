/**
 * Static taxonomy exports for non-React code (tests, server utilities).
 *
 * Client components should use useTaxonomy() from contexts/taxonomy-context.tsx
 * for database-driven taxonomy data (domains, subtopics, colour keys).
 *
 * Server components should use lib/taxonomy-server.ts for async taxonomy loading.
 *
 * Formatting utilities (formatSubtopic, formatDomainName, ABBREVIATIONS) live
 * in lib/taxonomy-format.ts and are re-exported here for convenience.
 */

// Re-export formatting utilities from the shared module
export { formatSubtopic, formatDomainName } from '@/lib/taxonomy-format';

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
