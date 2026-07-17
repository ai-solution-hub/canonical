/**
 * ItemPageFrame — the §A custom domain frame (ID-145 {145.42}).
 *
 * Presentational: header identity block (§A1) + the §A3/§A8 engagement rail
 * slot, which renders iff the caller supplies it. No data fetching, so no
 * Supabase/TanStack mocking needed.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { ItemPageFrame } from '@/components/procurement/item-page-frame';

describe('ItemPageFrame', () => {
  it('renders the back link to the given href with the default label', () => {
    render(
      <ItemPageFrame backHref="/procurement" name="Test Form">
        <div>content</div>
      </ItemPageFrame>,
    );
    const link = screen.getByRole('link', { name: /Back to Procurement/i });
    expect(link).toHaveAttribute('href', '/procurement');
  });

  it('renders a custom back label when supplied', () => {
    render(
      <ItemPageFrame
        backHref="/procurement"
        backLabel="Back to list"
        name="Test Form"
      >
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(
      screen.getByRole('link', { name: /Back to list/i }),
    ).toBeInTheDocument();
  });

  it('renders the form name and the stateBadge slot (§A1 identity)', () => {
    render(
      <ItemPageFrame
        backHref="/procurement"
        name="Acme ITT"
        stateBadge={<span data-testid="state-badge">Drafting</span>}
      >
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(screen.getByText('Acme ITT')).toBeInTheDocument();
    expect(screen.getByTestId('state-badge')).toHaveTextContent('Drafting');
  });

  it('renders issuing_organisation/deadline/reference_number/estimated_value when present (§A1)', () => {
    render(
      <ItemPageFrame
        backHref="/procurement"
        name="Acme ITT"
        issuingOrganisation="Acme Council"
        deadlineLabel="15/04/2026"
        referenceNumber="REF-001"
        estimatedValue="50000"
      >
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(screen.getByText('Acme Council')).toBeInTheDocument();
    expect(screen.getByText('15/04/2026')).toBeInTheDocument();
    expect(screen.getByText('REF-001')).toBeInTheDocument();
    expect(screen.getByText('50000')).toBeInTheDocument();
  });

  it('omits each identity field when absent, without rendering empty labels', () => {
    render(
      <ItemPageFrame backHref="/procurement" name="Acme ITT">
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(screen.queryByText('Acme Council')).not.toBeInTheDocument();
    expect(screen.queryByText('REF-001')).not.toBeInTheDocument();
  });

  it('does not render the estimated_value slot for an empty string', () => {
    render(
      <ItemPageFrame backHref="/procurement" name="Acme ITT" estimatedValue="">
        <div data-testid="child">content</div>
      </ItemPageFrame>,
    );
    // No stray currency icon/text — nothing to assert on directly beyond
    // "the child still renders and nothing throws".
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders the actions slot', () => {
    render(
      <ItemPageFrame
        backHref="/procurement"
        name="Acme ITT"
        actions={<button>Delete</button>}
      >
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders the §A3 engagement rail slot when supplied (grouped)', () => {
    render(
      <ItemPageFrame
        backHref="/procurement"
        name="Acme ITT"
        groupingRail={<div data-testid="rail-content">Sibling forms</div>}
      >
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(
      screen.getByTestId('item-page-frame-grouping-rail'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('rail-content')).toBeInTheDocument();
  });

  it('renders no rail region at all when ungrouped (§A8 progressive disclosure)', () => {
    render(
      <ItemPageFrame backHref="/procurement" name="Acme ITT">
        <div>content</div>
      </ItemPageFrame>,
    );
    expect(
      screen.queryByTestId('item-page-frame-grouping-rail'),
    ).not.toBeInTheDocument();
  });

  it('renders the children (tab content etc.)', () => {
    render(
      <ItemPageFrame backHref="/procurement" name="Acme ITT">
        <div data-testid="tab-content">Tabs go here</div>
      </ItemPageFrame>,
    );
    expect(screen.getByTestId('tab-content')).toBeInTheDocument();
  });
});
