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

// Canonical content types and platforms live in lib/validation/schemas.ts.
// Re-export here for convenience (used by filter components and the Python pipeline).
import {
  VALID_CONTENT_TYPES,
  VALID_PLATFORMS,
} from '@/lib/validation/schemas';

/** All valid content types (matches DB CHECK constraint) */
export const CONTENT_TYPES = VALID_CONTENT_TYPES;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** All valid platforms (matches DB CHECK constraint) */
export const PLATFORMS = VALID_PLATFORMS;
export type Platform = (typeof PLATFORMS)[number];

/** Content type to Lucide icon name mapping */
export const CONTENT_TYPE_ICONS: Record<ContentType, string> = {
  article: 'FileText',
  blog: 'BookOpen',
  pdf: 'File',
  note: 'StickyNote',
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
