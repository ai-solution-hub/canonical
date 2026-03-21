'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Settings, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DomainBadge } from '@/components/domain-badge';
import { GuideSection } from '@/components/guide/guide-section';
import { GuideProgressBar } from '@/components/guide/guide-progress-bar';
import { GuideResearchFeed } from '@/components/guide/guide-research-feed';
import { useUserRole } from '@/hooks/use-user-role';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideMetadata {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  guide_type: string;
  domain_filter: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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

interface GuideData {
  guide: GuideMetadata;
  sections: Section[];
}

interface RelatedGuide {
  id: string;
  slug: string;
  name: string;
  guide_type: string;
}

// ---------------------------------------------------------------------------
// Guide type labels
// ---------------------------------------------------------------------------

const GUIDE_TYPE_LABELS: Record<string, string> = {
  sector: 'Sector Guide',
  product: 'Product Guide',
  company: 'Company Guide',
  research: 'Research Guide',
  custom: 'Guide',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GuideContent({ slug }: { slug: string }) {
  const [data, setData] = useState<GuideData | null>(null);
  const [relatedGuides, setRelatedGuides] = useState<RelatedGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { canEdit } = useUserRole();

  useEffect(() => {
    async function fetchGuide() {
      try {
        const res = await fetch(`/api/guides/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? 'Failed to load guide');
          return;
        }
        const guideData: GuideData = await res.json();
        setData(guideData);

        // Fetch related guides of the same type
        if (guideData.guide.guide_type) {
          try {
            const relRes = await fetch(
              `/api/guides?type=${encodeURIComponent(guideData.guide.guide_type)}`,
            );
            if (relRes.ok) {
              const allGuides: RelatedGuide[] = await relRes.json();
              setRelatedGuides(
                allGuides.filter((g) => g.slug !== slug).slice(0, 5),
              );
            }
          } catch {
            // Non-critical — ignore
          }
        }
      } catch {
        setError('Failed to load guide');
      } finally {
        setLoading(false);
      }
    }
    fetchGuide();
  }, [slug]);

  // --- Loading state ---
  if (loading) {
    return (
      <section aria-label="Guide" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex items-center justify-center py-16" role="status" aria-label="Loading guide">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading guide...</span>
        </div>
      </section>
    );
  }

  // --- Error state ---
  if (error || !data) {
    return (
      <section aria-label="Guide" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Link
          href="/guide"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to Guides
        </Link>
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error ?? 'Guide not found'}
        </div>
      </section>
    );
  }

  const { guide, sections } = data;

  // Calculate progress: required sections with at least one content item
  const requiredSections = sections.filter((s) => s.is_required);
  const populatedRequired = requiredSections.filter(
    (s) => s.content_items.length > 0,
  );

  // Detect if a section is the research feed (expected_layer = 'research')
  const isResearchSection = (section: Section) =>
    section.expected_layer === 'research';

  return (
    <section aria-label={`Guide: ${guide.name}`} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/guide"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to Guides
        </Link>
        {canEdit && (
          <Link href={`/settings?section=guides`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Settings className="size-3.5" aria-hidden="true" />
              Edit Guide
            </Button>
          </Link>
        )}
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">{guide.name}</h1>
          <Badge variant="secondary" className="text-[10px]">
            {GUIDE_TYPE_LABELS[guide.guide_type] ?? guide.guide_type}
          </Badge>
          {guide.domain_filter && (
            <DomainBadge domain={guide.domain_filter} />
          )}
        </div>
        {guide.description && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {guide.description}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {requiredSections.length > 0 && (
        <div className="mt-4">
          <GuideProgressBar
            populated={populatedRequired.length}
            total={requiredSections.length}
          />
        </div>
      )}

      {/* Main content + Sidebar */}
      <div className="mt-6 flex gap-8">
        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-6">
          {sections.map((section, index) => (
            isResearchSection(section) ? (
              <GuideResearchFeed
                key={section.section_id}
                sectionName={section.section_name}
                sectionDescription={section.section_description}
                sectionOrder={index + 1}
                domainFilter={guide.domain_filter}
                existingItems={section.content_items}
              />
            ) : (
              <GuideSection
                key={section.section_id}
                section={section}
                sectionNumber={index + 1}
                domainFilter={guide.domain_filter}
                guideName={guide.name}
              />
            )
          ))}

          {sections.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                This guide has no sections yet.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="hidden w-64 shrink-0 lg:block">
          {/* Related guides */}
          {relatedGuides.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Related Guides
              </h3>
              <ul className="mt-3 space-y-2">
                {relatedGuides.map((related) => (
                  <li key={related.id}>
                    <Link
                      href={`/guide/${related.slug}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <BookOpen className="size-3.5 shrink-0" aria-hidden="true" />
                      {related.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Guide info */}
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Guide Info
            </h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Type</dt>
                <dd className="font-medium text-foreground">
                  {GUIDE_TYPE_LABELS[guide.guide_type] ?? guide.guide_type}
                </dd>
              </div>
              {guide.domain_filter && (
                <div>
                  <dt className="text-xs text-muted-foreground">Domain</dt>
                  <dd>
                    <DomainBadge domain={guide.domain_filter} />
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">Sections</dt>
                <dd className="font-medium text-foreground">{sections.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Published</dt>
                <dd className="font-medium text-foreground">
                  {guide.is_published ? 'Yes' : 'No'}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>
    </section>
  );
}
