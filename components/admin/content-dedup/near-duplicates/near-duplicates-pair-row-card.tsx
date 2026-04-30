import { ArrowLeftCircle, ArrowRightCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDateUK } from '@/lib/format';
import type { NearDupPairMember } from '@/lib/query/fetchers';

interface NearDuplicatesPairRowCardProps {
  row: NearDupPairMember;
  side: 'left' | 'right';
}

/**
 * Single-row presentation card used in the side-by-side compare view of
 * the §1.9 near-duplicate detail page.
 *
 * Forked from §1.7's {@link import('../content-dedup-row-card').ContentDedupRowCard}
 * because the prop shape differs: §1.7 uses a `'subject' | 'canonical'`
 * label discriminant on a {@link import('@/lib/query/fetchers').SuspectedDuplicateRow},
 * while §1.9 uses a `'left' | 'right'` side discriminant on a
 * {@link NearDupPairMember} (which carries `content_type`, `archived_at`
 * and lacks the §1.7-specific `metadata` JSON). Per spec §3.3 reuse-first
 * principle, generalising would force both surfaces through a lowest-
 * common-denominator type — the verifier should treat this fork as
 * intentional, not opportunistic-reuse-not-taken.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.2.
 */
export function NearDuplicatesPairRowCard({
  row,
  side,
}: NearDuplicatesPairRowCardProps) {
  const isLeft = side === 'left';
  const labelText = isLeft ? 'Left' : 'Right';
  const Icon = isLeft ? ArrowLeftCircle : ArrowRightCircle;
  const lengthChars = row.content?.length ?? 0;

  return (
    <Card aria-label={labelText} className="flex flex-col">
      <CardHeader className="border-b">
        <Badge
          variant="outline"
          className="w-fit gap-1 text-xs"
          data-testid={`near-dup-row-card-label-${side}`}
        >
          <Icon className="size-3 text-muted-foreground" aria-hidden="true" />
          {labelText}
        </Badge>
        <CardTitle className="mt-2 text-base">
          {row.title?.trim() ? row.title : 'Untitled'}
        </CardTitle>
        <CardDescription className="mt-1 space-y-0.5 text-xs">
          <span className="block">
            <span className="font-medium text-foreground">Created:</span>{' '}
            {formatDateUK(row.created_at)}
          </span>
          <span className="block">
            <span className="font-medium text-foreground">Source:</span>{' '}
            {row.ingest_source ?? '—'}
          </span>
          <span className="block">
            <span className="font-medium text-foreground">Domain:</span>{' '}
            {row.primary_domain ?? '—'}
          </span>
          <span className="block">
            <span className="font-medium text-foreground">Type:</span>{' '}
            {row.content_type ?? '—'}
          </span>
          <span className="block tabular-nums">
            <span className="font-medium text-foreground">Length:</span>{' '}
            {lengthChars} chars
          </span>
          <span className="flex items-center gap-2 pt-1">
            <span className="font-medium text-foreground">Status:</span>
            <Badge variant="secondary" className="text-xs">
              {row.publication_status}
            </Badge>
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div
          className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap"
          tabIndex={0}
          role="region"
          aria-label={`${labelText} content body`}
        >
          {row.content?.trim() ? row.content : '(empty)'}
        </div>
      </CardContent>
    </Card>
  );
}
