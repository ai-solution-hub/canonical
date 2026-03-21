'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, Loader2, FileText, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DomainBadge } from '@/components/domain-badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideStats {
  total_sections: number;
  populated_sections: number;
  required_sections: number;
  populated_required: number;
}

interface Guide {
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
  created_at: string;
  updated_at: string;
  stats?: GuideStats;
}

// ---------------------------------------------------------------------------
// Guide type labels
// ---------------------------------------------------------------------------

const GUIDE_TYPE_LABELS: Record<string, string> = {
  sector: 'Sector',
  product: 'Product',
  company: 'Company',
  research: 'Research',
  custom: 'Custom',
};

// ---------------------------------------------------------------------------
// Guide card
// ---------------------------------------------------------------------------

function GuideCard({ guide }: { guide: Guide }) {
  const stats = guide.stats;
  const hasStats = stats && stats.total_sections > 0;
  const percentage = hasStats
    ? Math.round((stats.populated_sections / stats.total_sections) * 100)
    : 0;
  const isComplete = hasStats && stats.populated_sections >= stats.total_sections;

  return (
    <Link
      href={`/guide/${guide.slug}`}
      className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <BookOpen className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground group-hover:underline">
            {guide.name}
          </h3>
          {guide.description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
              {guide.description}
            </p>
          )}
        </div>
      </div>

      {/* Section progress */}
      {hasStats && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>
              {stats.populated_sections}/{stats.total_sections} sections populated
            </span>
            <span
              className={
                isComplete ? 'font-semibold text-freshness-fresh' : ''
              }
            >
              {percentage}%
            </span>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={stats.populated_sections}
            aria-valuemin={0}
            aria-valuemax={stats.total_sections}
            aria-label={`${stats.populated_sections} of ${stats.total_sections} sections populated`}
          >
            <div
              className={
                isComplete
                  ? 'h-full rounded-full bg-freshness-fresh transition-all duration-300'
                  : 'h-full rounded-full bg-primary transition-all duration-300'
              }
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px]">
          {GUIDE_TYPE_LABELS[guide.guide_type] ?? guide.guide_type}
        </Badge>
        {guide.domain_filter && (
          <DomainBadge domain={guide.domain_filter} />
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <FileText className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-4 text-sm font-medium text-foreground">
        No guides published yet
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Guides provide a curated reading experience over your knowledge base content.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GuidesPage() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchGuides() {
      try {
        const res = await fetch('/api/guides?include=stats');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? 'Failed to load guides');
          return;
        }
        const data: Guide[] = await res.json();
        setGuides(data);
      } catch {
        setError('Failed to load guides');
      } finally {
        setLoading(false);
      }
    }
    fetchGuides();
  }, []);

  return (
    <section aria-label="Guides" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-3">
        <Layers className="size-6 text-muted-foreground" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Guides</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Curated reading experiences across your knowledge base
          </p>
        </div>
      </div>

      <div className="mt-6">
        {loading && (
          <div className="flex items-center justify-center py-16" role="status" aria-label="Loading guides">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading guides...</span>
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && guides.length === 0 && <EmptyState />}

        {!loading && !error && guides.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {guides.map((guide) => (
              <GuideCard key={guide.id} guide={guide} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
