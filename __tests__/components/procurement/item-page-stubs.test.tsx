/**
 * Smoke tests for the ID-145 {145.42} item-page child-component STUBS.
 *
 * Grouped in one file deliberately: these are minimal placeholders (145W-2
 * establishes the child-component structure; {145.43}/{145.44}/{145.45}/
 * {145.47} fill each in with real, behaviour-tested implementations). Once a
 * stub is filled, its owning subtask moves its coverage into a dedicated
 * `__tests__/components/procurement/<name>.test.tsx` file per the normal
 * mirror-structure convention — until then this file just proves each stub
 * renders without crashing and exposes a stable mount point (`data-testid`)
 * for `page.tsx`'s composition tests to key off.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ItemWorkflowPanel } from '@/components/procurement/item-workflow-panel';
import { ItemInlineStates } from '@/components/procurement/item-inline-states';
import { ItemQuestionsPanel } from '@/components/procurement/item-questions-panel';
import { ItemCoveragePanel } from '@/components/procurement/item-coverage-panel';
import { ItemGroupingRail } from '@/components/procurement/item-grouping-rail';
import { ItemFillSlotReview } from '@/components/procurement/item-fill-slot-review';
import { ItemCitationOverlay } from '@/components/procurement/item-citation-overlay';

describe('item-page child-component stubs', () => {
  it('ItemWorkflowPanel renders the current workflow state', () => {
    render(<ItemWorkflowPanel workflowState="drafting" />);
    const panel = screen.getByTestId('item-workflow-panel');
    expect(panel).toHaveTextContent('drafting');
  });

  it('ItemInlineStates renders a loading indicator for variant="loading"', () => {
    render(<ItemInlineStates variant="loading" />);
    expect(
      screen.getByTestId('item-inline-states-loading'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('ItemInlineStates renders "Procurement not found" + a return link for variant="error"', () => {
    render(<ItemInlineStates variant="error" />);
    expect(screen.getByText('Procurement not found')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Return to Procurement' }),
    ).toHaveAttribute('href', '/procurement');
  });

  it('ItemQuestionsPanel renders the total question count', () => {
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[]}
        canEdit={false}
        totalQuestions={5}
      />,
    );
    expect(screen.getByTestId('item-questions-panel')).toHaveTextContent('5');
  });

  it('ItemCoveragePanel renders the completed/total counts', () => {
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
        onRefreshReadiness={() => {}}
      />,
    );
    expect(screen.getByTestId('item-coverage-panel')).toHaveTextContent(
      '3 of 10',
    );
  });

  it('ItemGroupingRail renders the sibling count', () => {
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[
          {
            id: 'form-2',
            name: 'ITT',
            form_type: 'itt',
            workflow_state: 'drafting',
            reference_number: null,
          },
        ]}
      />,
    );
    expect(screen.getByTestId('item-grouping-rail')).toHaveTextContent(
      '1 related form',
    );
  });

  it('ItemFillSlotReview renders its mount point', () => {
    render(<ItemFillSlotReview formId="form-1" />);
    expect(screen.getByTestId('item-fill-slot-review')).toBeInTheDocument();
  });

  it('ItemCitationOverlay renders its mount point', () => {
    render(<ItemCitationOverlay formId="form-1" />);
    expect(screen.getByTestId('item-citation-overlay')).toBeInTheDocument();
  });
});
