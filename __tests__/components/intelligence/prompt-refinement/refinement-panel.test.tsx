/**
 * RefinementPanel — container tests.
 *
 * Verifies all six reachable states (no flags, flags pending, analysing,
 * analysis ready, preview ready, applying) and the dependency-injection
 * contract (mutations passed as props, not imported).
 *
 * Uses `mockMutation()` from the shared fixtures helper to stand in for
 * the real `UseMutationResult` shapes — no QueryClientProvider is needed
 * because the panel only reads mutation fields.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { RefinementPanel } from '@/components/intelligence/prompt-refinement/refinement-panel';
import type {
  AnalyseFlagsResponse,
  RescoringPreviewResponse,
  ResolveFlagsResponse,
  AnalyseFlagsRequest,
  RescoringPreviewRequest,
  ResolveFlagsRequest,
} from '@/types/intelligence-refinement';
import type { UseMutationResult } from '@tanstack/react-query';
import {
  makeFlagAnalysisResult,
  makeRescoringPreviewResponse,
  makeWorkspaceFlag,
  mockMutation,
} from './fixtures';

type AnalyseMutation = UseMutationResult<
  AnalyseFlagsResponse,
  Error,
  AnalyseFlagsRequest
>;
type PreviewMutation = UseMutationResult<
  RescoringPreviewResponse,
  Error,
  RescoringPreviewRequest
>;
type ResolveMutation = UseMutationResult<
  ResolveFlagsResponse,
  Error,
  ResolveFlagsRequest
>;

interface RenderOverrides {
  flags?: ReturnType<typeof makeWorkspaceFlag>[] | undefined;
  flagsLoading?: boolean;
  analyse?: Partial<AnalyseMutation>;
  preview?: Partial<PreviewMutation>;
  resolve?: Partial<ResolveMutation>;
  onApplyVersion?: (
    promptText: string,
    changeNotes: string,
  ) => Promise<{ id: string } | null>;
}

function renderPanel(overrides: RenderOverrides = {}) {
  const analyse = mockMutation<AnalyseFlagsResponse, Error, AnalyseFlagsRequest>(
    overrides.analyse ?? {},
  );
  const preview = mockMutation<
    RescoringPreviewResponse,
    Error,
    RescoringPreviewRequest
  >(overrides.preview ?? {});
  const resolve = mockMutation<
    ResolveFlagsResponse,
    Error,
    ResolveFlagsRequest
  >(overrides.resolve ?? {});
  const onApplyVersion =
    overrides.onApplyVersion ??
    vi.fn().mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440099' });

  render(
    <RefinementPanel
      workspaceId="550e8400-e29b-41d4-a716-446655440050"
      flags={overrides.flags}
      flagsLoading={overrides.flagsLoading ?? false}
      activePromptText={'Active prompt text'}
      activePromptVersionId={'550e8400-e29b-41d4-a716-446655440051'}
      analyseFlagsMutation={analyse}
      rescoringPreviewMutation={preview}
      resolveFlagsMutation={resolve}
      onApplyVersion={onApplyVersion}
    />,
  );
  return { analyse, preview, resolve, onApplyVersion };
}

describe('RefinementPanel', () => {
  // -------------------------------------------------------------------------
  // State 1 — no flags
  // -------------------------------------------------------------------------
  it('renders the no-flags empty state when the flag list is empty', () => {
    renderPanel({ flags: [] });
    expect(
      screen.getByText(/No unresolved flags\. The scoring prompt is performing well/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Analyse flags/i }),
    ).not.toBeInTheDocument();
  });

  it('treats undefined flag list as empty', () => {
    renderPanel({ flags: undefined });
    expect(
      screen.getByText(/No unresolved flags/i),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // State 2 — flags pending
  // -------------------------------------------------------------------------
  it('renders the flag count and summary when unresolved flags exist', () => {
    const flags = [
      makeWorkspaceFlag({
        id: '550e8400-e29b-41d4-a716-446655440060',
        flag_type: 'false_positive',
      }),
      makeWorkspaceFlag({
        id: '550e8400-e29b-41d4-a716-446655440061',
        flag_type: 'false_positive',
      }),
      makeWorkspaceFlag({
        id: '550e8400-e29b-41d4-a716-446655440062',
        flag_type: 'false_negative',
      }),
    ];
    renderPanel({ flags });
    expect(
      screen.getByText(
        /3 unresolved flags \(2 false positives, 1 false negative\)/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Analyse unresolved flags/i }),
    ).toBeInTheDocument();
  });

  it('uses singular grammar for a single flag', () => {
    const flags = [
      makeWorkspaceFlag({
        id: '550e8400-e29b-41d4-a716-446655440063',
        flag_type: 'false_positive',
      }),
    ];
    renderPanel({ flags });
    expect(
      screen.getByText(
        /1 unresolved flag \(1 false positive, 0 false negatives\)/,
      ),
    ).toBeInTheDocument();
  });

  it('fires the analyse mutation with a resolved=false filter on click', async () => {
    const user = userEvent.setup();
    const flags = [makeWorkspaceFlag()];
    const { analyse } = renderPanel({ flags });
    await user.click(
      screen.getByRole('button', { name: /Analyse unresolved flags/i }),
    );
    expect(analyse.mutate).toHaveBeenCalledWith({
      filter: { resolved: false },
    });
  });

  // -------------------------------------------------------------------------
  // State 3 — analysing
  // -------------------------------------------------------------------------
  it('renders the analysing skeleton when the analyse mutation is pending', () => {
    const flags = [makeWorkspaceFlag()];
    renderPanel({
      flags,
      analyse: { isPending: true, isIdle: false, status: 'pending' },
    });
    expect(screen.getByTestId('analysing-skeleton')).toBeInTheDocument();
    expect(
      screen.getByText(/Analysing flagged articles…/i),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // State 4 — analysis ready
  // -------------------------------------------------------------------------
  it('renders the FlagAnalysisView and action buttons when analysis data is present', () => {
    const flags = [makeWorkspaceFlag()];
    const analysisData = makeFlagAnalysisResult();
    renderPanel({
      flags,
      analyse: {
        data: analysisData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
    });
    expect(screen.getByTestId('flag-analysis-view')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Apply proposed changes/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Preview the impact/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Dismiss the analysis/i }),
    ).toBeInTheDocument();
  });

  it('calls the preview mutation with the proposed prompt text on Preview Impact click', async () => {
    const user = userEvent.setup();
    const analysisData = makeFlagAnalysisResult();
    const flags = [makeWorkspaceFlag()];
    const { preview } = renderPanel({
      flags,
      analyse: {
        data: analysisData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
    });
    await user.click(
      screen.getByRole('button', { name: /Preview the impact/i }),
    );
    expect(preview.mutate).toHaveBeenCalledWith({
      prompt_text: analysisData.proposedPromptText,
    });
  });

  it('resets both mutations on Dismiss', async () => {
    const user = userEvent.setup();
    const analysisData = makeFlagAnalysisResult();
    const flags = [makeWorkspaceFlag()];
    const { analyse, preview } = renderPanel({
      flags,
      analyse: {
        data: analysisData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
    });
    await user.click(
      screen.getByRole('button', { name: /Dismiss the analysis/i }),
    );
    expect(analyse.reset).toHaveBeenCalled();
    expect(preview.reset).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // State 5 — preview ready
  // -------------------------------------------------------------------------
  it('renders the RescoringPreview when both analysis and preview data are present', () => {
    const flags = [makeWorkspaceFlag()];
    const analysisData = makeFlagAnalysisResult();
    const previewData = makeRescoringPreviewResponse();
    renderPanel({
      flags,
      analyse: {
        data: analysisData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
      preview: {
        data: previewData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
    });
    expect(screen.getByTestId('flag-analysis-view')).toBeInTheDocument();
    expect(screen.getByTestId('rescoring-preview')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // State 6 — applying (atomic create version + resolve)
  // -------------------------------------------------------------------------
  it('calls onApplyVersion then resolveFlagsMutation with the new version id on Apply', async () => {
    const user = userEvent.setup();
    const flags = [
      makeWorkspaceFlag({ id: '550e8400-e29b-41d4-a716-446655440070' }),
      makeWorkspaceFlag({ id: '550e8400-e29b-41d4-a716-446655440071' }),
    ];
    const analysisData = makeFlagAnalysisResult();
    const onApplyVersion = vi
      .fn()
      .mockResolvedValue({ id: '550e8400-e29b-41d4-a716-446655440099' });
    const { resolve } = renderPanel({
      flags,
      onApplyVersion,
      analyse: {
        data: analysisData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
    });

    await user.click(
      screen.getByRole('button', { name: /Apply proposed changes/i }),
    );

    await waitFor(() => {
      expect(onApplyVersion).toHaveBeenCalledWith(
        analysisData.proposedPromptText,
        expect.stringMatching(/Refinement from 5 flags/),
      );
    });
    await waitFor(() => {
      expect(resolve.mutate).toHaveBeenCalledWith(
        {
          flag_ids: [
            '550e8400-e29b-41d4-a716-446655440070',
            '550e8400-e29b-41d4-a716-446655440071',
          ],
          resolution_type: 'addressed',
          prompt_version_id: '550e8400-e29b-41d4-a716-446655440099',
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });
  });

  it('does not call resolveFlagsMutation when onApplyVersion returns null', async () => {
    const user = userEvent.setup();
    const flags = [makeWorkspaceFlag()];
    const analysisData = makeFlagAnalysisResult();
    const onApplyVersion = vi.fn().mockResolvedValue(null);
    const { resolve } = renderPanel({
      flags,
      onApplyVersion,
      analyse: {
        data: analysisData,
        isIdle: false,
        isSuccess: true,
        status: 'success',
      },
    });

    await user.click(
      screen.getByRole('button', { name: /Apply proposed changes/i }),
    );

    await waitFor(() => {
      expect(onApplyVersion).toHaveBeenCalled();
    });
    expect(resolve.mutate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Error states
  // -------------------------------------------------------------------------
  it('renders an alert when the analyse mutation is in an error state', () => {
    const flags = [makeWorkspaceFlag()];
    renderPanel({
      flags,
      analyse: {
        isError: true,
        isIdle: false,
        error: new Error('boom'),
        status: 'error',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Analysis failed/i);
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  it('renders a skeleton when flagsLoading is true', () => {
    const { container } = render(
      <RefinementPanel
        workspaceId="550e8400-e29b-41d4-a716-446655440050"
        flags={undefined}
        flagsLoading={true}
        activePromptText={null}
        activePromptVersionId={null}
        analyseFlagsMutation={mockMutation()}
        rescoringPreviewMutation={mockMutation()}
        resolveFlagsMutation={mockMutation()}
        onApplyVersion={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[aria-label="Prompt refinement"]'),
    ).toBeInTheDocument();
    // Three Skeleton elements are rendered while loading.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(2);
  });
});
