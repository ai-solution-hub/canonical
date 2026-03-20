'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lightbulb, ArrowRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { ClaudePromptButton } from '@/components/claude-prompt-button';
import { DomainBadge } from '@/components/domain-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ContentSuggestion } from '@/lib/content-suggestions';
import {
  generateContentSuggestionPrompt,
  generateBulkGapFillingPrompt,
} from '@/lib/claude-prompts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentSuggestionsSectionProps {
  /** Maximum number of suggestions to display */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Priority indicators
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<string, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'text-status-error font-semibold' },
  high: { label: 'High', className: 'text-status-warning font-medium' },
  medium: { label: 'Medium', className: 'text-muted-foreground' },
  low: { label: 'Low', className: 'text-muted-foreground/70' },
};

// ---------------------------------------------------------------------------
// Suggestion type labels
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  empty_subtopic: 'Empty subtopic',
  thin_coverage: 'Thin coverage',
  stale_only: 'All content stale',
  template_gap: 'Template gap',
  missing_layer: 'Missing layer',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dashboard section showing smart content creation suggestions.
 *
 * Fetches suggestions from /api/content-suggestions and displays
 * the top N as actionable cards with Claude prompts and coverage links.
 */
export function ContentSuggestionsSection({
  limit = 5,
}: ContentSuggestionsSectionProps) {
  const [suggestions, setSuggestions] = useState<ContentSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSuggestions() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/content-suggestions?limit=${limit}`);
        if (!response.ok) {
          throw new Error('Failed to load suggestions');
        }
        const data = await response.json();
        if (!cancelled) {
          setSuggestions(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load suggestions');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSuggestions();

    return () => {
      cancelled = true;
    };
  }, [limit]);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <section
        aria-label="Content suggestions"
        className="rounded-lg border border-border bg-card p-4"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <section
        aria-label="Content suggestions"
        className="rounded-lg border border-border bg-card p-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Lightbulb className="size-4" aria-hidden="true" />
          Content Suggestions
        </h2>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <AlertTriangle className="size-4 shrink-0 text-status-warning" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Could not load suggestions. Try refreshing the page.
          </p>
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Empty state — no suggestions means coverage is good
  // -------------------------------------------------------------------------

  if (suggestions.length === 0) {
    return null;
  }

  // -------------------------------------------------------------------------
  // Suggestions list
  // -------------------------------------------------------------------------

  return (
    <section
      aria-label="Content suggestions"
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Lightbulb className="size-4" aria-hidden="true" />
          Content Suggestions
        </h2>
        {suggestions.length >= 2 && (
          <ClaudePromptButton
            prompt={generateBulkGapFillingPrompt(suggestions).prompt}
            label="Fill all gaps"
            size="sm"
            className="shrink-0"
          />
        )}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        Coverage gaps that could strengthen your knowledge base:
      </p>

      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => {
          const priorityStyle = PRIORITY_STYLES[suggestion.priority] ?? PRIORITY_STYLES.medium;
          const typeLabel = TYPE_LABELS[suggestion.suggestion_type] ?? suggestion.suggestion_type;
          const prompt = generateContentSuggestionPrompt(suggestion);

          return (
            <div
              key={suggestion.id}
              className={cn(
                'rounded-lg border border-border/60 bg-muted/30 p-3',
                'transition-colors hover:bg-muted/50',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DomainBadge domain={suggestion.domain} />
                    <span className={cn('text-xs', priorityStyle.className)}>
                      {priorityStyle.label}
                    </span>
                    <span className="text-xs text-muted-foreground/70">
                      {typeLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {suggestion.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {suggestion.description}
                  </p>

                  {/* Freshness breakdown bar */}
                  {suggestion.freshness_breakdown && suggestion.item_count > 0 && (
                    <FreshnessBar breakdown={suggestion.freshness_breakdown} />
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <ClaudePromptButton
                    prompt={prompt.prompt}
                    label="Create"
                    size="sm"
                  />
                  <Link
                    href={`/coverage?domain=${encodeURIComponent(suggestion.domain)}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    aria-label={`View coverage for ${suggestion.domain}`}
                  >
                    Coverage
                    <ArrowRight className="size-3" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Link to full coverage page */}
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-xs text-muted-foreground">
          <Link href="/coverage">
            <RefreshCw className="size-3" aria-hidden="true" />
            View full coverage
          </Link>
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Freshness breakdown bar (inline sub-component)
// ---------------------------------------------------------------------------

function FreshnessBar({
  breakdown,
}: {
  breakdown: NonNullable<ContentSuggestion['freshness_breakdown']>;
}) {
  const total = breakdown.fresh + breakdown.aging + breakdown.stale + breakdown.expired;
  if (total === 0) return null;

  const segments = [
    { count: breakdown.fresh, className: 'bg-freshness-fresh', label: 'fresh' },
    { count: breakdown.aging, className: 'bg-freshness-aging', label: 'aging' },
    { count: breakdown.stale, className: 'bg-freshness-stale', label: 'stale' },
    { count: breakdown.expired, className: 'bg-freshness-expired', label: 'expired' },
  ].filter((s) => s.count > 0);

  return (
    <div className="mt-1.5" role="img" aria-label={`Freshness: ${segments.map((s) => `${s.count} ${s.label}`).join(', ')}`}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={cn('h-full', segment.className)}
            style={{ width: `${(segment.count / total) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
