'use client';

import { memo } from 'react';
import Link from 'next/link';
import { CircleHelp, FileText, Link2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { CorpusKind, CorpusSearchResult } from '@/types/corpus-search';

/**
 * CorpusResultCard — polymorphic per-`kind` result card (ID-135 {135.7}).
 *
 * EXTENDS the id-111 `ReferenceCard` visual pattern (rounded-lg border,
 * bg-card, group hover-lift, Warm Meridian semantic tokens — see
 * `components/reference/reference-card.tsx`) across all three corpus-search
 * result kinds, rather than mutating the source component (PRODUCT.md
 * BI-12/BI-13). `content_chunk` hits never reach this component — the
 * discriminated union `CorpusSearchResult` has no such member; each
 * `content_chunk` hit is collapsed to its `source_document` server-side
 * before the result reaches the card (BI-12).
 *
 * BI-14 (polymorphic id resolution): the link destination is derived from
 * `result.kind` alone via `destinationHref`, an exhaustive switch over the
 * discriminated union — there is no separate route/destination field that
 * could disagree with `kind`, so mis-routing a kind to the wrong
 * destination is unrepresentable.
 *
 * BI-3 (AI-invisible infrastructure): renders NO similarity/score/model/
 * profile field — `CorpusSearchResult` (`types/corpus-search.ts`)
 * deliberately omits them from the display shape, so there is nothing to
 * accidentally surface.
 *
 * BI-4 (Warm Meridian semantic tokens): the kind label carries text AND an
 * icon — never colour-only — via `Badge` (semantic tokens only, no raw
 * Tailwind colours).
 *
 * Spec: PRODUCT.md BI-3, BI-4, BI-12, BI-13, BI-14; TECH.md §3, §4.
 */

const KIND_META: Record<CorpusKind, { label: string; Icon: LucideIcon }> = {
  answer: { label: 'Answer', Icon: CircleHelp },
  document: { label: 'Document', Icon: FileText },
  reference: { label: 'Reference', Icon: Link2 },
};

/**
 * Derives the link destination from `result.kind` alone (BI-14). An
 * exhaustive switch over the discriminated union — adding a new `kind`
 * without a case here is a compile error, so mis-routing is unrepresentable.
 */
function destinationHref(result: CorpusSearchResult): string {
  switch (result.kind) {
    case 'answer':
      // ID-135 {135.22}: single-pair read/edit viewer shipped at
      // /library/[id] (S440 owner ruling reassigned this from the
      // id-71 family referenced in the {135.19} S438 note — closes NO-1).
      return `/library/${result.id}`;
    case 'document':
      return `/documents/${result.id}`;
    case 'reference':
      return `/reference/${result.id}`;
  }
}

interface CorpusResultCardProps {
  result: CorpusSearchResult;
}

export const CorpusResultCard = memo(function CorpusResultCard({
  result,
}: CorpusResultCardProps) {
  const { label: kindLabel, Icon: KindIcon } = KIND_META[result.kind];
  const href = destinationHref(result);

  const preview =
    result.kind === 'answer'
      ? result.answerSnippet
      : result.kind === 'document'
        ? result.summary
        : null;

  const domainBadges =
    result.kind === 'answer' || result.kind === 'document'
      ? [result.primaryDomain, result.primarySubtopic].filter(
          (value): value is string => Boolean(value),
        )
      : [];

  const scopeTags = result.kind === 'answer' ? result.scopeTags : [];

  return (
    <Link
      href={href}
      prefetch={false}
      className="group flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{ borderLeftWidth: '4px', borderLeftColor: 'var(--border)' }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">
          <KindIcon className="size-3 shrink-0" aria-hidden="true" />
          {kindLabel}
        </Badge>
        {domainBadges.map((value, index) => (
          <Badge
            key={`${value}-${index}`}
            variant="secondary"
            className="text-[10px]"
          >
            {value}
          </Badge>
        ))}
        {scopeTags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-[10px]">
            {tag}
          </Badge>
        ))}
      </div>

      <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {result.title}
      </h3>

      {preview && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {preview}
        </p>
      )}

      {result.kind === 'reference' && result.sourceUrl && (
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {result.sourceUrl}
        </p>
      )}
    </Link>
  );
});
