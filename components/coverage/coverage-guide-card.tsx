'use client';

import Link from 'next/link';
import { Check, X, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { getLayerLabel } from '@/lib/validation/layer-schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuideSection {
  id: string;
  name: string;
  order: number;
  expected_layer: string | null;
  is_required: boolean;
  content_count: number;
  fresh_count: number;
  stale_count: number;
  status: 'populated' | 'stale' | 'empty';
}

export interface GuideCoverageData {
  id: string;
  name: string;
  slug: string;
  guide_type: string;
  domain_filter: string;
  total_sections: number;
  populated_sections: number;
  required_sections: number;
  populated_required: number;
  fresh_sections: number;
  stale_sections: number;
  sections: GuideSection[];
}

// ---------------------------------------------------------------------------
// Freshness label
// ---------------------------------------------------------------------------

function freshnessLabel(section: GuideSection): {
  text: string;
  className: string;
} {
  if (section.content_count === 0) {
    return { text: 'Empty', className: 'text-muted-foreground' };
  }
  if (section.fresh_count > 0) {
    return { text: 'Fresh', className: 'text-freshness-fresh' };
  }
  if (section.stale_count > 0) {
    return { text: 'Stale', className: 'text-freshness-stale' };
  }
  return { text: 'Ageing', className: 'text-freshness-aging' };
}

// ---------------------------------------------------------------------------
// Section row
// ---------------------------------------------------------------------------

function SectionRow({ section }: { section: GuideSection }) {
  const freshness = freshnessLabel(section);
  const layerLabel = section.expected_layer
    ? getLayerLabel(section.expected_layer)
    : null;
  const isPopulated = section.content_count > 0;
  const itemLabel =
    section.content_count === 1
      ? '1 item'
      : `${section.content_count} items`;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
        !isPopulated && section.is_required && 'bg-destructive/5',
      )}
    >
      {/* Status icon */}
      {isPopulated ? (
        <Check
          className="size-4 shrink-0 text-freshness-fresh"
          aria-label="Populated"
        />
      ) : (
        <X
          className="size-4 shrink-0 text-muted-foreground"
          aria-label="Empty"
        />
      )}

      {/* Section name */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          isPopulated ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {section.name}
        {section.is_required && !isPopulated && (
          <span className="ml-1 text-xs text-destructive">(required)</span>
        )}
      </span>

      {/* Layer badge */}
      {layerLabel && (
        <Badge variant="outline" className="hidden text-xs sm:inline-flex">
          {layerLabel}
        </Badge>
      )}

      {/* Content count */}
      <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
        {isPopulated ? itemLabel : '\u2014'}
      </span>

      {/* Freshness indicator */}
      <span
        className={cn('w-12 shrink-0 text-right text-xs font-medium', freshness.className)}
      >
        {freshness.text}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guide card
// ---------------------------------------------------------------------------

export function CoverageGuideCard({ guide }: { guide: GuideCoverageData }) {
  const progressPercent =
    guide.total_sections > 0
      ? Math.round((guide.populated_sections / guide.total_sections) * 100)
      : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground truncate">
            {guide.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {guide.domain_filter}
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          {guide.populated_sections}/{guide.total_sections} sections
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <Progress
          value={progressPercent}
          aria-label={`${guide.populated_sections} of ${guide.total_sections} sections populated`}
        />
      </div>

      {/* Section checklist */}
      <div className="mt-4 space-y-0.5">
        {guide.sections.map((section) => (
          <SectionRow key={section.id} section={section} />
        ))}
      </div>

      {/* Footer link */}
      <div className="mt-4 flex justify-end">
        <Link
          href={`/guide/${guide.slug}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open Guide
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
