'use client';

import { useCallback, useMemo, useState } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FlagAnalysisView } from '@/components/intelligence/prompt-refinement/flag-analysis-view';
import { RescoringPreview } from '@/components/intelligence/prompt-refinement/rescoring-preview';
import type {
  AnalyseFlagsRequest,
  AnalyseFlagsResponse,
  RescoringPreviewRequest,
  RescoringPreviewResponse,
  ResolveFlagsRequest,
  ResolveFlagsResponse,
} from '@/types/intelligence-refinement';
import type { WorkspaceFlag } from '@/hooks/intelligence/use-workspace-flags';

/**
 * RefinementPanel — stateful container for the guided SI prompt
 * refinement flow. Uses dependency injection for all three mutations
 * and the "apply new version" callback so it is decoupled from the
 * TanStack Query hooks: the page file (wired post-merge) passes the
 * real hooks in, but the tests can pass fakes.
 *
 * Six reachable states (see spec §Task 8):
 *   1. No flags            — empty copy only
 *   2. Flags pending       — flag summary + "Analyse flags" button
 *   3. Analysing           — skeleton while analyse mutation is pending
 *   4. Analysis ready      — FlagAnalysisView + action buttons
 *   5. Preview ready       — + RescoringPreview
 *   6. Applying            — buttons disabled while version + resolve run
 *
 * "Apply changes" runs atomically against the parent: first
 * `onApplyVersion(...)` (the parent creates a new prompt version),
 * then `resolveFlagsMutation.mutate(...)` to mark the analysed flags
 * as addressed. On failure at either step, the mutations' own error
 * toasts surface and the user lands back in state 4.
 */

// Module-level stable empty array — see CLAUDE.md "Stable empty array
// defaults" rule. Inlining `?? []` in useMemo inputs creates a new
// reference every render and cascades into broken downstream deps.
const EMPTY_FLAGS: readonly WorkspaceFlag[] = Object.freeze([]);

interface RefinementPanelProps {
  workspaceId: string;
  flags: WorkspaceFlag[] | undefined;
  flagsLoading: boolean;
  activePromptText: string | null;
  activePromptVersionId: string | null;
  analyseFlagsMutation: UseMutationResult<
    AnalyseFlagsResponse,
    Error,
    AnalyseFlagsRequest
  >;
  rescoringPreviewMutation: UseMutationResult<
    RescoringPreviewResponse,
    Error,
    RescoringPreviewRequest
  >;
  resolveFlagsMutation: UseMutationResult<
    ResolveFlagsResponse,
    Error,
    ResolveFlagsRequest
  >;
  /** Creates a new prompt version with the proposed text. Parent is
   *  responsible for calling `useCreatePromptVersion` (or equivalent)
   *  and returning the new version row or `null` on failure. */
  onApplyVersion: (
    promptText: string,
    changeNotes: string,
  ) => Promise<{ id: string } | null>;
}

export function RefinementPanel({
  flags,
  flagsLoading,
  activePromptText,
  analyseFlagsMutation,
  rescoringPreviewMutation,
  resolveFlagsMutation,
  onApplyVersion,
}: RefinementPanelProps) {
  const [isApplying, setIsApplying] = useState(false);

  // ---------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------
  const safeFlags = useMemo(() => flags ?? EMPTY_FLAGS, [flags]);

  const unresolvedFlags = useMemo(
    () => safeFlags.filter((flag) => !flag.resolved),
    [safeFlags],
  );

  const { falsePositiveCount, falseNegativeCount } = useMemo(() => {
    let fp = 0;
    let fn = 0;
    for (const flag of unresolvedFlags) {
      if (flag.flag_type === 'false_positive') fp++;
      else if (flag.flag_type === 'false_negative') fn++;
    }
    return { falsePositiveCount: fp, falseNegativeCount: fn };
  }, [unresolvedFlags]);

  // Destructure mutation fields up-front so React Compiler memo deps
  // stay stable (see CLAUDE.md "React compiler memoisation" rule).
  const { data: analysisData, isPending: isAnalysing } = analyseFlagsMutation;
  const { data: previewData } = rescoringPreviewMutation;
  const { reset: resetAnalyse } = analyseFlagsMutation;
  const { reset: resetPreview } = rescoringPreviewMutation;
  const { mutate: analyseMutate } = analyseFlagsMutation;
  const { mutate: previewMutate } = rescoringPreviewMutation;
  const { mutate: resolveMutate } = resolveFlagsMutation;

  // Catastrophic-change detection — hoisted from RescoringPreview so the
  // warning also renders in state 4 (analysis ready, no preview yet),
  // not just state 5. The user can click "Apply changes" from state 4
  // without ever previewing, so the safety guard must fire here too.
  // In state 5, RescoringPreview renders its own copy of this warning.
  // Destructure nested property for React Compiler memo stability
  // (see CLAUDE.md "React compiler memoisation" rule).
  const proposedPromptText = analysisData?.proposedPromptText ?? null;
  const catastrophicChange = useMemo(() => {
    if (!activePromptText || !proposedPromptText) return null;
    const currentLength = activePromptText.length;
    const proposedLength = proposedPromptText.length;
    if (currentLength === 0) return null;
    if (proposedLength >= currentLength * 0.5) return null;
    return { currentLength, proposedLength };
  }, [activePromptText, proposedPromptText]);

  // ---------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------
  const handleAnalyse = useCallback(() => {
    analyseMutate({
      filter: { resolved: false },
    });
  }, [analyseMutate]);

  const handlePreview = useCallback(() => {
    if (!analysisData?.proposedPromptText) return;
    previewMutate({
      prompt_text: analysisData.proposedPromptText,
    });
  }, [analysisData, previewMutate]);

  const handleDismiss = useCallback(() => {
    resetAnalyse();
    resetPreview();
  }, [resetAnalyse, resetPreview]);

  const handleApply = useCallback(async () => {
    if (!analysisData) return;
    setIsApplying(true);
    try {
      const flagIds = unresolvedFlags.map((flag) => flag.id);
      const changeNotes = `Refinement from ${analysisData.analysedFlagCount} ${
        analysisData.analysedFlagCount === 1 ? 'flag' : 'flags'
      }`;

      const newVersion = await onApplyVersion(
        analysisData.proposedPromptText,
        changeNotes,
      );
      if (!newVersion) {
        // Parent toast already surfaced the failure — return to state 4.
        setIsApplying(false);
        return;
      }

      resolveMutate(
        {
          flag_ids: flagIds,
          resolution_type: 'addressed',
          prompt_version_id: newVersion.id,
        },
        {
          onSuccess: () => {
            // Reset analysis + preview so we land back in state 2.
            resetAnalyse();
            resetPreview();
            setIsApplying(false);
          },
          onError: () => {
            // Resolve failed — user lands in state 4 (analysis still
            // visible so they can retry). Resolve mutation's own
            // error toast will fire.
            setIsApplying(false);
          },
        },
      );
    } catch {
      setIsApplying(false);
    }
  }, [
    analysisData,
    unresolvedFlags,
    onApplyVersion,
    resolveMutate,
    resetAnalyse,
    resetPreview,
  ]);

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  if (flagsLoading) {
    return (
      <section
        aria-label="Refine filter rules"
        className="rounded-lg border bg-card p-6"
      >
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
      </section>
    );
  }

  // State 1 — no unresolved flags
  if (unresolvedFlags.length === 0) {
    return (
      <section
        aria-label="Refine filter rules"
        className="rounded-lg border bg-card p-6"
      >
        <header className="mb-3">
          <h2 className="text-base font-semibold text-foreground">
            Refine filter rules
          </h2>
        </header>
        <p className="text-sm text-muted-foreground">
          No unresolved flags. Filter rules are performing well. Flag articles
          as false positives or false negatives from the Articles tab to start
          collecting feedback.
        </p>
      </section>
    );
  }

  const unresolvedCount = unresolvedFlags.length;
  const flagNoun =
    unresolvedCount === 1 ? 'unresolved flag' : 'unresolved flags';
  const fpNoun =
    falsePositiveCount === 1 ? 'false positive' : 'false positives';
  const fnNoun =
    falseNegativeCount === 1 ? 'false negative' : 'false negatives';

  const hasAnalysis = Boolean(analysisData);
  const hasPreview = Boolean(previewData);
  const analyseError = analyseFlagsMutation.isError;
  const previewError = rescoringPreviewMutation.isError;

  return (
    <section
      aria-label="Refine filter rules"
      className="space-y-4 rounded-lg border bg-card p-6"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          Refine filter rules
        </h2>
        <p className="text-sm text-muted-foreground">
          {unresolvedCount} {flagNoun} ({falsePositiveCount} {fpNoun},{' '}
          {falseNegativeCount} {fnNoun})
        </p>
      </header>

      {!hasAnalysis && !isAnalysing && unresolvedCount < 3 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="minimum-flag-warning"
          className="flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <p>
            Only {unresolvedCount} {unresolvedCount === 1 ? 'flag' : 'flags'}{' '}
            available. For reliable analysis, we recommend accumulating at least
            3 flags before running an analysis. You can still proceed, but the
            recommendations may not generalise well.
          </p>
        </div>
      )}

      {!hasAnalysis && !isAnalysing && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="default"
            onClick={handleAnalyse}
            disabled={unresolvedCount === 0 || isAnalysing}
            aria-label="Analyse unresolved flags"
          >
            Analyse flags
          </Button>
        </div>
      )}

      {/* State 3 — analysing */}
      {isAnalysing && (
        <div
          role="status"
          aria-live="polite"
          className="space-y-3"
          data-testid="analysing-skeleton"
        >
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Analysing flagged articles…
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {analyseError && !isAnalysing && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Analysis failed. Please try again — if the problem persists, check
            the admin logs.
          </p>
        </div>
      )}

      {/* State 4 — analysis ready */}
      {hasAnalysis && analysisData && (
        <FlagAnalysisView result={analysisData} />
      )}

      {/* Catastrophic-change warning — renders in state 4 (before preview).
          In state 5, RescoringPreview renders its own instance of this
          warning, so we suppress it here when the preview is visible to
          avoid duplication. */}
      {hasAnalysis && !hasPreview && catastrophicChange && (
        <div
          role="status"
          data-testid="catastrophic-change-warning-state4"
          className="flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-status-warning"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <p>
            The proposed prompt is significantly shorter than the current
            version ({catastrophicChange.proposedLength} characters vs{' '}
            {catastrophicChange.currentLength} characters). This may remove
            important scoring criteria. Review the changes carefully before
            applying.
          </p>
        </div>
      )}

      {/* State 5 — preview ready (layered on top of state 4) */}
      {hasAnalysis && hasPreview && previewData && (
        <RescoringPreview
          result={previewData}
          currentPromptText={activePromptText}
          proposedPromptText={analysisData?.proposedPromptText ?? null}
        />
      )}

      {previewError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Preview failed. The analysis is still available — you can apply it
            without previewing, or try the preview again.
          </p>
        </div>
      )}

      {/* States 4 + 5 action buttons — including state 6 (applying) */}
      {hasAnalysis && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            type="button"
            variant="default"
            onClick={handleApply}
            disabled={isApplying || resolveFlagsMutation.isPending}
            aria-label="Apply proposed changes as a new prompt version"
          >
            {isApplying || resolveFlagsMutation.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Applying…
              </>
            ) : (
              'Apply changes'
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            disabled={
              isApplying ||
              rescoringPreviewMutation.isPending ||
              !analysisData?.proposedPromptText
            }
            aria-label="Preview the impact of the proposed changes"
          >
            {rescoringPreviewMutation.isPending
              ? 'Previewing…'
              : 'Preview impact'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleDismiss}
            disabled={isApplying || resolveFlagsMutation.isPending}
            aria-label="Dismiss the analysis without applying changes"
          >
            Dismiss
          </Button>
        </div>
      )}
    </section>
  );
}
