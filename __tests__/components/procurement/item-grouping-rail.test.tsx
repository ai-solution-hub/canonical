/**
 * ItemGroupingRail — the §A3/§A4 read-only sibling-lineage rail (ID-145
 * {145.45}, BI-28/29).
 *
 * Behaviour under test: grouping is a LINK, never a container — each
 * sibling renders as plain read-only navigation to its OWN form page, with
 * NO roll-up, aggregation, or engagement-level win-rate ever computed or
 * shown here (S470 owner ruling, BI-29 OQ-1 = no stored roll-up). Workflow
 * state is surfaced as a text-labelled badge, never colour alone (WCAG 2.1
 * AA).
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { ItemGroupingRail } from '@/components/procurement/item-grouping-rail';
import type { EngagementSiblingForm } from '@/lib/domains/procurement/procurement-detail-shape';

function makeSibling(
  overrides: Partial<EngagementSiblingForm> = {},
): EngagementSiblingForm {
  return {
    id: 'form-2',
    name: 'Pre-Qualification Questionnaire',
    form_type: 'psq',
    workflow_state: 'drafting',
    reference_number: 'REF-001',
    ...overrides,
  };
}

describe('ItemGroupingRail', () => {
  it('links each sibling to its own form page', () => {
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[
          makeSibling({ id: 'form-2' }),
          makeSibling({ id: 'form-3', name: 'ITT' }),
        ]}
      />,
    );

    expect(
      screen.getByRole('link', { name: /Pre-Qualification Questionnaire/ }),
    ).toHaveAttribute('href', '/procurement/form-2');
    expect(screen.getByRole('link', { name: /ITT/ })).toHaveAttribute(
      'href',
      '/procurement/form-3',
    );
  });

  it('shows each sibling workflow state as a text-labelled badge, not colour alone', () => {
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[makeSibling({ workflow_state: 'submitted' })]}
      />,
    );

    // The badge's accessible text label carries the meaning (WCAG 2.1 AA) —
    // not a colour swatch alone.
    expect(screen.getByText('Submitted')).toBeInTheDocument();
  });

  it('falls back to the form type when a sibling has no name', () => {
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[makeSibling({ name: null, form_type: 'itt' })]}
      />,
    );

    expect(screen.getByRole('link', { name: /itt/i })).toBeInTheDocument();
  });

  it('shows a read-only empty message when the group has no other forms yet', () => {
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[]}
      />,
    );

    expect(screen.getByTestId('item-grouping-rail')).toHaveTextContent(
      /no other forms/i,
    );
  });

  it('never renders a roll-up, aggregation, or win-rate figure (S470, BI-29 OQ-1)', () => {
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[
          makeSibling({ id: 'form-2', workflow_state: 'lost' }),
          makeSibling({ id: 'form-3', workflow_state: 'won' }),
        ]}
      />,
    );

    expect(screen.queryByText(/win.?rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/of \d+ (won|lost)/i)).not.toBeInTheDocument();
  });

  it('does not gate on currentFormId — page.tsx already gates rail mounting on engagementGroupId', () => {
    // Regression guard: this component must never re-derive the §A3 gate
    // itself (doc comment contract) — it just renders whatever siblings it
    // is given.
    render(
      <ItemGroupingRail
        engagementGroupId="eg-1"
        currentFormId="form-1"
        siblings={[makeSibling()]}
      />,
    );
    expect(screen.getByTestId('item-grouping-rail')).toBeInTheDocument();
  });
});
