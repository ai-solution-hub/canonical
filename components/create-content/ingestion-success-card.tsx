'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  ExternalLink,
  Plus,
  AlertTriangle,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

/** @public */
export interface IngestionSuccessCardProps {
  /**
   * Retained for caller compatibility — `IngestionSuccessCard` now always
   * renders the reference variant (ID-110 manual-URL reference_items
   * landing). The historic `content` variant (content_items landing) was
   * deleted under {S452 orphan-cluster} bl-405 Q3: it had zero live callers
   * since {131.24} (`upload-tab-content.tsx` stopped consuming it under
   * G-UPLOAD-GATE) and `url-ingest-form.tsx`, the sole remaining caller,
   * always passes `kind: 'reference'`.
   */
  kind?: 'reference';
  /**
   * The reference_items id for the reference variant. Rendered as a copyable
   * value and, when non-empty, as the target of the "View reference" link
   * (/reference/<id>).
   */
  referenceId?: string;
  title: string;
  /** Summary text — surfaced by the reference variant. */
  summary?: string | null;
  domain?: string;
  subtopic?: string;
  warnings?: string[];
}

/**
 * Success card shown after content ingestion completes.
 *
 * Always renders the `reference` variant (ID-110 manual-URL imports landing
 * in reference_items) — it omits the contentType badge and any /item/<id>
 * link (reference_items have no content_items detail page) and instead
 * links to the reference's own detail page (/reference/<id>, shipped under
 * ID-111.7). `url-ingest-form.tsx` is the sole caller (confirmed via
 * gitnexus_impact, ID-139.5) and always renders `kind: 'reference'`.
 *
 * The historic `content` variant (content_items landing) was deleted under
 * {S452 orphan-cluster} bl-405 Q3 — see `IngestionSuccessCardProps.kind`
 * doc for the caller history that made it dead code.
 */
export function IngestionSuccessCard(props: IngestionSuccessCardProps) {
  return (
    <ReferenceSuccessCard
      referenceId={props.referenceId ?? ''}
      title={props.title}
      summary={props.summary}
      domain={props.domain}
      subtopic={props.subtopic}
      warnings={props.warnings}
    />
  );
}

interface ReferenceSuccessCardProps {
  referenceId: string;
  title: string;
  summary?: string | null;
  domain?: string;
  subtopic?: string;
  warnings?: string[];
}

/**
 * Reference variant — manual-URL imports landing in reference_items (ID-110).
 *
 * Renders the title, summary, domain/subtopic badges, warnings, a copyable
 * reference id and — when referenceId is non-empty — a "View reference" link to
 * the /reference/<id> detail page (ID-111.7). Deliberately omits the
 * contentType badge and any /item/<id> "view item" link: reference_items
 * have no content_items detail page.
 */
function ReferenceSuccessCard({
  referenceId,
  title,
  summary,
  domain,
  subtopic,
  warnings,
}: ReferenceSuccessCardProps) {
  const copyReferenceId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(referenceId);
      toast.success('Reference ID copied to clipboard');
    } catch {
      toast.error('Could not copy the reference ID');
    }
  }, [referenceId]);

  return (
    <div className="rounded-lg border border-status-success/30 bg-status-success/10 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle
          className="mt-0.5 size-5 shrink-0 text-status-success"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">
            Reference saved successfully
          </h3>

          <p className="mt-1 text-sm font-medium text-foreground">{title}</p>

          {summary && (
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          )}

          {/* Classification badges */}
          {(domain || subtopic) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {domain && (
                <Badge variant="secondary" className="text-xs">
                  {domain}
                </Badge>
              )}
              {subtopic && (
                <Badge variant="secondary" className="text-xs">
                  {subtopic}
                </Badge>
              )}
            </div>
          )}

          {/* Warnings */}
          {warnings && warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {warnings.map((warning, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs">
                  <AlertTriangle
                    className="mt-0.5 size-3 shrink-0 text-status-warning"
                    aria-hidden="true"
                  />
                  <span className="text-status-warning">{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Copyable reference id — a durable lookup affordance retained
              alongside the "View reference" link below. */}
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">Reference ID</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {referenceId}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 px-2 text-xs"
                onClick={copyReferenceId}
                aria-label="Copy reference ID"
              >
                <Copy className="size-3" aria-hidden="true" />
                Copy
              </Button>
            </div>
          </div>

          {/* Actions. The "View reference" link points at the reference's own
              detail page (/reference/<id>, ID-111.7); guarded on a non-empty
              referenceId so an empty id never links to a bare /reference/ (which
              would 404) — copyable-id-only behaviour is retained in that case. */}
          <div className="mt-4 flex items-center gap-2">
            {referenceId && (
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link href={`/reference/${referenceId}`}>
                  View reference
                  <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="ghost" className="gap-1.5">
              <Link href="/item/new">
                <Plus className="size-3" aria-hidden="true" />
                Create another
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
