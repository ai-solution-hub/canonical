'use client';

import { useState, useCallback } from 'react';
import { Layers, Check, ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayerSuggestionData {
  suggestedLayer: string;
  reason: string;
  confidence: string;
}

export interface TopicSuggestionData {
  topicId: string;
  reason: string;
}

export interface LayerSuggestionBannerProps {
  /** The ID of the newly created item */
  itemId: string;
  /** The layer suggestion from inference */
  suggestedLayer: LayerSuggestionData;
  /** Optional topic suggestion */
  topicSuggestion?: TopicSuggestionData;
  /** Callback when the banner is dismissed */
  onDismiss?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Banner shown after item creation to suggest a content layer assignment.
 *
 * Three user actions:
 *   - Accept: applies the suggested layer via PATCH
 *   - Change: shows a dropdown to pick a different layer, then applies it
 *   - Dismiss: hides the banner without making changes
 *
 * Uses semantic colour tokens only (no raw Tailwind).
 */
export function LayerSuggestionBanner({
  itemId,
  suggestedLayer,
  topicSuggestion,
  onDismiss,
}: LayerSuggestionBannerProps) {
  const { layers, getLayerLabel } = useLayerVocabulary();

  const [mode, setMode] = useState<'suggest' | 'change'>('suggest');
  const [selectedLayer, setSelectedLayer] = useState(
    suggestedLayer.suggestedLayer,
  );
  const [isApplying, setIsApplying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const applyLayer = useCallback(
    async (layerKey: string) => {
      setIsApplying(true);
      try {
        const body: Record<string, string> = { layer: layerKey };
        if (topicSuggestion?.topicId) {
          body.topic_id = topicSuggestion.topicId;
        }

        const res = await fetch(`/api/items/${itemId}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update layer');
        }

        toast.success(`Layer set to ${getLayerLabel(layerKey)}`);
        setIsDismissed(true);
        onDismiss?.();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to update layer',
        );
      } finally {
        setIsApplying(false);
      }
    },
    [itemId, topicSuggestion, getLayerLabel, onDismiss],
  );

  const handleAccept = useCallback(() => {
    applyLayer(suggestedLayer.suggestedLayer);
  }, [applyLayer, suggestedLayer.suggestedLayer]);

  const handleChangeConfirm = useCallback(() => {
    applyLayer(selectedLayer);
  }, [applyLayer, selectedLayer]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    onDismiss?.();
  }, [onDismiss]);

  if (isDismissed) return null;

  return (
    <div
      role="region"
      aria-label="Layer suggestion"
      className="rounded-lg border border-primary/20 bg-primary/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Layers
          className="mt-0.5 size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground">
              Suggested layer:{' '}
              <span className="text-primary">
                {getLayerLabel(suggestedLayer.suggestedLayer)}
              </span>
            </h3>
            <button
              type="button"
              onClick={handleDismiss}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss layer suggestion"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Reason */}
          <p className="mt-1 text-xs text-muted-foreground">
            {suggestedLayer.reason}
          </p>

          {/* Topic suggestion (if present) */}
          {topicSuggestion && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Topic group:{' '}
              <span className="font-medium text-foreground">
                {topicSuggestion.topicId}
              </span>{' '}
              &mdash; {topicSuggestion.reason}
            </p>
          )}

          {/* Actions */}
          {mode === 'suggest' ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleAccept}
                disabled={isApplying}
                className="gap-1.5"
                aria-label={`Accept suggested layer: ${getLayerLabel(suggestedLayer.suggestedLayer)}`}
              >
                <Check className="size-3.5" aria-hidden="true" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMode('change')}
                disabled={isApplying}
                className="gap-1.5"
                aria-label="Change suggested layer"
              >
                <ChevronDown className="size-3.5" aria-hidden="true" />
                Change
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                disabled={isApplying}
                aria-label="Dismiss layer suggestion"
              >
                Dismiss
              </Button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select value={selectedLayer} onValueChange={setSelectedLayer}>
                <SelectTrigger
                  className="h-8 w-48 text-xs"
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
                onClick={handleChangeConfirm}
                disabled={isApplying}
                className="gap-1.5"
                aria-label={`Apply layer: ${getLayerLabel(selectedLayer)}`}
              >
                <Check className="size-3.5" aria-hidden="true" />
                Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMode('suggest')}
                disabled={isApplying}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
