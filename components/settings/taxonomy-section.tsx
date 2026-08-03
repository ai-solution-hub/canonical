'use client';

import { useMemo } from 'react';
import { Info, Loader2, Tags } from 'lucide-react';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { Card } from '@/components/ui/card';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import type { TaxonomySubtopic } from '@/types/taxonomy';

// ---------------------------------------------------------------------------
// Main Component
//
// Read-only. The taxonomy admin CRUD this section used to host (add / edit /
// reorder / deactivate domains and subtopics, via useTaxonomyAdmin and the
// domain-card + taxonomy-dialogs components) was retired with the
// /api/taxonomy/* routes under id-417 — every one of those affordances now
// posts to a route that no longer exists. What survives is the read: the
// taxonomy context loads taxonomy_domains / taxonomy_subtopics straight from
// Supabase, so the configured categories can still be shown.
// ---------------------------------------------------------------------------

export function TaxonomySection() {
  const {
    domains,
    subtopics,
    loading,
    error,
    formatDomainName,
    formatSubtopic,
  } = useTaxonomy();

  const subtopicsByDomain = useMemo(() => {
    const map = new Map<string, TaxonomySubtopic[]>();
    for (const s of subtopics) {
      const existing = map.get(s.domain_id) ?? [];
      existing.push(s);
      map.set(s.domain_id, existing);
    }
    return map;
  }, [subtopics]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          Categories
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="More information about categories"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Domains are the top-level groups (e.g. &ldquo;Health &amp;
                Safety&rdquo;, &ldquo;Technology &amp; Systems&rdquo;).
                Subtopics sit underneath domains for finer classification. Every
                knowledge item gets one domain and one subtopic.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h3>
        <p className="text-sm text-muted-foreground">
          Categories are how your knowledge is sorted into domains and subtopics
          — like folders in a filing cabinet.
        </p>
      </div>

      {error ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <p className="text-sm font-medium text-destructive">
              Couldn&rsquo;t load categories
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </Card>
      ) : domains.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Tags
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              No domains configured yet
            </p>
            <p className="text-xs text-muted-foreground">
              Domains and subtopics are set up during onboarding.
            </p>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {domains.map((domain) => {
            const subs = subtopicsByDomain.get(domain.id) ?? [];
            return (
              <Card key={domain.id} className="gap-2 px-4 py-4">
                <h4 className="text-sm font-medium text-foreground">
                  {formatDomainName(domain.name)}
                </h4>
                {subs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No subtopics in this domain.
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {subs.map((subtopic) => (
                      <li
                        key={subtopic.id}
                        className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {formatSubtopic(subtopic.name)}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
