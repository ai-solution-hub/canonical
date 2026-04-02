'use client';

import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VerificationBadge } from '@/components/shared/verification-badge';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import { formatSmartDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import { useUserRole } from '@/hooks/use-user-role';
import {
  LatestVerificationNote,
  VerificationHistory,
} from '@/components/item-detail/verification-history';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

export interface ItemTitleSectionProps {
  item: ItemData;
  title: string;
  isEditing: boolean;
  editDirty: boolean;
  editTitle: string;
  setEditTitle: React.Dispatch<React.SetStateAction<string>>;
  setEditDirty: React.Dispatch<React.SetStateAction<boolean>>;
  handleSaveAll: () => void;
  cancelEditMode: () => void;
}

/**
 * Title display with inline editing support and editing banner.
 * Shows verification badge and source document when applicable.
 */
export function ItemTitleSection({
  item,
  title,
  isEditing,
  editDirty,
  editTitle,
  setEditTitle,
  setEditDirty,
  handleSaveAll,
  cancelEditMode,
}: ItemTitleSectionProps) {
  // Resolve verified_by UUID to display name
  const displayNames = useDisplayNames([item.verified_by]);
  const verifiedByName = item.verified_by
    ? (displayNames.get(item.verified_by) ?? null)
    : null;

  // Role-gate detailed trust levels (editor/admin only)
  const { canEdit } = useUserRole();

  return (
    <>
      {/* Title + inline badges */}
      <div className="mb-2">
        {isEditing ? (
          <Input
            autoFocus
            aria-label="Item title"
            value={editTitle}
            onChange={(e) => {
              setEditTitle(e.target.value);
              setEditDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveAll();
              if (e.key === 'Escape') cancelEditMode();
            }}
            className="text-xl font-bold"
          />
        ) : (
          <h1 className="text-fluid-xl font-bold leading-tight break-words">
            {title}
          </h1>
        )}
        {/* Metadata strip — freshness, verification, and source at a glance */}
        <div
          className="mt-2 flex flex-wrap items-center gap-3"
          role="group"
          aria-label="Content metadata"
        >
          {item.freshness && (
            <FreshnessBadge freshness={item.freshness as string} />
          )}
          <VerificationBadge
            verified={!!item.verified_at}
            verifiedAt={item.verified_at}
            verifiedByName={verifiedByName}
            trustData={{
              brief: item.brief,
              detail: item.detail,
              content_owner_id: item.content_owner_id,
            }}
            showDetailedTrust={canEdit}
            size="md"
            liveRegion
          />
          {item.updated_at && (
            <span className="text-xs text-muted-foreground">
              Updated {formatSmartDate(item.updated_at)}
            </span>
          )}
          {item.source_document && (
            <span className="text-xs text-muted-foreground">
              Source:{' '}
              <span className="font-medium text-foreground/80">
                {item.source_document}
              </span>
            </span>
          )}
        </div>

        {/* Latest verification note + expandable history */}
        {item.id && (
          <div className="mt-1.5 space-y-1">
            <LatestVerificationNote contentItemId={item.id} />
            <VerificationHistory contentItemId={item.id} />
          </div>
        )}
      </div>

      {/* Editing banner */}
      {isEditing && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-status-warning/30 bg-quality-moderate-bg px-4 py-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-status-warning">
            <Pencil className="size-3.5 shrink-0" aria-hidden="true" />
            Editing{editDirty ? ' \u2014 unsaved changes' : ''}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveAll}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={cancelEditMode}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
