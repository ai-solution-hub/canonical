/**
 * {132.32} G-LANDING-IMPL — `/okf` index route (LI-1: a net-new index route
 * renders the Concepts landing, distinct from `/okf/[bundleId]`).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/okf/okf-landing', () => ({
  OkfLanding: () => <div data-testid="mock-okf-landing" />,
}));

import OkfIndexPage from '@/app/okf/page';

describe('OkfIndexPage', () => {
  it('renders the OkfLanding orchestrator', () => {
    render(<OkfIndexPage />);
    expect(screen.getByTestId('mock-okf-landing')).toBeInTheDocument();
  });
});
