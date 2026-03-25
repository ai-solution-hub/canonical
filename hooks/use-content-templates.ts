'use client';

import {
  CONTENT_TEMPLATES,
  type ContentTemplate,
} from '@/lib/content-templates';

/**
 * Hook returning available content creation templates.
 * Phase 1: returns code constants from lib/content-templates.ts
 * Phase 2 (future): will query the content_templates database table
 */
export function useContentTemplates(): {
  templates: ContentTemplate[];
  isLoading: boolean;
} {
  return {
    templates: CONTENT_TEMPLATES,
    isLoading: false,
  };
}
