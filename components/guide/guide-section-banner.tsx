'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { BookOpen, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type {
  GuideSectionMatch,
  MatchStrength,
} from '@/lib/guide-section-mapping';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuideSectionBannerProps {
  /** Array of guide section matches from suggestGuideSections() */
  guideSections: GuideSectionMatch[];
  /** Callback when the banner is dismissed */
  onDismiss: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group matches by guide for display */
function groupByGuide(
  matches: GuideSectionMatch[],
): Map<
  string,
  { guideName: string; guideSlug: string; sections: GuideSectionMatch[] }
> {
  const groups = new Map<
    string,
    { guideName: string; guideSlug: string; sections: GuideSectionMatch[] }
  >();

  for (const match of matches) {
    const existing = groups.get(match.guideId);
    if (existing) {
      existing.sections.push(match);
    } else {
      groups.set(match.guideId, {
        guideName: match.guideName,
        guideSlug: match.guideSlug,
        sections: [match],
      });
    }
  }

  return groups;
}

/** Badge variant and label for each match strength */
function getStrengthBadge(strength: MatchStrength): {
  variant: 'secondary' | 'default' | 'outline';
  label: string;
} {
  switch (strength) {
    case 'exact':
      return { variant: 'secondary', label: 'Exact match' };
    case 'partial':
      return { variant: 'default', label: 'Partial match' };
    case 'domain_only':
      return { variant: 'outline', label: 'Domain match' };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Informational banner shown after content creation to indicate which guide
 * sections the newly created item would populate.
 *
 * Follows the LayerSuggestionBanner pattern (region role, accessible labels,
 * semantic tokens). Unlike LayerSuggestionBanner, this has no Accept/Change
 * actions because guide sections are views, not assignments.
 *
 * Spec: docs/specs/guide-section-mapping-spec.md (Phase 3, section 4.7)
 */
export function GuideSectionBanner({
  guideSections,
  onDismiss,
}: GuideSectionBannerProps) {
  const guideGroups = useMemo(
    () => groupByGuide(guideSections),
    [guideSections],
  );

  // Don't render if there are no matches
  if (guideSections.length === 0) {
    return null;
  }

  // Determine heading based on match strength
  const hasExactMatch = guideSections.some((s) => s.matchStrength === 'exact');
  const heading = hasExactMatch
    ? 'This content populates guide sections'
    : 'This content may match guide sections';

  return (
    <div
      role="region"
      aria-label="Guide section suggestions"
      className="rounded-lg border border-primary/20 bg-primary/5 p-4"
    >
      <div className="flex items-start gap-3">
        <BookOpen
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          {/* Header row with dismiss button */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground">{heading}</h3>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss guide section suggestions"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Guide groups */}
          <div className="mt-2 space-y-3">
            {Array.from(guideGroups.entries()).map(([guideId, group]) => (
              <div key={guideId}>
                <p className="text-xs font-medium text-foreground">
                  {group.guideName}
                </p>
                <ul className="mt-1 space-y-1">
                  {group.sections.map((section) => {
                    const badge = getStrengthBadge(section.matchStrength);
                    return (
                      <li
                        key={section.sectionId}
                        className="flex flex-wrap items-center gap-2 text-xs"
                      >
                        <Link
                          href={`/guide/${group.guideSlug}#${section.sectionId}`}
                          className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                          aria-label={`View ${section.sectionName} in ${group.guideName}`}
                        >
                          {section.sectionName}
                        </Link>
                        <Badge
                          variant={badge.variant}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {badge.label}
                        </Badge>
                        {section.isRequired && (
                          <span className="text-[10px] font-medium text-destructive">
                            Required
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
