'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertTriangle, Coins } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CostEstimateResponse {
  total_questions: number;
  eligible_questions: number;
  estimated_cost_min: number;
  estimated_cost_max: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  breakdown: Array<{
    questionId: string;
    questionText: string;
    contentItemCount: number;
    estimatedTokens: number;
    costMin: number;
    costMax: number;
  }>;
}

interface CostEstimateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bidId: string;
  onProceed: () => void;
}

/**
 * Dialog that fetches and displays a cost estimate before batch drafting.
 * Shows eligible question count, estimated cost range (USD), and token counts.
 */
export function CostEstimateDialog({
  open,
  onOpenChange,
  bidId,
  onProceed,
}: CostEstimateDialogProps) {
  const [estimate, setEstimate] = useState<CostEstimateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEstimate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setEstimate(null);

    try {
      const response = await fetch(`/api/bids/${bidId}/responses/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip_existing: true }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch cost estimate');
      }

      const data: CostEstimateResponse = await response.json();
      setEstimate(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cost estimate');
    } finally {
      setLoading(false);
    }
  }, [bidId]);

  useEffect(() => {
    if (open) {
      fetchEstimate();
    } else {
      // Reset state when dialog closes
      setEstimate(null);
      setError(null);
    }
  }, [open, fetchEstimate]);

  function formatCost(cost: number): string {
    if (cost < 0.01) return '<$0.01';
    return `$${cost.toFixed(2)}`;
  }

  function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toLocaleString();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="size-5 text-status-warning" aria-hidden="true" />
            Cost Estimate
          </DialogTitle>
          <DialogDescription>
            Estimated API cost for drafting all eligible questions through the
            three-pass AI pipeline (analysis, drafting, quality check).
          </DialogDescription>
        </DialogHeader>

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-8" role="status">
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              Calculating cost estimate...
            </p>
            <span className="sr-only">Loading cost estimate</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-6 text-center">
            <AlertTriangle className="size-6 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchEstimate}>
              Retry
            </Button>
          </div>
        )}

        {/* Estimate display */}
        {estimate && !loading && !error && (
          <div className="space-y-4">
            {/* Summary stats */}
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  Eligible Questions
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {estimate.eligible_questions}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    / {estimate.total_questions}
                  </span>
                </dd>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  Estimated Tokens
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {formatTokens(estimate.estimated_input_tokens + estimate.estimated_output_tokens)}
                </dd>
              </div>
            </dl>

            {/* Cost range */}
            <div className="rounded-md border bg-quality-moderate-bg p-4">
              <p className="text-sm font-medium text-foreground">
                Estimated Cost (USD)
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-status-warning">
                {formatCost(estimate.estimated_cost_min)}
                {' '}&ndash;{' '}
                {formatCost(estimate.estimated_cost_max)}
              </p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Lower bound assumes 80% prompt cache hit rate.
                Upper bound assumes no caching. Actual cost depends on
                Anthropic API cache behaviour.
              </p>
            </div>

            {/* Token breakdown */}
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Input:</span>{' '}
              {formatTokens(estimate.estimated_input_tokens)}
              {' | '}
              <span className="font-medium">Output:</span>{' '}
              {formatTokens(estimate.estimated_output_tokens)}
            </div>

            {estimate.eligible_questions === 0 && (
              <p className="text-sm text-muted-foreground">
                No questions are eligible for drafting. All questions either have
                existing responses or lack matched KB content.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onProceed();
            }}
            disabled={loading || !!error || (estimate?.eligible_questions ?? 0) === 0}
          >
            Proceed with Drafting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
