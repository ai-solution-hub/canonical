'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

interface AiProcessingIndicatorsProps {
  item: ItemData;
  onItemUpdated: React.Dispatch<React.SetStateAction<ItemData>>;
}

/**
 * Displays classification / summary generation prompts for content items
 * that are missing AI processing. Allows editors to trigger processing
 * on demand.
 */
export function AiProcessingIndicators({
  item,
  onItemUpdated,
}: AiProcessingIndicatorsProps) {
  const [classifying, setClassifying] = useState(false);
  const [summarising, setSummarising] = useState(false);

  const needsClassification = !item.classified_at;
  const needsSummary = !item.ai_summary;

  if (!needsClassification && !needsSummary) return null;

  const handleClassify = async () => {
    setClassifying(true);
    try {
      const res = await fetch(`/api/items/${item.id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Classification failed');
        return;
      }
      onItemUpdated((prev) => ({
        ...prev,
        primary_domain: data.primary_domain,
        primary_subtopic: data.primary_subtopic,
        secondary_domain: data.secondary_domain,
        secondary_subtopic: data.secondary_subtopic,
        ai_keywords: data.ai_keywords,
        ai_summary: data.ai_summary,
        suggested_title: data.suggested_title,
        classification_confidence: data.classification_confidence,
        classification_reasoning: data.classification_reasoning,
        classified_at: new Date().toISOString(),
      }));
      toast.success('Classification complete');
    } catch (err) {
      console.error('Failed to classify content:', err);
      toast.error('Failed to classify content');
    } finally {
      setClassifying(false);
    }
  };

  const handleSummarise = async () => {
    setSummarising(true);
    try {
      const res = await fetch('/api/summaries/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Summary generation failed');
        return;
      }
      onItemUpdated((prev) => ({
        ...prev,
        ai_summary: data.ai_summary ?? prev.ai_summary,
        summary_data: data.summary_data ?? prev.summary_data,
      }));
      toast.success('Summary generated');
    } catch (err) {
      console.error('Failed to generate summary:', err);
      toast.error('Failed to generate summary');
    } finally {
      setSummarising(false);
    }
  };

  return (
    <div className="mb-6 flex flex-col gap-2">
      {needsClassification && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Classification pending
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClassify}
            disabled={classifying}
            className="h-7 gap-1.5 text-xs"
          >
            {classifying ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {classifying ? 'Classifying...' : 'Classify now'}
          </Button>
        </div>
      )}
      {needsSummary && (
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            Summary not yet generated
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSummarise}
            disabled={summarising}
            className="h-7 gap-1.5 text-xs"
          >
            {summarising ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {summarising ? 'Generating...' : 'Generate summary'}
          </Button>
        </div>
      )}
    </div>
  );
}
