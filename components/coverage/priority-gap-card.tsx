'use client';

import Link from 'next/link';
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Minus,
  Grid3x3,
  FileText,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { UnifiedGap, PriorityTier } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Priority tier config (colour + text + icon per WCAG)
// ---------------------------------------------------------------------------

const TIER_CONFIG: Record<
  PriorityTier,
  {
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    label: string;
    className: string;
  }
> = {
  critical: {
    icon: AlertOctagon,
    label: 'Critical',
    className: 'bg-priority-tier-critical-bg text-priority-tier-critical',
  },
  high: {
    icon: AlertTriangle,
    label: 'High',
    className: 'bg-priority-tier-high-bg text-priority-tier-high',
  },
  medium: {
    icon: Info,
    label: 'Medium',
    className: 'bg-priority-tier-medium-bg text-priority-tier-medium',
  },
  low: {
    icon: Minus,
    label: 'Low',
    className: 'bg-priority-tier-low-bg text-priority-tier-low',
  },
};

// ---------------------------------------------------------------------------
// Source badge config
// ---------------------------------------------------------------------------

const SOURCE_CONFIG: Record<
  'taxonomy' | 'template' | 'guide',
  {
    icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    label: string;
  }
> = {
  taxonomy: { icon: Grid3x3, label: 'Taxonomy' },
  template: { icon: FileText, label: 'Template' },
  guide: { icon: BookOpen, label: 'Guide' },
};

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

function PriorityBadge({ tier }: { tier: PriorityTier }) {
  const config = TIER_CONFIG[tier];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        config.className,
      )}
      data-testid={`priority-badge-${tier}`}
    >
      <Icon className="size-3" aria-hidden={true} />
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: 'taxonomy' | 'template' | 'guide' }) {
  const config = SOURCE_CONFIG[source];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className="gap-1">
      <Icon className="size-3" aria-hidden={true} />
      {config.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Gap card
// ---------------------------------------------------------------------------

interface PriorityGapCardProps {
  gap: UnifiedGap;
}

export function PriorityGapCard({ gap }: PriorityGapCardProps) {
  return (
    <li
      className="rounded-lg border bg-card p-4 shadow-sm"
      data-testid={`gap-card-${gap.gap_key}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: content */}
        <div className="min-w-0 flex-1 space-y-2">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge tier={gap.priority_tier} />
            <SourceBadge source={gap.source} />
          </div>

          {/* Title */}
          <h3 className="text-sm font-medium text-foreground">{gap.title}</h3>

          {/* Description */}
          {gap.description && (
            <p className="text-xs text-muted-foreground">{gap.description}</p>
          )}

          {/* Domain/subtopic chips */}
          {(gap.domain || gap.subtopic) && (
            <div className="flex flex-wrap gap-1.5">
              {gap.domain && (
                <Badge variant="secondary" className="text-xs">
                  {gap.domain}
                </Badge>
              )}
              {gap.subtopic && (
                <Badge variant="secondary" className="text-xs">
                  {gap.subtopic}
                </Badge>
              )}
            </div>
          )}

          {/* Source-specific metadata */}
          {gap.source === 'template' && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{gap.template_name}</span>
              {' \u2014 '}
              {gap.section_name}
            </p>
          )}

          {gap.source === 'guide' && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{gap.guide_name}</span>
              {' \u2014 '}
              {gap.section_name}
            </p>
          )}
        </div>

        {/* Right: action button */}
        <div className="shrink-0">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="min-h-[44px] gap-1.5"
          >
            <Link href={gap.action_href}>
              {gap.action_label}
              <ArrowRight className="size-3.5" aria-hidden={true} />
            </Link>
          </Button>
        </div>
      </div>
    </li>
  );
}
