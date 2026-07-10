'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DomainBadge } from '@/components/shared/domain-badge';
import { ContentTypeIcon } from '@/components/shared/content-type-icon';
import { Badge } from '@/components/ui/badge';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { formatContentType } from '@/lib/format';
import type { ChangeReportDomainSummary } from '@/types/change-reports';
import { cn } from '@/lib/utils';

interface ChangeReportDomainSectionProps {
  domainSummary: ChangeReportDomainSummary;
  className?: string;
}

export function ChangeReportDomainSection({
  domainSummary,
  className,
}: ChangeReportDomainSectionProps) {
  const { getDomainColourKey } = useTaxonomy();
  const colourKey = getDomainColourKey(domainSummary.domain);

  return (
    <article
      className={cn('digest-domain-card rounded-xl border p-5', className)}
      style={{
        backgroundColor: `var(--domain-${colourKey}-surface)`,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <DomainBadge domain={domainSummary.domain} />
        <span className="shrink-0 text-sm text-muted-foreground">
          {domainSummary.item_count}{' '}
          {domainSummary.item_count === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Summary */}
      <p className="mt-3 text-[15px] leading-relaxed text-foreground/90">
        {domainSummary.summary}
      </p>

      {/* Key themes */}
      {domainSummary.key_themes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {domainSummary.key_themes.map((theme) => (
            <Badge
              key={theme}
              variant="secondary"
              className="text-[11px] font-normal"
            >
              {theme}
            </Badge>
          ))}
        </div>
      )}

      {/* Top items */}
      {domainSummary.top_items.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Top items
          </h4>
          <ul className="space-y-1.5">
            {domainSummary.top_items.map((item) => (
              <li key={item.id}>
                <Link
                  // ID-135.26: item.id is a source_documents id — the
                  // change-report digest generator (lib/ai/change-reports.ts)
                  // is entirely source_documents-backed post-{131.19}
                  // (content_items is dead grain, no successor).
                  href={`/documents/${item.id}`}
                  className="group flex items-start gap-2 rounded-lg p-2 transition-colors hover:bg-background/60"
                >
                  <ContentTypeIcon
                    contentType={item.content_type ?? null}
                    size="size-4"
                    className="mt-0.5 transition-colors group-hover:text-foreground"
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium leading-tight text-foreground group-hover:underline">
                      {item.title}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatContentType(item.content_type ?? null)}
                    </span>
                    {(item.why_notable || item.summary) && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {item.why_notable || item.summary}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Review link */}
      <div className="mt-4 border-t border-border/50 pt-3">
        <Link
          href={`/review?domain=${encodeURIComponent(domainSummary.domain)}`}
          className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Review these items
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </article>
  );
}
