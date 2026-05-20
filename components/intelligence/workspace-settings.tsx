'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  useIntelligenceWorkspace,
  useUpdateIntelligenceWorkspace,
} from '@/hooks/intelligence/use-intelligence-workspaces';
import { useUserRole } from '@/hooks/use-user-role';
import { Sliders } from 'lucide-react';

/**
 * SI-L5: Workspace settings — relevance threshold slider.
 *
 * Lets admins set the workspace-level relevance score cutoff used by the
 * intelligence pipeline (`lib/intelligence/pipeline.ts`).
 *
 * - Range: 0.10–1.00 in 0.05 increments
 * - Default: 0.50 (DEFAULT_RELEVANCE_THRESHOLD in lib/intelligence/types.ts)
 * - Admin-only: write-path enforced server-side; UI hides for non-admin
 *
 * Read path: typed top-level `workspace.relevance_threshold` projected by
 * the 5 `/api/intelligence/*` routes via `extractContextFromDomainMetadata`.
 * Pre-T2 (S245 WP2a): projection reads `domain_metadata.relevance_threshold`
 * JSONB. Post-T2 (S246 WP2b): projection reads
 * `intelligence_workspaces.relevance_threshold` typed column. UI is
 * unaffected across the migration.
 */
const SLIDER_MIN = 0.1;
const SLIDER_MAX = 1.0;
const SLIDER_STEP = 0.05;
const SLIDER_DEFAULT = 0.5;

interface WorkspaceSettingsProps {
  workspaceId: string;
}

export function WorkspaceSettings({ workspaceId }: WorkspaceSettingsProps) {
  const { data: workspace, isLoading } = useIntelligenceWorkspace(workspaceId);
  const updateMutation = useUpdateIntelligenceWorkspace(workspaceId);
  const { canAdmin, loading: roleLoading } = useUserRole();

  const persistedThreshold = workspace?.relevance_threshold ?? SLIDER_DEFAULT;

  const [thresholdValue, setThresholdValue] = useState<number>(SLIDER_DEFAULT);

  // Sync slider state when workspace data loads or changes externally.
  useEffect(() => {
    setThresholdValue(persistedThreshold);
  }, [persistedThreshold]);

  if (isLoading || roleLoading) {
    return (
      <div
        role="status"
        aria-label="Loading workspace settings"
        className="rounded-lg border bg-card p-6 shadow-sm"
      >
        <span className="sr-only">Loading...</span>
        <div className="space-y-3">
          <div className="h-5 w-48 animate-pulse rounded bg-accent" />
          <div className="h-2 w-full animate-pulse rounded bg-accent" />
          <div className="h-3 w-64 animate-pulse rounded bg-accent" />
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">Workspace not found.</p>
      </div>
    );
  }

  const isDirty = thresholdValue !== persistedThreshold;
  const isSaving = updateMutation.isPending;
  const formattedValue = thresholdValue.toFixed(2);
  const formattedPercent = `${Math.round(thresholdValue * 100)}%`;

  const handleSave = () => {
    updateMutation.mutate({ relevance_threshold: thresholdValue });
  };

  const handleReset = () => {
    setThresholdValue(persistedThreshold);
  };

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="threshold-section-title"
        className="rounded-lg border bg-card p-6 shadow-sm"
      >
        <div className="mb-4 flex items-start gap-3">
          <Sliders
            className="mt-0.5 size-5 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="flex-1">
            <h2
              id="threshold-section-title"
              className="text-base font-semibold text-foreground"
            >
              Relevance
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the relevance cutoff for articles in this workspace. Lower
              lets through more articles; higher keeps only the strongest
              matches.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label
              htmlFor="relevance-threshold"
              className="text-sm font-medium text-foreground"
            >
              Relevance Threshold (default 0.50)
            </Label>
            <span
              className="font-mono text-sm font-semibold tabular-nums text-foreground"
              aria-live="polite"
            >
              {formattedValue}
              <span className="ml-2 text-xs text-muted-foreground">
                ({formattedPercent})
              </span>
            </span>
          </div>

          <input
            id="relevance-threshold"
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={SLIDER_STEP}
            value={thresholdValue}
            onChange={(e) => setThresholdValue(parseFloat(e.target.value))}
            disabled={!canAdmin || isSaving}
            aria-valuemin={SLIDER_MIN}
            aria-valuemax={SLIDER_MAX}
            aria-valuenow={thresholdValue}
            aria-valuetext={`${formattedPercent} relevance threshold`}
            aria-describedby="relevance-threshold-help"
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-accent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0.10 (lenient)</span>
            <span>0.50 (default)</span>
            <span>1.00 (strict)</span>
          </div>

          <p
            id="relevance-threshold-help"
            className="text-xs text-muted-foreground"
          >
            Articles scoring below this threshold are filtered out. Lower = more
            articles, higher = stricter.
          </p>
        </div>

        {!canAdmin && (
          <p
            className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
            role="note"
          >
            Only admins can change the relevance threshold.
          </p>
        )}

        {canAdmin && (
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={!isDirty || isSaving}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save threshold'}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
