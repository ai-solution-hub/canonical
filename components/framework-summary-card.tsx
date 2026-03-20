'use client';

import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
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
// Expiry status badge
// ---------------------------------------------------------------------------

const EXPIRY_BADGE_CONFIG: Record<
  ExpiryStatus,
  { label: string; textClass: string; bgClass: string }
> = {
  valid: {
    label: 'Valid',
    textClass: 'text-freshness-fresh',
    bgClass: 'bg-freshness-fresh-bg',
  },
  expiring_soon: {
    label: 'Expiring Soon',
    textClass: 'text-freshness-aging',
    bgClass: 'bg-freshness-aging-bg',
  },
  expired: {
    label: 'Expired',
    textClass: 'text-freshness-expired',
    bgClass: 'bg-freshness-expired-bg',
  },
  unknown: {
    label: 'Unknown',
    textClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
  },
};

function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const config = EXPIRY_BADGE_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        config.textClass,
        config.bgClass,
      )}
      aria-label={`Expiry status: ${config.label}`}
    >
      {config.label}
    </span>
  );
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

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3"
      role="listitem"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit?.(framework.canonical_name)}
            className={cn(
              'text-sm font-medium text-foreground',
              onEdit && 'cursor-pointer hover:underline',
            )}
            aria-label={`Edit ${framework.canonical_name}`}
            disabled={!onEdit}
          >
            {framework.canonical_name}
          </button>
          <ExpiryBadge status={framework.expiry_status} />
          {statusStyle && (
            <span className={cn('text-xs font-medium', statusStyle.className)}>
              {statusStyle.label}
            </span>
          )}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {framework.metadata.round && (
            <p>Round: {framework.metadata.round}</p>
          )}
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
        aria-label={`${framework.content_item_count} evidence ${framework.content_item_count === 1 ? 'item' : 'items'}`}
      >
        {framework.content_item_count} evidence
      </span>
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
      className="rounded-lg border border-border bg-card p-4"
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
