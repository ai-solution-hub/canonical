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
 *
 * {145.43} filled `ItemWorkflowPanel` + `ItemInlineStates` — their coverage
 * moved to `item-workflow-panel.test.tsx` + `item-inline-states.test.tsx`.
 * {145.47} filled `ItemFillSlotReview`/`ItemCitationOverlay` — their
 * coverage moved to
 * `__tests__/components/procurement/item-fill-slot-review.test.tsx` and
 * `__tests__/components/procurement/item-citation-overlay.test.tsx` per the
 * convention above; the two smoke cases (and their imports) are removed
 * here.
 *
 * All four fill subtasks have now landed — the two remaining smokes below
 * duplicate `item-questions-panel.test.tsx` / `item-coverage-panel.test.tsx`
 * coverage and are queued for removal in the {145.23} close-gate sweep.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ItemQuestionsPanel } from '@/components/procurement/item-questions-panel';
import { ItemCoveragePanel } from '@/components/procurement/item-coverage-panel';

describe('item-page child-component stubs', () => {
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
});
