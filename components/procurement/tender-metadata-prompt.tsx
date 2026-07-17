'use client';

import { useState } from 'react';
import {
  Building2,
  Calendar,
  Hash,
  PoundSterling,
  FileText,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatDateUK } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TenderExtractedMetadata } from '@/types/procurement-metadata';

interface TenderMetadataPromptProps {
  metadata: TenderExtractedMetadata;
  procurementId: string;
  onUpdated?: () => void;
  className?: string;
}

/**
 * Dismissable card shown on the bid detail page when tender metadata
 * has been extracted. Displays key fields and allows applying to the bid.
 */
export function TenderMetadataPrompt({
  metadata,
  procurementId,
  onUpdated,
  className,
}: TenderMetadataPromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  if (dismissed) return null;

  const hasData =
    metadata.buyer_name ||
    metadata.deadline ||
    metadata.estimated_value ||
    metadata.reference_number ||
    metadata.title;

  if (!hasData) return null;

  async function handleApply() {
    setApplying(true);
    try {
      const body: Record<string, string | null> = {};
      if (metadata.buyer_name) body.buyer = metadata.buyer_name;
      if (metadata.deadline) body.deadline = metadata.deadline;
      if (metadata.reference_number)
        body.reference_number = metadata.reference_number;
      if (metadata.estimated_value)
        body.estimated_value = metadata.estimated_value;
      if (metadata.title) body.name = metadata.title;

      const res = await fetch(`/api/procurement/${procurementId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success('Tender metadata applied to procurement');
        setDismissed(true);
        onUpdated?.();
      } else {
        toast.error('Failed to apply tender metadata. Please try again.');
      }
    } catch (err) {
      console.error('Failed to apply tender metadata:', err);
      toast.error(
        'Failed to apply tender metadata. Check your connection and try again.',
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <div
      className={cn('relative rounded-lg border bg-card p-4', className)}
      role="region"
      aria-label="Extracted tender metadata"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss tender metadata"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Tender Metadata Detected
          </h3>
        </div>

        <p className="text-xs text-muted-foreground">
          The following details were extracted from the tender document.
        </p>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          {metadata.title && (
            <div className="flex items-start gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                Title
              </dt>
              <dd className="font-medium">{metadata.title}</dd>
            </div>
          )}
          {metadata.buyer_name && (
            <div className="flex items-start gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
                Buyer
              </dt>
              <dd className="font-medium">{metadata.buyer_name}</dd>
            </div>
          )}
          {metadata.deadline && (
            <div className="flex items-start gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                Deadline
              </dt>
              <dd className="font-medium">{formatDateUK(metadata.deadline)}</dd>
            </div>
          )}
          {metadata.estimated_value && (
            <div className="flex items-start gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <PoundSterling
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                Value
              </dt>
              <dd className="font-medium">{metadata.estimated_value}</dd>
            </div>
          )}
          {metadata.reference_number && (
            <div className="flex items-start gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <Hash className="size-3.5 shrink-0" aria-hidden="true" />
                Reference
              </dt>
              <dd className="font-medium">{metadata.reference_number}</dd>
            </div>
          )}
        </dl>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDismissed(true)}
          >
            Dismiss
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? 'Updating…' : 'Update Procurement Details'}
          </Button>
        </div>
      </div>
    </div>
  );
}
