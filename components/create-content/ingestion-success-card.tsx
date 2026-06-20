'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  ExternalLink,
  Plus,
  AlertTriangle,
  Layers,
  Check,
  ChevronDown,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { toast } from 'sonner';

/** @public */
export interface LayerSuggestionInfo {
  suggestedLayer: string;
  reason: string;
  confidence: string;
}

/** @public */
export interface IngestionSuccessCardProps {
  /**
   * Which landing this card describes. `content` (default) is the historic
   * content_items landing — title links to /item/<id>, shows the contentType
   * badge and the layer-suggestion control. `reference` is the ID-110
   * manual-URL reference_items landing — it omits the contentType badge and
   * layer controls and surfaces a copyable referenceId, plus (since ID-111.7
   * shipped the /reference/<id> detail page) a "View reference" link.
   */
  kind?: 'content' | 'reference';
  itemId?: string;
  /**
   * The reference_items id for the reference variant. Rendered as a copyable
   * value and, when non-empty, as the target of the "View reference" link
   * (/reference/<id>).
   */
  referenceId?: string;
  title: string;
  contentType?: string;
  /** Summary text — surfaced by the reference variant. */
  summary?: string | null;
  domain?: string;
  subtopic?: string;
  warnings?: string[];
  dedupMatches?: Array<{
    id: string;
    title: string;
    similarity: number;
  }>;
  /** Layer suggestion from inference, if available */
  suggestedLayer?: LayerSuggestionInfo;
}

/**
 * Success card shown after content ingestion completes.
 *
 * Dispatches on `kind`: the `reference` variant (ID-110 manual-URL imports
 * landing in reference_items) is structurally distinct from the historic
 * `content` variant — it must not render a layer Select, a contentType badge
 * or a /item/<id> link (reference_items have no content_items detail page).
 * It does link to the reference's own detail page (/reference/<id>, shipped
 * under ID-111.7). Splitting the variants keeps the content variant's
 * `useLayerVocabulary` call unconditional and means the reference variant has
 * no vocabulary-context dependency.
 */
export function IngestionSuccessCard(props: IngestionSuccessCardProps) {
  if (props.kind === 'reference') {
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
  return <ContentSuccessCard {...props} />;
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
 * contentType badge, the layer-suggestion Select and any /item/<id> "view item"
 * link: reference_items have no content_items detail page.
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

interface ContentSuccessCardProps {
  itemId?: string;
  title: string;
  contentType?: string;
  domain?: string;
  subtopic?: string;
  warnings?: string[];
  dedupMatches?: Array<{
    id: string;
    title: string;
    similarity: number;
  }>;
  suggestedLayer?: LayerSuggestionInfo;
}

/**
 * Content variant — historic content_items landing (unchanged behaviour;
 * extracted from the original component so the reference variant can opt out of
 * the layer-vocabulary context). Consumed by url-ingest-form (legacy shape) and
 * upload-tab-content.
 */
function ContentSuccessCard({
  itemId = '',
  title,
  contentType = 'other',
  domain,
  subtopic,
  warnings,
  dedupMatches,
  suggestedLayer,
}: ContentSuccessCardProps) {
  const { layers, getLayerLabel } = useLayerVocabulary();

  const [layerMode, setLayerMode] = useState<'suggest' | 'change' | 'applied'>(
    'suggest',
  );
  const [selectedLayer, setSelectedLayer] = useState(
    suggestedLayer?.suggestedLayer ?? '',
  );
  const [isApplyingLayer, setIsApplyingLayer] = useState(false);
  const [appliedLayerLabel, setAppliedLayerLabel] = useState('');

  const applyLayer = useCallback(
    async (layerKey: string) => {
      setIsApplyingLayer(true);
      try {
        const res = await fetch(`/api/items/${itemId}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layer: layerKey }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update layer');
        }
        setAppliedLayerLabel(getLayerLabel(layerKey));
        setLayerMode('applied');
        toast.success(`Layer set to ${getLayerLabel(layerKey)}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to update layer',
        );
      } finally {
        setIsApplyingLayer(false);
      }
    },
    [itemId, getLayerLabel],
  );

  return (
    <div className="rounded-lg border border-status-success/30 bg-status-success/10 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle
          className="mt-0.5 size-5 shrink-0 text-status-success"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">
            Content ingested successfully
          </h3>

          {/* Title with link */}
          <Link
            href={`/item/${itemId}`}
            className="mt-1 block text-sm font-medium text-primary hover:underline"
          >
            {title}
          </Link>

          {/* Classification badges */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs">
              {contentType.replace(/_/g, ' ')}
            </Badge>
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

          {/* Layer suggestion */}
          {suggestedLayer && (
            <div
              className="mt-3 flex flex-wrap items-center gap-2 text-xs"
              data-testid="layer-suggestion-row"
            >
              <Layers className="size-3.5 text-primary" aria-hidden="true" />
              {layerMode === 'applied' ? (
                <span className="text-muted-foreground">
                  Layer:{' '}
                  <span className="font-medium text-foreground">
                    {appliedLayerLabel}
                  </span>
                </span>
              ) : layerMode === 'change' ? (
                <>
                  <Select
                    value={selectedLayer}
                    onValueChange={setSelectedLayer}
                  >
                    <SelectTrigger
                      className="h-7 w-40 text-xs"
                      aria-label="Select a layer"
                    >
                      <SelectValue placeholder="Select layer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {layers.map((layer) => (
                        <SelectItem key={layer.key} value={layer.key}>
                          {layer.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => applyLayer(selectedLayer)}
                    disabled={isApplyingLayer}
                    aria-label={`Apply layer: ${getLayerLabel(selectedLayer)}`}
                  >
                    <Check className="size-3" aria-hidden="true" />
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLayerMode('suggest')}
                    disabled={isApplyingLayer}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    Suggested layer:{' '}
                    <span className="font-medium text-foreground">
                      {getLayerLabel(suggestedLayer.suggestedLayer)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => applyLayer(suggestedLayer.suggestedLayer)}
                    disabled={isApplyingLayer}
                    aria-label={`Accept suggested layer: ${getLayerLabel(suggestedLayer.suggestedLayer)}`}
                  >
                    <Check className="size-3" aria-hidden="true" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => setLayerMode('change')}
                    disabled={isApplyingLayer}
                    aria-label="Change suggested layer"
                  >
                    <ChevronDown className="size-3" aria-hidden="true" />
                    Change
                  </Button>
                </>
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

          {/* Dedup matches */}
          {dedupMatches && dedupMatches.length > 0 && (
            <div className="mt-3 rounded border border-status-warning/20 bg-status-warning/5 p-2">
              <p className="text-xs font-medium text-status-warning">
                Similar items found:
              </p>
              <ul className="mt-1 space-y-1">
                {dedupMatches.map((match) => (
                  <li
                    key={match.id}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <Link
                      href={`/item/${match.id}`}
                      className="text-primary hover:underline"
                    >
                      {match.title}
                    </Link>
                    <span className="text-muted-foreground">
                      ({Math.round(match.similarity * 100)}% similar)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={`/item/${itemId}`}>
                View item
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            </Button>
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
