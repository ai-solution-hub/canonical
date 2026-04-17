'use client';

import { VerificationBadge } from '@/components/shared/verification-badge';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import { formatSmartDate } from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import {
  LatestVerificationNote,
  VerificationHistory,
} from '@/components/item-detail/verification-history';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

export interface ItemTitleSectionProps {
  item: ItemData;
  title: string;
}

/**
 * Read-only title display with verification badge, freshness indicator,
 * and source document reference. Editing is handled per-field via
 * `useInlineFieldEdit` — the title field is edited through the metadata
 * sidebar or by pressing E (keyboard shortcut).
 */
export function ItemTitleSection({ item, title }: ItemTitleSectionProps) {
  // Resolve verified_by UUID to display name
  const displayNames = useDisplayNames([item.verified_by]);
  const verifiedByName = item.verified_by
    ? (displayNames.get(item.verified_by) ?? null)
    : null;

  return (
    <>
      {/* Title + inline badges */}
      <div className="mb-2">
        <h1 className="text-fluid-xl font-bold leading-tight break-words">
          {title}
        </h1>
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
    </>
  );
}
