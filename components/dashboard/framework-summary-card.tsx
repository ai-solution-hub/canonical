'use client';

import Link from 'next/link';
import { Layers, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExpiryBadge } from '@/components/dashboard/expiry-badge';
import { cn } from '@/lib/utils';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';
import type { ExpiryStatus } from '@/lib/certification-status';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItemRef {
  id: string;
  title: string;
}

interface FrameworkMetadata {
  round?: string;
  status?: 'active' | 'expired' | 'pending';
  date_joined?: string;
  expiry_date?: string;
  lot?: string;
  supplier_id?: string;
  notes?: string;
}

export interface FrameworkEntry {
  canonical_name: string;
  entity_type: 'framework';
  mention_count: number;
  content_item_count: number;
  content_items: ContentItemRef[];
  metadata: FrameworkMetadata;
  expiry_status: ExpiryStatus;
}

interface FrameworkSummaryCardProps {
  frameworks: FrameworkEntry[];
  onEditEntity?: (canonicalName: string) => void;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatDate(isoDate?: string): string {
  if (!isoDate) return '';
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

// ---------------------------------------------------------------------------
// Status label
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'text-freshness-fresh' },
  expired: { label: 'Expired', className: 'text-freshness-expired' },
  pending: { label: 'Pending', className: 'text-freshness-aging' },
};

// ---------------------------------------------------------------------------
// Framework row
// ---------------------------------------------------------------------------

function FrameworkRow({
  framework,
  onEdit,
}: {
  framework: FrameworkEntry;
  onEdit?: (name: string) => void;
}) {
  const statusStyle = framework.metadata.status
    ? STATUS_STYLES[framework.metadata.status]
    : undefined;
  const needsRenewal =
    framework.expiry_status === 'expiring_soon' ||
    framework.expiry_status === 'expired';
  const renewalItemId = framework.content_items?.[0]?.id;
  // ID-135.26: content_items[].id is a source_documents id
  // (app/api/certifications/route.ts re-points evidence-link ids onto
  // source_documents post-{131.19} — content_items is dead grain).
  const itemLink = framework.content_items?.[0]?.id
    ? `/documents/${framework.content_items[0].id}`
    : null;

  const cardContent = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onEdit?.(framework.canonical_name);
            }}
            className={cn(
              'text-sm font-medium text-foreground',
              onEdit && 'cursor-pointer hover:underline',
            )}
            aria-label={`Edit ${formatEntityDisplayName(framework.canonical_name)}`}
            disabled={!onEdit}
          >
            {formatEntityDisplayName(framework.canonical_name)}
          </button>
          <ExpiryBadge status={framework.expiry_status} />
          {needsRenewal && renewalItemId && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              asChild
            >
              <Link
                href={`/documents/${renewalItemId}`}
                aria-label={`View ${framework.canonical_name} for renewal`}
                onClick={(e) => e.stopPropagation()}
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Renew
              </Link>
            </Button>
          )}
          {statusStyle && (
            <span className={cn('text-xs font-medium', statusStyle.className)}>
              {statusStyle.label}
            </span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {framework.metadata.round && <p>Round: {framework.metadata.round}</p>}
          {framework.metadata.lot && <p>Lot: {framework.metadata.lot}</p>}
          {framework.metadata.date_joined && (
            <p>Joined: {formatDate(framework.metadata.date_joined)}</p>
          )}
          {framework.metadata.expiry_date && (
            <p>Expires: {formatDate(framework.metadata.expiry_date)}</p>
          )}
        </div>
      </div>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        aria-label={`${framework.content_item_count} linked ${framework.content_item_count === 1 ? 'item' : 'items'}`}
      >
        {framework.content_item_count} linked{' '}
        {framework.content_item_count === 1 ? 'item' : 'items'}
      </span>
    </>
  );

  if (itemLink) {
    return (
      <Link
        href={itemLink}
        className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-accent/50"
        role="listitem"
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3"
      role="listitem"
    >
      {cardContent}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FrameworkSummaryCard({
  frameworks,
  onEditEntity,
}: FrameworkSummaryCardProps) {
  if (frameworks.length === 0) return null;

  return (
    <section
      aria-label="Framework memberships"
      className="rounded-lg border bg-card p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Layers className="size-4" aria-hidden="true" />
        Framework Memberships
      </h3>

      <div className="mt-3 space-y-1.5" role="list" aria-label="Frameworks">
        {frameworks.map((framework) => (
          <FrameworkRow
            key={framework.canonical_name}
            framework={framework}
            onEdit={onEditEntity}
          />
        ))}
      </div>
    </section>
  );
}
