/**
 * Coverage Page Tests
 *
 * Tests the coverage page wrapper — semantic section element
 * and ARIA labelling.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — CoveragePageTabs is imported via relative path in page.tsx
// The @/ alias resolves to the project root, so mock the full alias path.
// ---------------------------------------------------------------------------

vi.mock('@/app/coverage/coverage-tabs', () => ({
  CoveragePageTabs: () => <div data-testid="coverage-tabs">Coverage Tabs</div>,
}));

import CoveragePage from '@/app/coverage/page';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoveragePage', () => {
  it('wraps content in a section with aria-label="Coverage dashboard"', () => {
    render(<CoveragePage />);

    const section = screen.getByRole('region', { name: 'Coverage dashboard' });
    expect(section).toBeInTheDocument();
    expect(section.tagName).toBe('SECTION');
  });

  it('renders CoveragePageTabs as child content', () => {
    render(<CoveragePage />);

    expect(screen.getByTestId('coverage-tabs')).toBeInTheDocument();
  });
});
