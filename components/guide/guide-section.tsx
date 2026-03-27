'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import { GuideSectionEmpty } from './guide-section-empty';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItem {
  content_id: string;
  content_title: string;
  content_type: string;
  content_layer: string | null;
  content_brief: string | null;
  content_freshness: string | null;
  content_verified_at: string | null;
  content_captured_date: string | null;
}

interface Section {
  section_id: string;
  section_name: string;
  section_description: string | null;
  section_order: number;
  expected_layer: string | null;
  subtopic_filter: string | null;
  is_required: boolean;
  content_items: ContentItem[];
}

interface GuideSectionProps {
  section: Section;
  sectionNumber: number;
  domainFilter: string | null;
  /** Guide name — passed to empty state for Claude prompt context */
  guideName?: string;
}

// ---------------------------------------------------------------------------
// Content item card
// ---------------------------------------------------------------------------

function ContentItemCard({ item }: { item: ContentItem }) {
  const { getLayerLabel } = useLayerVocabulary();
  return (
    <Link
      href={`/item/${item.content_id}`}
      className="group block rounded-md border border-border bg-background p-3 transition-colors hover:border-foreground/20 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground group-hover:underline line-clamp-2">
          {item.content_title}
        </h4>
        <ExternalLink
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>

      {item.content_brief && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
          {item.content_brief}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.content_freshness && (
          <FreshnessBadge freshness={item.content_freshness} compact />
        )}
        {item.content_layer && (
          <Badge variant="outline" className="text-[10px]">
            {getLayerLabel(item.content_layer)}
          </Badge>
        )
        }
        {item.content_verified_at && (
          <span className="text-[10px] text-muted-foreground" title="Verified">
            Verified
          </span>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Guide section component
// ---------------------------------------------------------------------------

export function GuideSection({ section, sectionNumber, domainFilter, guideName }: GuideSectionProps) {
  const { getLayerLabel } = useLayerVocabulary();
  const layerLabel = section.expected_layer ? getLayerLabel(section.expected_layer) : null;
  const hasContent = section.content_items.length > 0;

  return (
    <div id={section.section_id} className="rounded-lg border border-border bg-card p-4">
      {/* Section header */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold text-foreground">
          <span className="text-muted-foreground">{sectionNumber}.</span>{' '}
          {section.section_name}
        </h2>
        {layerLabel && (
          <Badge variant="secondary" className="text-[10px]">
            {layerLabel}
          </Badge>
        )}
        {section.is_required && !hasContent && (
          <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
            Required
          </Badge>
        )}
      </div>

      {section.section_description && (
        <p className="mt-1 text-xs text-muted-foreground">
          {section.section_description}
        </p>
      )}

      {/* Content items or empty state */}
      <div className="mt-3 space-y-2">
        {hasContent ? (
          section.content_items.map((item) => (
            <ContentItemCard key={item.content_id} item={item} />
          ))
        ) : (
          <GuideSectionEmpty
            domainFilter={domainFilter}
            subtopicFilter={section.subtopic_filter}
            expectedLayer={section.expected_layer}
            sectionName={section.section_name}
            guideName={guideName}
          />
        )}
      </div>
    </div>
  );
}
