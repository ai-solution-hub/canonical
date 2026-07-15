/**
 * ActiveProcurementsSection Component Tests
 *
 * ID-145 {145.20} BI-31/BI-33 — the dashboard "Active Bids" surface is
 * renamed to procurement/form language, and every item link resolves to
 * the form item route (never the retired /bids/<uuid> family).
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { ActiveProcurementsSection } from '@/components/dashboard/active-procurement-section';
import type { ActiveProcurementSummary } from '@/lib/dashboard';

// ---------------------------------------------------------------------------
// Mock clipboard + toast for ClaudePromptButton (rendered inside
// ProcurementListCard when a claudePrompt is present)
// ---------------------------------------------------------------------------

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBid(
  overrides: Partial<ActiveProcurementSummary> = {},
): ActiveProcurementSummary {
  return {
    id: 'form-abc-123',
    name: 'IT Support Services',
    buyer: 'Acme Council',
    status: 'drafting',
    deadline: null,
    days_until_deadline: null,
    total_questions: 10,
    answered_questions: 4,
    approved_questions: 2,
    ...overrides,
  };
}

describe('ActiveProcurementsSection', () => {
  it('renders the "Active Procurements" heading (ID-145 BI-33 — never "Active Bids")', () => {
    render(<ActiveProcurementsSection bids={[]} />);

    expect(screen.getByText('Active Procurements')).toBeInTheDocument();
    expect(screen.queryByText('Active Bids')).not.toBeInTheDocument();
  });

  it('keeps the aria-label "Active procurements" agreeing with the heading (BI-33)', () => {
    render(<ActiveProcurementsSection bids={[]} />);

    expect(screen.getByLabelText('Active procurements')).toBeInTheDocument();
  });

  it('uses procurement language in the empty-state copy, not "bid" (BI-33)', () => {
    render(<ActiveProcurementsSection bids={[]} />);

    expect(screen.getByText('No active procurements')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Create a new procurement to start managing tender responses.',
      ),
    ).toBeInTheDocument();
  });

  it('renders no occurrence of "Active Bids" anywhere in the section (BI-33 acceptance)', () => {
    const { container } = render(
      <ActiveProcurementsSection bids={[makeBid()]} />,
    );

    expect(container.textContent).not.toContain('Active Bids');
  });

  it('links every item at the form item route, never /bids/<uuid> (BI-31)', () => {
    render(
      <ActiveProcurementsSection bids={[makeBid({ id: 'form-xyz-9' })]} />,
    );

    const link = screen.getByRole('link', { name: /IT Support Services/i });
    expect(link).toHaveAttribute('href', '/procurement/form-xyz-9');
    expect(link.getAttribute('href')).not.toMatch(/^\/bids\//);
  });

  it('renders a card for each active procurement passed', () => {
    render(
      <ActiveProcurementsSection
        bids={[
          makeBid({ id: 'form-1', name: 'Procurement One' }),
          makeBid({ id: 'form-2', name: 'Procurement Two' }),
        ]}
      />,
    );

    expect(screen.getByText('Procurement One')).toBeInTheDocument();
    expect(screen.getByText('Procurement Two')).toBeInTheDocument();
  });
});
