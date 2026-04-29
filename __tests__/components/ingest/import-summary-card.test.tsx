/**
 * ImportSummaryCard Component Tests
 *
 * Tests the EP2 §1.11 Phase 2 post-flight summary card — count tiles,
 * per-category row rendering, retry callback, and Done / Import-another
 * button callbacks.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §4.5 + §6.4
 * Plan:  docs/plans/§1.11-ep2-build-plan.md row EP2-T6
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ImportSummaryCard } from '@/components/ingest/import-summary-card';
import type { MarkdownBatchResultsSummary } from '@/types/ingest';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeSummary(
  overrides: Partial<MarkdownBatchResultsSummary> = {},
): MarkdownBatchResultsSummary {
  return {
    files_processed: 0,
    stored: [],
    dedup_flagged: [],
    superseded: [],
    skipped_excluded: [],
    errored: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportSummaryCard', () => {
  it('renders count tiles for every category', () => {
    const summary = makeSummary({
      files_processed: 5,
      stored: [
        { id: '00000000-0000-4000-8000-000000000001', title: 'A', filename: 'a.md' },
      ],
      dedup_flagged: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          title: 'B',
          filename: 'b.md',
          suspected_duplicate_of: '00000000-0000-4000-8000-000000000099',
        },
      ],
      superseded: [
        {
          new_id: '00000000-0000-4000-8000-000000000003',
          old_id: '00000000-0000-4000-8000-000000000098',
          filename: 'c.md',
        },
      ],
      skipped_excluded: ['d.md'],
      errored: [{ filename: 'e.md', error: 'Classification failed' }],
    });

    render(
      <ImportSummaryCard
        pipelineRunId="00000000-0000-4000-8000-000000000aaa"
        resultsSummary={summary}
      />,
    );

    expect(screen.getByTestId('summary-tile-files-processed')).toHaveTextContent(
      '5',
    );
    expect(screen.getByTestId('summary-tile-stored')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-tile-dedup')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-tile-superseded')).toHaveTextContent(
      '1',
    );
    expect(screen.getByTestId('summary-tile-skipped')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-tile-errors')).toHaveTextContent('1');
  });

  it('renders per-category rows with correct links', () => {
    const summary = makeSummary({
      files_processed: 4,
      stored: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Foo',
          filename: 'foo-final.md',
        },
      ],
      dedup_flagged: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Foo',
          filename: 'foo-draft.md',
          suspected_duplicate_of: '11111111-1111-4111-8111-111111111111',
        },
      ],
      superseded: [
        {
          new_id: '33333333-3333-4333-8333-333333333333',
          old_id: '44444444-4444-4444-8444-444444444444',
          filename: 'baz.md',
        },
      ],
      errored: [{ filename: 'bar.md', error: 'Classification failed' }],
      skipped_excluded: ['skipped.md'],
    });

    render(
      <ImportSummaryCard
        pipelineRunId="run-id-xyz"
        resultsSummary={summary}
      />,
    );

    // Stored row: Open item link
    const storedRow = screen.getByTestId('summary-row-stored-foo-final.md');
    expect(storedRow).toBeInTheDocument();
    const openLink = storedRow.querySelector('a');
    expect(openLink?.getAttribute('href')).toBe(
      '/item/11111111-1111-4111-8111-111111111111',
    );

    // Dedup row: Resolve in dedup queue link
    const dedupRow = screen.getByTestId('summary-row-dedup-foo-draft.md');
    expect(dedupRow).toBeInTheDocument();
    expect(dedupRow.textContent).toMatch(/SUSPECTED-DUPLICATE/);
    const dedupLink = dedupRow.querySelector('a[href="/review/dedup"]');
    expect(dedupLink).not.toBeNull();

    // Superseded row
    const supRow = screen.getByTestId('summary-row-superseded-baz.md');
    expect(supRow.textContent).toMatch(/Auto-superseded/);

    // Skipped row
    const skipRow = screen.getByTestId('summary-row-skipped-skipped.md');
    expect(skipRow.textContent).toMatch(/Skipped/);

    // Error row
    const errorRow = screen.getByTestId('summary-row-error-bar.md');
    expect(errorRow.textContent).toMatch(/ERROR: Classification failed/);
  });

  it('shows Retry button only when onRetry is supplied', () => {
    const summary = makeSummary({
      files_processed: 1,
      errored: [{ filename: 'bad.md', error: 'Network error' }],
    });

    const { rerender } = render(
      <ImportSummaryCard
        pipelineRunId="run-1"
        resultsSummary={summary}
      />,
    );

    expect(screen.queryByRole('button', { name: /Retry bad\.md/i })).toBeNull();

    const onRetry = vi.fn();
    rerender(
      <ImportSummaryCard
        pipelineRunId="run-1"
        resultsSummary={summary}
        onRetry={onRetry}
      />,
    );

    const retryBtn = screen.getByRole('button', { name: /Retry bad\.md/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith('bad.md');
  });

  it('fires onImportAnother and onDone callbacks', () => {
    const onImportAnother = vi.fn();
    const onDone = vi.fn();

    render(
      <ImportSummaryCard
        pipelineRunId="run-x"
        resultsSummary={makeSummary({ files_processed: 1 })}
        onImportAnother={onImportAnother}
        onDone={onDone}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Import another batch/i }),
    );
    expect(onImportAnother).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders pipeline run ID link', () => {
    render(
      <ImportSummaryCard
        pipelineRunId="run-abc-123"
        resultsSummary={makeSummary({ files_processed: 0 })}
      />,
    );

    const link = screen.getByTestId('summary-pipeline-run-link');
    expect(link).toHaveTextContent('run-abc-123');
    expect(link.getAttribute('href')).toBe('/provenance');
  });

  it('renders empty-state message when nothing was processed', () => {
    render(
      <ImportSummaryCard
        pipelineRunId="run-y"
        resultsSummary={makeSummary({ files_processed: 0 })}
      />,
    );

    expect(screen.getByText(/No files were processed/)).toBeInTheDocument();
  });
});
