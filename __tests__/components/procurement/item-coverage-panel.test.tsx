/**
 * ItemCoveragePanel — the Overview-tab coverage roll-up (ID-145 {145.44},
 * BI-40 applied at the roll-up level).
 *
 * Behaviour under test: honest progress reporting (an empty state rather
 * than a mislabelled zero when there are no questions yet), the confidence
 * breakdown (shown only when there is something to show), and that the
 * existing `ReadinessChecklist` is reused wholesale and gated the same way
 * the legacy Overview tab gated it (editors only, once questions exist).
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ItemCoveragePanel } from '@/components/procurement/item-coverage-panel';
import type { ProcurementQuestionStats } from '@/types/procurement';
import type { ReadinessData } from '@/hooks/procurement/use-procurement-readiness';

function makeStats(
  overrides: Partial<ProcurementQuestionStats> = {},
): ProcurementQuestionStats {
  return {
    total_questions: 10,
    strong_match_count: 0,
    partial_match_count: 0,
    needs_sme_count: 0,
    no_content_count: 0,
    unmatched_count: 0,
    drafted_count: 0,
    complete_count: 0,
    ...overrides,
  };
}

function makeReadiness(overrides: Partial<ReadinessData> = {}): ReadinessData {
  return {
    ready: false,
    summary: {
      total_questions: 10,
      answered: 5,
      approved: 3,
      quality_checked: 0,
      passing_quality: 0,
    },
    criteria: [
      { name: 'All questions answered', passed: false, details: '5/10' },
    ],
    issues: [],
    ...overrides,
  };
}

const noop = () => {};

describe('ItemCoveragePanel', () => {
  it('renders the completed/total counts', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={null}
        totalQuestions={10}
        completedCount={3}
        progressPercent={30}
        canEdit={false}
        readiness={null}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(screen.getByTestId('item-coverage-panel')).toHaveTextContent(
      '3 of 10',
    );
  });

  it('shows an honest empty progress state at zero questions, not a mislabelled zero', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={null}
        totalQuestions={0}
        completedCount={0}
        progressPercent={0}
        canEdit={true}
        readiness={null}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(screen.getByText('No questions extracted yet.')).toBeInTheDocument();
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });

  it('hides the confidence breakdown when there is nothing to show', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={makeStats()}
        totalQuestions={10}
        completedCount={0}
        progressPercent={0}
        canEdit={false}
        readiness={null}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(screen.queryByText('Confidence Breakdown')).not.toBeInTheDocument();
  });

  it('renders the confidence breakdown with non-zero posture counts', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={makeStats({
          strong_match_count: 4,
          partial_match_count: 3,
          needs_sme_count: 2,
          no_content_count: 1,
        })}
        totalQuestions={10}
        completedCount={5}
        progressPercent={50}
        canEdit={false}
        readiness={null}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(screen.getByText('Confidence Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Strong Match: 4')).toBeInTheDocument();
    expect(screen.getByText('Partial Match: 3')).toBeInTheDocument();
    expect(screen.getByText('Needs SME: 2')).toBeInTheDocument();
    expect(screen.getByText('No Content: 1')).toBeInTheDocument();
  });

  it('shows the submission readiness checklist for editors once questions exist', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={makeStats()}
        totalQuestions={10}
        completedCount={5}
        progressPercent={50}
        canEdit={true}
        readiness={makeReadiness()}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(screen.getByText('All questions answered')).toBeInTheDocument();
  });

  it('hides the readiness checklist for viewers', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={makeStats()}
        totalQuestions={10}
        completedCount={5}
        progressPercent={50}
        canEdit={false}
        readiness={makeReadiness()}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(
      screen.queryByText('All questions answered'),
    ).not.toBeInTheDocument();
  });

  it('hides the readiness checklist when there are no questions yet', () => {
    render(
      <ItemCoveragePanel
        procurementId="form-1"
        stats={null}
        totalQuestions={0}
        completedCount={0}
        progressPercent={0}
        canEdit={true}
        readiness={makeReadiness()}
        readinessLoading={false}
        readinessError={null}
        onRefreshReadiness={noop}
      />,
    );
    expect(
      screen.queryByText('All questions answered'),
    ).not.toBeInTheDocument();
  });
});
