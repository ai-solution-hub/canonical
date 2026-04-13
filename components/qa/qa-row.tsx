'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface QARowProps {
  item: ContentListItem;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// QARow Component
// ---------------------------------------------------------------------------

export function QARow({ item, selected, onToggleSelect }: QARowProps) {
  const [expanded, setExpanded] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const hasStandard = !!item.answer_standard;
  const hasAdvanced = !!item.answer_advanced;
  const sourceFile =
    item.source_file ??
    ((item.metadata as Record<string, unknown> | null)?.source_file as
      | string
      | undefined);

  const handleCopy = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(label);
    toast.success(`${label} copied`);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const freshness = item.freshness as string | null;

  return (
    <div
      data-qa-row
      tabIndex={0}
      className={cn(
        'rounded-lg border bg-card transition-colors hover:border-border/80 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-primary/30 border-primary/40',
      )}
    >
      {/* Row header — always visible */}
      <div className="flex w-full items-start gap-3 p-4">
        {/* Checkbox */}
        {onToggleSelect && (
          <div
            className="mt-0.5 shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] -m-2.5"
            role="presentation"
          >
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelect(item.id)}
              aria-label={`Select "${item.title}"`}
              className="cursor-pointer"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-start gap-3 text-left min-w-0"
          aria-expanded={expanded}
        >
          <span className="mt-0.5 shrink-0 text-foreground/60">
            {expanded ? (
              <ChevronDown className="size-5" />
            ) : (
              <ChevronRight className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground leading-snug">
              {item.title}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {item.primary_domain && (
                <span>
                  {item.primary_domain}
                  {item.primary_subtopic ? ` > ${item.primary_subtopic}` : ''}
                </span>
              )}
              {sourceFile && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate max-w-[200px]">{sourceFile}</span>
                </>
              )}
              {freshness && (
                <>
                  <span aria-hidden="true">·</span>
                  <FreshnessBadge freshness={freshness} compact />
                </>
              )}
              {hasStandard && hasAdvanced && (
                <>
                  <span aria-hidden="true">·</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    Standard + Advanced
                  </Badge>
                </>
              )}
            </div>
          </div>
        </button>
        {/* Quick copy button — visible on collapsed rows */}
        {!expanded && (hasStandard || hasAdvanced || item.content) && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 h-7 w-7 p-0 min-h-[44px] min-w-[44px] -m-2 text-muted-foreground hover:text-foreground"
            aria-label={`Copy answer for "${item.title}"`}
            data-copy-answer=""
            onClick={(e) => {
              e.stopPropagation();
              const text =
                item.answer_standard ||
                item.answer_advanced ||
                item.content ||
                '';
              handleCopy(text, 'Answer');
            }}
          >
            {copiedField === 'Answer' ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        )}
        <Link
          href={`/item/${item.id}`}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={`Open detail view for "${item.title}"`}
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>

      {/* Expanded answer content */}
      <div
        className={cn(
          'grid motion-safe:transition-all motion-safe:duration-200 overflow-hidden',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0">
          <div className="border-t border-border px-4 pb-4 pt-3 pl-11">
            {hasStandard && (
              <div className="mb-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Standard
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 min-h-[44px] min-w-[44px] gap-1 text-xs"
                    data-copy-answer=""
                    onClick={() =>
                      handleCopy(item.answer_standard!, 'Standard answer')
                    }
                  >
                    {copiedField === 'Standard answer' ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    Copy
                    <kbd className="ml-1 hidden rounded border border-border px-1 py-0.5 text-[10px] font-normal text-muted-foreground sm:inline">
                      C
                    </kbd>
                  </Button>
                </div>
                <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                  {item.answer_standard}
                </p>
              </div>
            )}
            {hasAdvanced && (
              <div
                className={
                  hasStandard ? 'mt-4 border-t border-border/50 pt-3' : ''
                }
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Advanced
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 min-h-[44px] min-w-[44px] gap-1 text-xs"
                    {...(!hasStandard ? { 'data-copy-answer': '' } : {})}
                    onClick={() =>
                      handleCopy(item.answer_advanced!, 'Advanced answer')
                    }
                  >
                    {copiedField === 'Advanced answer' ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    Copy
                    {!hasStandard && (
                      <kbd className="ml-1 hidden rounded border border-border px-1 py-0.5 text-[10px] font-normal text-muted-foreground sm:inline">
                        C
                      </kbd>
                    )}
                  </Button>
                </div>
                <p className="text-sm text-foreground whitespace-pre-line leading-relaxed">
                  {item.answer_advanced}
                </p>
              </div>
            )}
            {!hasStandard && !hasAdvanced && item.content && (
              <div className="text-sm text-foreground leading-relaxed">
                <ContentRenderer content={item.content} />
              </div>
            )}
            {!hasStandard && !hasAdvanced && !item.content && (
              <p className="text-sm italic text-muted-foreground">
                No answer recorded yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
