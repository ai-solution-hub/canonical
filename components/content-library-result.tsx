'use client';

import { Copy, ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DomainBadge } from '@/components/domain-badge';
import { SimilarityBadge } from '@/components/similarity-badge';
import { getDisplayTitle, formatContentType } from '@/lib/format';
import { toast } from 'sonner';
import type { SearchResult } from '@/types/content';

interface ContentLibraryResultProps {
  result: SearchResult;
  onCopy: (text: string) => void;
  /** Callback when "Insert" is clicked. Null disables the insert button (e.g., no editor). */
  onInsert?: ((contentHtml: string, sourceId: string, sourceTitle: string) => void) | null;
}

function extractQAParts(result: SearchResult): { question: string; answer: string } | null {
  if (result.content_type !== 'q_a_pair') return null;

  const metadata = result.metadata as Record<string, unknown> | null;
  const question = (metadata?.question as string) ?? '';
  const answer = result.content || result.ai_summary || result.snippet || '';

  return { question, answer };
}

export function ContentLibraryResult({ result, onCopy, onInsert }: ContentLibraryResultProps) {
  const title = getDisplayTitle(result);
  const isQAPair = result.content_type === 'q_a_pair';
  const qaParts = extractQAParts(result);

  const sourceDocument = (result.metadata as Record<string, unknown> | null)?.source_file as string | undefined
    ?? result.source_document
    ?? undefined;

  const copyText = isQAPair && qaParts
    ? qaParts.answer
    : (result.ai_summary || result.brief || result.snippet || '');

  const handleCopy = () => {
    if (!copyText) return;
    navigator.clipboard.writeText(copyText);
    toast.success('Copied to clipboard');
    onCopy(copyText);
  };

  const handleView = () => {
    window.open(`/item/${result.id}`, '_blank');
  };

  // --- Q&A PAIR RESULT ---
  if (isQAPair && qaParts) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        {/* Header: badges + similarity */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {formatContentType(result.content_type)}
          </Badge>
          {result.primary_domain && (
            <DomainBadge domain={result.primary_domain} />
          )}
          {result.similarity > 0 && (
            <SimilarityBadge score={result.similarity} className="ml-auto" />
          )}
        </div>

        {/* Title */}
        <h4 className="mt-2 text-sm font-medium leading-snug text-foreground line-clamp-1">
          {title}
        </h4>

        {/* Question */}
        {qaParts.question && (
          <div className="mt-2 rounded border border-border bg-muted/30 px-2.5 py-1.5">
            <p className="text-xs font-medium text-muted-foreground">Question</p>
            <p className="mt-0.5 text-xs leading-relaxed text-foreground line-clamp-3">
              {qaParts.question}
            </p>
          </div>
        )}

        {/* Answer */}
        <div className="mt-2 rounded border border-border bg-muted/30 px-2.5 py-1.5">
          <p className="text-xs font-medium text-muted-foreground">Answer</p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground line-clamp-4">
            {qaParts.answer}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            ~{qaParts.answer.split(/\s+/).filter(Boolean).length} words
          </p>
        </div>

        {/* Source document */}
        {sourceDocument && (
          <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground/70">
            <FileText className="size-3 shrink-0" aria-hidden="true" />
            {sourceDocument}
          </p>
        )}

        {/* Actions */}
        <div className="mt-2.5 flex items-center gap-2">
          {onInsert && (
            <Button
              size="sm"
              variant="default"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onInsert(qaParts.answer, result.id, title)}
            >
              Insert Answer
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleCopy}
          >
            <Copy className="size-3" aria-hidden="true" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            onClick={handleView}
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            View
          </Button>
        </div>
      </div>
    );
  }

  // --- GENERIC RESULT ---
  const summary = result.ai_summary || result.brief || result.snippet || '';

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      {/* Header: badges + similarity */}
      <div className="flex flex-wrap items-center gap-1.5">
        {result.content_type && (
          <Badge variant="secondary" className="text-[10px]">
            {formatContentType(result.content_type)}
          </Badge>
        )}
        {result.primary_domain && (
          <DomainBadge domain={result.primary_domain} />
        )}
        {result.similarity > 0 && (
          <SimilarityBadge score={result.similarity} className="ml-auto" />
        )}
      </div>

      {/* Title */}
      <h4 className="mt-2 text-sm font-medium leading-snug text-foreground line-clamp-2">
        {title}
      </h4>

      {/* Summary */}
      {summary && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-3">
          {summary}
        </p>
      )}

      {/* Actions */}
      <div className="mt-2.5 flex items-center gap-2">
        {onInsert && (
          <Button
            size="sm"
            variant="default"
            className="h-8 gap-1.5 text-xs"
            onClick={() => onInsert(summary, result.id, title)}
          >
            Insert
          </Button>
        )}
        {copyText && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleCopy}
          >
            <Copy className="size-3" aria-hidden="true" />
            Copy
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 text-xs"
          onClick={handleView}
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          View
        </Button>
      </div>
    </div>
  );
}
