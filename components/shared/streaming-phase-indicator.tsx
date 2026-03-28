'use client';

import { Loader2, Search, PenLine, ShieldCheck, Save, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { StreamPhase } from '@/hooks/streaming/use-draft-stream';

const PHASE_CONFIG: Record<
  Exclude<StreamPhase, 'idle'>,
  { label: string; icon: React.ElementType; colour: string }
> = {
  analysing: {
    label: 'Analysing question...',
    icon: Search,
    colour: 'text-phase-analysing',
  },
  drafting: {
    label: 'Drafting response...',
    icon: PenLine,
    colour: 'text-phase-drafting',
  },
  quality: {
    label: 'Running quality check...',
    icon: ShieldCheck,
    colour: 'text-phase-quality',
  },
  saving: {
    label: 'Saving to database...',
    icon: Save,
    colour: 'text-phase-saving',
  },
  done: {
    label: 'Complete',
    icon: CheckCircle2,
    colour: 'text-phase-done',
  },
  error: {
    label: 'Error',
    icon: AlertCircle,
    colour: 'text-destructive',
  },
};

interface StreamingPhaseIndicatorProps {
  phase: StreamPhase;
  error?: string | null;
  qualityScore?: number | null;
  totalCost?: number | null;
  onCancel?: () => void;
  className?: string;
}

export function StreamingPhaseIndicator({
  phase,
  error,
  qualityScore,
  totalCost,
  onCancel,
  className,
}: StreamingPhaseIndicatorProps) {
  if (phase === 'idle') return null;

  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const isActive = phase !== 'done' && phase !== 'error';

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
        phase === 'error' && 'border-destructive/50 bg-destructive/5',
        phase === 'done' && 'border-phase-done-border bg-phase-done-bg',
        isActive && 'border-phase-active-border bg-phase-active-bg',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {isActive ? (
        <Loader2 className={cn('size-4 animate-spin', config.colour)} aria-hidden="true" />
      ) : (
        <Icon className={cn('size-4', config.colour)} aria-hidden="true" />
      )}

      <span className={cn('font-medium', config.colour)}>
        {phase === 'error' && error ? error : config.label}
      </span>

      {/* Quality score on done */}
      {phase === 'done' && qualityScore !== null && qualityScore !== undefined && (
        <span className="ml-auto text-xs text-muted-foreground">
          Quality: {Math.round(qualityScore * 100)}%
        </span>
      )}

      {/* Cost on done */}
      {phase === 'done' && totalCost !== null && totalCost !== undefined && (
        <span className="text-xs text-muted-foreground">
          Cost: {'\u00A3'}{totalCost.toFixed(4)}
        </span>
      )}

      {/* Cancel button for active phases */}
      {isActive && onCancel && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="ml-auto h-6 px-2"
          type="button"
        >
          <X className="size-3" aria-hidden="true" />
          Cancel
        </Button>
      )}
    </div>
  );
}
