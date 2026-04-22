'use client';

import { AlertTriangle } from 'lucide-react';
import { DuplicateReview } from './duplicate-review';
import { TagDomainView } from './tag-domain-view';
import { TagBulkActions } from './tag-bulk-actions';
import type { DuplicateGroup } from './duplicate-review';
import type { DomainTagGroup } from './tag-domain-view';
import type { TagCount } from '@/hooks/use-tags-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagsCleanupProps {
  duplicates: DuplicateGroup[];
  domainGroups: DomainTagGroup[];
  tags: TagCount[];
  isAdmin: boolean;
  onActionComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Unified clean-up surface merging duplicate review, domain-grouped view,
 * and bulk actions into a single tab. Extracted from tags-section.tsx.
 */
export function TagsCleanup({
  duplicates,
  domainGroups,
  tags,
  isAdmin,
  onActionComplete,
}: TagsCleanupProps) {
  return (
    <div className="space-y-6">
      {/* Duplicates section */}
      {duplicates.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 text-freshness-aging" aria-hidden="true" />
            Duplicate groups ({duplicates.length})
          </h4>
          <DuplicateReview
            duplicates={duplicates}
            isAdmin={isAdmin}
            onMergeComplete={onActionComplete}
          />
        </div>
      )}

      {/* Domain-grouped view */}
      {domainGroups.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Tags by domain</h4>
          <TagDomainView groups={domainGroups} />
        </div>
      )}

      {/* Bulk actions */}
      {isAdmin && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Bulk actions</h4>
          <TagBulkActions
            tags={tags}
            isAdmin={isAdmin}
            onActionComplete={onActionComplete}
          />
        </div>
      )}

      {duplicates.length === 0 && domainGroups.length === 0 && !isAdmin && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No clean-up actions available.
        </p>
      )}
    </div>
  );
}
