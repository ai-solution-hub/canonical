import { AlertTriangle, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDateUK } from '@/lib/format';
import type { SuspectedDuplicateRow } from '@/lib/query/fetchers';

interface ContentDedupRowCardProps {
  row: SuspectedDuplicateRow;
  label: 'subject' | 'canonical';
}

/**
 * Single-row presentation card used in the side-by-side compare view.
 *
 * Pure presentation — receives a `row` plus a `label` discriminant that
 * decides whether the row is the suspected duplicate (`subject`) or the
 * existing canonical match (`canonical`). Renders title, key metadata,
 * publication-status badge, and a scrollable content body.
 */
export function ContentDedupRowCard({ row, label }: ContentDedupRowCardProps) {
  const isSubject = label === 'subject';
  const labelText = isSubject ? 'Subject (suspected)' : 'Canonical (existing)';
  const Icon = isSubject ? AlertTriangle : BookOpen;
  const iconClass = isSubject
    ? 'text-status-warning'
    : 'text-status-success';

  return (
    <Card aria-label={labelText} className="flex flex-col">
      <CardHeader className="border-b">
        <Badge
          variant="outline"
          className="w-fit gap-1 text-xs"
          data-testid={`row-card-label-${label}`}
        >
          <Icon className={`size-3 ${iconClass}`} aria-hidden="true" />
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
