'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, FileText, FileX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CitationEntry } from '@/types/bid-metadata';

interface SourceContent {
  id: string;
  title: string | null;
  content_type: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  ai_summary: string | null;
  similarity?: number;
}

interface CitationPanelProps {
  citations: CitationEntry[];
  sourceContent: SourceContent[];
  orphanedSourceIds?: Set<string>;
  onCitationClick?: (contentId: string) => void;
  className?: string;
}

export function CitationPanel({
  citations,
  sourceContent,
  orphanedSourceIds,
  onCitationClick,
  className,
}: CitationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedCitationIndex, setExpandedCitationIndex] = useState<number | null>(null);

  if (citations.length === 0) {
    return (
      <div className={cn('flex flex-col items-center gap-2 rounded-md border bg-muted/30 px-4 py-6 text-center', className)}>
        <FileX className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          No citations — this response was not sourced from KB content.
        </p>
      </div>
    );
  }

  // Deduplicate citations by source_id for the summary
  const uniqueSources = new Map<string, { citation: CitationEntry; source?: SourceContent; count: number }>();
  for (const citation of citations) {
    const existing = uniqueSources.get(citation.source_id);
    if (existing) {
      existing.count++;
    } else {
      const source = sourceContent.find((s) => s.id === citation.source_id);
      uniqueSources.set(citation.source_id, { citation, source, count: 1 });
    }
  }

  return (
    <div className={cn('rounded-md border', className)}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="citation-panel-content"
        type="button"
      >
        <span className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          {citations.length} citation{citations.length !== 1 ? 's' : ''} from{' '}
          {uniqueSources.size} source{uniqueSources.size !== 1 ? 's' : ''}
        </span>
        {isExpanded ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {/* Expanded citation list */}
      {isExpanded && (
        <div id="citation-panel-content" className="border-t divide-y">
          {citations.map((citation, index) => {
            const source = sourceContent.find((s) => s.id === citation.source_id);
            const isExpandedCitation = expandedCitationIndex === index;
            const isOrphaned = orphanedSourceIds?.has(citation.source_id) ?? false;

            return (
              <div key={`${citation.source_id}-${index}`} className="px-4 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm italic text-muted-foreground line-clamp-2">
                      &ldquo;{citation.cited_text}&rdquo;
                    </p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {isOrphaned ? (
                        <span className="text-xs font-medium text-muted-foreground truncate max-w-[200px]">
                          {citation.source_title || 'Untitled source'}
                        </span>
                      ) : (
                        <button
                          onClick={() => onCitationClick?.(citation.source_id)}
                          className="text-xs font-medium text-primary hover:underline truncate max-w-[200px]"
                          type="button"
                        >
                          {citation.source_title || 'Untitled source'}
                        </button>
                      )}
                      {isOrphaned && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-status-warning bg-quality-moderate-bg text-status-warning"
                        >
                          <AlertTriangle className="size-2.5 mr-0.5" aria-hidden="true" />
                          Source removed
                        </Badge>
                      )}
                      {source?.content_type && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {source.content_type.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      {source?.primary_domain && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {source.primary_domain}
                        </Badge>
                      )}
                      {source?.similarity != null && (
                        <span className="text-[10px] text-muted-foreground">
                          {Math.round(source.similarity * 100)}% match
                        </span>
                      )}
                    </div>

                    {/* Expandable source detail */}
                    {isExpandedCitation && source?.ai_summary && (
                      <p className="mt-2 text-xs text-muted-foreground border-l-2 border-primary/20 pl-2">
                        {source.ai_summary}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="min-h-[44px] min-w-[44px]"
                    onClick={() => setExpandedCitationIndex(isExpandedCitation ? null : index)}
                    aria-label={isExpandedCitation ? 'Collapse source detail' : 'Expand source detail'}
                    type="button"
                  >
                    {isExpandedCitation ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </Button>
                  {onCitationClick && !isOrphaned && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="min-h-[44px] min-w-[44px]"
                      onClick={() => onCitationClick(citation.source_id)}
                      aria-label={`View source: ${citation.source_title}`}
                      type="button"
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
