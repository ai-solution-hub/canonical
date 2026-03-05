'use client';

import { Loader2, Search, PenLine, ShieldCheck, Save, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { StreamPhase } from '@/hooks/use-draft-stream';

const PHASE_CONFIG: Record<
  Exclude<StreamPhase, 'idle'>,
  { label: string; icon: React.ElementType; colour: string }
> = {
  analysing: {
    label: 'Analysing question...',
    icon: Search,
    colour: 'text-blue-600 dark:text-blue-400',
  },
  drafting: {
    label: 'Drafting response...',
    icon: PenLine,
    colour: 'text-violet-600 dark:text-violet-400',
  },
  quality: {
    label: 'Running quality check...',
    icon: ShieldCheck,
    colour: 'text-amber-600 dark:text-amber-400',
  },
  saving: {
    label: 'Saving to database...',
    icon: Save,
    colour: 'text-blue-600 dark:text-blue-400',
  },
  done: {
    label: 'Complete',
    icon: CheckCircle2,
    colour: 'text-emerald-600 dark:text-emerald-400',
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
        phase === 'done' && 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
        isActive && 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950',
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
          Cost: ${totalCost.toFixed(4)}
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
