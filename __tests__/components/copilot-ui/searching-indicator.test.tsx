/**
 * SearchingIndicator Component Tests
 *
 * Tests the inline searching status indicator rendered in the
 * CopilotKit chat sidebar during knowledge base searches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { SearchingIndicator } from '@/components/copilot-ui/searching-indicator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchingIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with role="status"', () => {
    render(<SearchingIndicator />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows "Searching knowledge base..." text', () => {
    render(<SearchingIndicator />);

    expect(
      screen.getByText('Searching knowledge base...'),
    ).toBeInTheDocument();
  });
});
