'use client';

import { useCallback, useId, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface PipelineRunDetail {
  id: string;
  pipeline_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  items_processed: number | null;
  items_created: string[] | null;
  source_filename: string | null;
  workspace_id: string | null;
  created_by: string | null;
  result: unknown;
  progress: unknown;
  cost: number | null;
}

export interface PipelineFailureDrawerProps {
  run: PipelineRunDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export default function PipelineFailureDrawer({
  run,
  open,
  onOpenChange,
}: PipelineFailureDrawerProps) {
  const titleId = useId();

  const handleCopyJson = useCallback(() => {
    if (!run) return;
    void navigator.clipboard.writeText(JSON.stringify(run, null, 2));
  }, [run]);

  if (!run) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px]"
        aria-labelledby={titleId}
      >
        <SheetHeader>
          <SheetTitle id={titleId}>
            {run.pipeline_name.replace(/_/g, ' ')}
          </SheetTitle>
          <SheetDescription>
            Run {run.id.slice(0, 8)} &middot;{' '}
            <StatusBadge status={run.status} />
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Timestamps */}
          <Section label="Started">
            {formatTimestamp(run.started_at)}
          </Section>
          {run.completed_at && (
            <Section label="Completed">
              {formatTimestamp(run.completed_at)}
            </Section>
          )}

          {/* Error message */}
          {run.error_message && (
            <Section label="Error">
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-destructive">
                {run.error_message}
              </pre>
            </Section>
          )}

          {/* Metadata */}
          {run.items_processed !== null && (
            <Section label="Items processed">
              {run.items_processed}
            </Section>
          )}
          {run.items_created && run.items_created.length > 0 && (
            <Section label="Items created">
              {run.items_created.length}
            </Section>
          )}
          {run.source_filename && (
            <Section label="Source file">{run.source_filename}</Section>
          )}
          {run.workspace_id && (
            <Section label="Workspace ID">
              <code className="text-xs">{run.workspace_id}</code>
            </Section>
          )}
          {run.created_by && (
            <Section label="Created by">
              <code className="text-xs">{run.created_by}</code>
            </Section>
          )}
          {run.cost !== null && (
            <Section label="Cost">
              ${run.cost.toFixed(4)}
            </Section>
          )}

          {/* Collapsible result JSON */}
          {run.result ? (
            <CollapsibleJson label="Result" data={run.result} />
          ) : null}
          {run.progress ? (
            <CollapsibleJson label="Progress" data={run.progress} />
          ) : null}

          {/* Copy button */}
          <div className="mt-4">
            <button
              type="button"
              onClick={handleCopyJson}
              className="rounded-md border bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              Copy as JSON
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ──────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    failed: 'bg-destructive/10 text-destructive',
    completed_with_errors: 'bg-warning/10 text-warning',
    running: 'bg-primary/10 text-primary',
    completed: 'bg-accent text-accent-foreground',
  };
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
        colours[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function CollapsibleJson({
  label,
  data,
}: {
  label: string;
  data: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
      >
        {expanded ? '\u25BC' : '\u25B6'} {label}
      </button>
      {expanded && (
        <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}
