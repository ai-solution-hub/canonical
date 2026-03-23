'use client';

import { Info } from 'lucide-react';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { EntityList } from '@/components/entity-management/entity-list';

/**
 * Entity management section for the Settings page.
 * Admin-only — renders the full EntityList with merge/split/type-override.
 */
export function EntitiesSection() {
  return (
    <div>
      <div className="mb-4">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-foreground">
          Organisations &amp; People
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="More information about organisations and people"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Entities are automatically extracted from your content.
                &ldquo;ISO 27001&rdquo; is a certification entity,
                &ldquo;NHS&rdquo; is an organisation entity. You can merge
                duplicates (e.g. &ldquo;NHS&rdquo; and &ldquo;National Health
                Service&rdquo;), split incorrectly merged entities, or change an
                entity&rsquo;s type.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Companies, certifications, frameworks, and people mentioned across your
          knowledge base.
        </p>
      </div>
      <EntityList />
    </div>
  );
}
