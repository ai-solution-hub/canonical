'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { JobStatus } from '@/types/template';

interface TemplateFillProgressProps {
  jobId: string;
  onComplete: (result: Record<string, unknown>) => void;
  onError: (error: string) => void;
  onRetry?: () => void;
}

const POLL_INTERVAL = 2000;

const PHASE_LABELS: Record<string, string> = {
  pending: 'Preparing document...',
  processing: 'Writing responses into template...',
  completed: 'Saving completed document...',
  failed: 'Fill failed',
};

export function TemplateFillProgress({
  jobId,
  onComplete,
  onError,
  onRetry,
}: TemplateFillProgressProps) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stabilise callback refs so polling interval is not torn down on parent re-renders
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/status`);
      if (!res.ok) throw new Error('Failed to fetch job status');
      const data: JobStatus = await res.json();
      setJob(data);

      if (data.status === 'completed') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        onCompleteRef.current(data.result ?? {});
      } else if (data.status === 'failed') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        const msg = data.error_message ?? 'Template fill failed';
        setError(msg);
        onErrorRef.current(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to check job status';
      setError(msg);
    }
  }, [jobId]);

  useEffect(() => {
    pollStatus();
    intervalRef.current = setInterval(pollStatus, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollStatus]);

  const status = job?.status ?? 'pending';
  const phaseLabel = PHASE_LABELS[status] ?? 'Processing...';

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <AlertTriangle className="size-8 text-muted-foreground/50" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">Template fill didn&apos;t complete</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1 size-3.5" aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-template-confirmed/50 p-6 text-center">
        <CheckCircle className="size-8 text-template-confirmed" aria-hidden="true" />
        <p className="text-sm font-medium">Template filled successfully</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">{phaseLabel}</p>
        <Progress
          className="mt-2 w-48"
          value={undefined}
          aria-label="Fill in progress"
        />
      </div>
    </div>
  );
}
